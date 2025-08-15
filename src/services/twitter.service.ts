// src/services/twitter.service.ts
import axios, { AxiosError, AxiosRequestConfig } from "axios";
import { env } from "../config/env";
import { loadTokens, saveTokens } from "../utils/encryption";
import { TwitterOAuthResponse, TwitterPostResponse } from "../types";

// Kept for scheduled posts
const CHAINGPT_API_URL = "https://webapi.chaingpt.org";

type StoredTokens = {
  access_token?: string;
  accessToken?: string;
  refresh_token?: string;
  refreshToken?: string;
  expires_in?: number;
  expiresIn?: number;
  created_at?: number;
  createdAt?: number;
};

function pick<T>(a: T | undefined, b: T | undefined): T | undefined {
  return a !== undefined ? a : b;
}
function normalize(tokens: any): StoredTokens {
  return {
    access_token: pick(tokens.access_token, tokens.accessToken),
    refresh_token: pick(tokens.refresh_token, tokens.refreshToken),
    expires_in: pick(tokens.expires_in, tokens.expiresIn),
    created_at: pick(tokens.created_at, tokens.createdAt),
  };
}
function isExpired(t: StoredTokens, skewSeconds = 120): boolean {
  const created = t.created_at ?? 0;
  const ttl = t.expires_in ?? 7200;
  const nowSec = Math.floor(Date.now() / 1000);
  return nowSec >= Math.floor(created / 1000) + ttl - skewSeconds;
}

// ---- Backoff helpers ----
async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
function jitter(ms: number) {
  const j = Math.floor(Math.random() * 2000); // add up to 2s jitter
  return ms + j;
}
function computeBackoffMsFromHeaders(headers: any): number {
  // Prefer Retry-After (seconds). Fallback to x-rate-limit-reset (unix seconds).
  const ra = headers?.["retry-after"];
  if (ra) return jitter(Number(ra) * 1000);

  const reset = headers?.["x-rate-limit-reset"];
  if (reset) {
    const now = Date.now();
    const resetMs = Number(reset) * 1000;
    const wait = resetMs - now + 500; // add small cushion
    if (wait > 0) return jitter(wait);
  }
  return jitter(60_000); // safe default 60s
}

// ---- Request wrapper with 429 backoff & limited retries ----
async function requestWithRetry<T>(
  cfg: AxiosRequestConfig,
  retries = 2
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      const res = await axios<T>(cfg);
      return res.data;
    } catch (err) {
      const ax = err as AxiosError;
      const status = ax.response?.status;
      if (status === 429 && attempt < retries) {
        const waitMs = computeBackoffMsFromHeaders(ax.response?.headers || {});
        console.warn(`[rate-limit] 429: backing off ${waitMs}ms (attempt ${attempt + 1}/${retries})`);
        await sleep(waitMs);
        attempt++;
        continue;
      }
      throw err;
    }
  }
}

// ---- OAuth refresh (only when needed) ----
export const refreshAccessToken = async (
  refreshToken: string
): Promise<{ accessToken: string; refreshToken: string; expiresIn?: number }> => {
  const params = new URLSearchParams();
  params.append("refresh_token", refreshToken);
  params.append("grant_type", "refresh_token");
  params.append("client_id", env.TWITTER_CLIENT_ID);

  const response = await axios.post<TwitterOAuthResponse>(
    "https://api.twitter.com/2/oauth2/token",
    params,
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      auth: { username: env.TWITTER_CLIENT_ID, password: env.TWITTER_CLIENT_SECRET },
    }
  );

  return {
    accessToken: response.data.access_token,
    refreshToken: response.data.refresh_token || refreshToken,
    expiresIn: response.data.expires_in,
  };
};

export const getAccessToken = async (): Promise<string> => {
  const raw = await loadTokens(env.ENCRYPTION_KEY);
  const t = normalize(raw);

  if (!t.access_token || !t.refresh_token) {
    throw new Error("Stored tokens are incomplete. Please re-authorize.");
  }

  if (!isExpired(t)) return t.access_token!;

  const refreshed = await refreshAccessToken(t.refresh_token!);
  await saveTokens(
    {
      access_token: refreshed.accessToken,
      refresh_token: refreshed.refreshToken,
      token_type: "bearer",
      expires_in: refreshed.expiresIn ?? 7200,
      created_at: Date.now(),
    },
    env.ENCRYPTION_KEY
  );
  return refreshed.accessToken;
};

// ---- Authed request with refresh-on-401 and 429 backoff ----
async function authedRequest<T>(
  cfg: AxiosRequestConfig,
  doRefreshOn401 = true
): Promise<T> {
  try {
    const token = await getAccessToken();
    const merged: AxiosRequestConfig = {
      ...cfg,
      headers: {
        ...(cfg.headers || {}),
        Authorization: `Bearer ${token}`,
      },
    };
    return await requestWithRetry<T>(merged);
  } catch (err) {
    const ax = err as AxiosError;
    if (ax.response?.status === 401 && doRefreshOn401) {
      const raw = await loadTokens(env.ENCRYPTION_KEY);
      const t = normalize(raw);
      if (!t.refresh_token) throw err;

      const refreshed = await refreshAccessToken(t.refresh_token);
      await saveTokens(
        {
          access_token: refreshed.accessToken,
          refresh_token: refreshed.refreshToken,
          token_type: "bearer",
          expires_in: refreshed.expiresIn ?? 7200,
          created_at: Date.now(),
        },
        env.ENCRYPTION_KEY
      );

      const merged: AxiosRequestConfig = {
        ...cfg,
        headers: {
          ...(cfg.headers || {}),
          Authorization: `Bearer ${refreshed.accessToken}`,
        },
      };
      return await requestWithRetry<T>(merged, 1);
    }
    throw err;
  }
}

// ---- ChainGPT text (kept for scheduler) ----
export const getTextForTweet = async (prompt: string): Promise<string> => {
  const response = await axios.post(
    `${CHAINGPT_API_URL}/tweet-generator`,
    { prompt },
    {
      headers: {
        "Content-Type": "application/json",
        "api-key": env.CHAINGPT_API_KEY,
      },
    }
  );
  return String(response.data.tweet || "").slice(0, 270);
};

// ---- Tweet helpers ----
export const postTweet = async (
  accessToken: string,
  message: string
): Promise<TwitterPostResponse> => {
  const cfg: AxiosRequestConfig = {
    method: "POST",
    url: "https://api.twitter.com/2/tweets",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    data: { text: message },
  };
  return requestWithRetry<TwitterPostResponse>(cfg);
};

export const postReply = async (
  message: string,
  inReplyToTweetId: string
): Promise<TwitterPostResponse> => {
  const cfg: AxiosRequestConfig = {
    method: "POST",
    url: "https://api.twitter.com/2/tweets",
    headers: { "Content-Type": "application/json" },
    data: { text: message, reply: { in_reply_to_tweet_id: inReplyToTweetId } },
  };
  return authedRequest<TwitterPostResponse>(cfg);
};

// Cache self user id (or read from ENV to avoid /users/me)
let cachedSelf: { id: string; fetchedAt: number } | null = null;

export const getSelfUserId = async (): Promise<string> => {
  // If you know your account id, set TWITTER_USER_ID to skip /users/me entirely
  if (env.TWITTER_USER_ID) return env.TWITTER_USER_ID;

  if (cachedSelf && Date.now() - cachedSelf.fetchedAt < 60 * 60 * 1000) {
    return cachedSelf.id;
  }
  const data = await authedRequest<{ data: { id: string } }>({
    method: "GET",
    url: "https://api.twitter.com/2/users/me",
  });
  cachedSelf = { id: data.data.id, fetchedAt: Date.now() };
  return data.data.id;
};

// Mentions fetch with pagination (catches up >20 items)
export const fetchMentions = async (
  userId: string,
  sinceId?: string
): Promise<Array<{ id: string; text: string; author_id: string; created_at?: string }>> => {
  const out: Array<{ id: string; text: string; author_id: string; created_at?: string }> = [];
  let pageToken: string | undefined;
  let pages = 0;
  const MAX_PAGES = 5;    // ~100 tweets max (5 * 20)
  const PAGE_SIZE = 20;   // Twitter cap per page

  while (pages < MAX_PAGES) {
    const url = new URL(`https://api.twitter.com/2/users/${userId}/mentions`);
    url.searchParams.set("max_results", String(PAGE_SIZE));
    url.searchParams.set("tweet.fields", "author_id,created_at");
    if (sinceId) url.searchParams.set("since_id", sinceId);
    if (pageToken) url.searchParams.set("pagination_token", pageToken);

    const data = await authedRequest<{ data?: any[]; meta?: { next_token?: string } }>({
      method: "GET",
      url: url.toString(),
    });

    const items = (data.data || []) as Array<{ id: string; text: string; author_id: string; created_at?: string }>;
    out.push(...items);

    pageToken = data.meta?.next_token;
    pages++;
    if (!pageToken || items.length < PAGE_SIZE) break;
  }

  // oldest first for polite processing
  out.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
  return out;
};

// For scheduler
export const generateAndPostTweet = async (
  prompt: string
): Promise<{ response: TwitterPostResponse; tweet: string }> => {
  const tweet = await getTextForTweet(prompt);
  const token = await getAccessToken();
  const response = await postTweet(token, tweet);
  console.log(`Tweet posted successfully: ${tweet}`);
  return { response, tweet };
};

export const uploadTwitterPostTweet = async (message: string): Promise<TwitterPostResponse> => {
  const token = await getAccessToken();
  const response = await postTweet(token, message);
  console.log(`Tweet posted successfully: ${message}`);
  return response;
};
