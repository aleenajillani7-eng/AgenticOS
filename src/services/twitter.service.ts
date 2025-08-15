// src/services/twitter.service.ts
import axios, { AxiosError, AxiosRequestConfig } from "axios";
import { env } from "../config/env";
import { loadTokens, saveTokens } from "../utils/encryption";
import { TwitterOAuthResponse, TwitterPostResponse } from "../types";

// Kept for scheduled posts
const CHAINGPT_API_URL = "https://webapi.chaingpt.org";

// ---- Token helpers ----
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

// ---- 429 backoff / retry ----
async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
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
        const raHeader = ax.response?.headers?.["retry-after"];
        const waitMs = raHeader ? Number(raHeader) * 1000 : 60_000; // default 60s
        console.warn(`[rate-limit] 429: backing off ${waitMs}ms (attempt ${attempt + 1}/${retries})`);
        await sleep(waitMs);
        attempt++;
        continue;
      }
      throw err;
    }
  }
}

// ---- OAuth refresh (only on 401) ----
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

// ---- Tweeting helpers ----
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

// Cache self user id to avoid /users/me on every cycle
let cachedSelf: { id: string; fetchedAt: number } | null = null;
export const getSelfUserId = async (): Promise<string> => {
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

export const fetchMentions = async (
  userId: string,
  sinceId?: string
): Promise<Array<{ id: string; text: string; author_id: string; created_at?: string }>> => {
  const url = new URL(`https://api.twitter.com/2/users/${userId}/mentions`);
  url.searchParams.set("max_results", "20");
  url.searchParams.set("tweet.fields", "author_id,created_at");
  if (sinceId) url.searchParams.set("since_id", sinceId);

  const data = await authedRequest<{ data?: any[] }>({ method: "GET", url: url.toString() });
  return (data.data || []) as Array<{ id: string; text: string; author_id: string; created_at?: string }>;
};

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
