// src/services/twitter.service.ts
import axios, { AxiosError, AxiosRequestConfig } from "axios";
import { env } from "../config/env";
import { loadTokens, saveTokens } from "../utils/encryption";
import { TwitterOAuthResponse, TwitterPostResponse } from "../types";

// =============== Constants ===============
const CHAINGPT_API_URL = "https://webapi.chaingpt.org";

// =============== Small in-memory caches ===============
let ACCESS_TOKEN_CACHE: string | null = null;
let SELF_USER_ID_CACHE: string | null = null;

// =============== Token helpers ===============
async function ensureAccessToken(): Promise<{ accessToken: string; refreshToken: string }> {
  const t = await loadTokens(env.ENCRYPTION_KEY);
  if (!ACCESS_TOKEN_CACHE) ACCESS_TOKEN_CACHE = t.accessToken;
  return { accessToken: ACCESS_TOKEN_CACHE, refreshToken: t.refreshToken };
}

async function refreshAccessTokenInternal(refreshToken: string): Promise<string> {
  const params = new URLSearchParams();
  params.append("refresh_token", refreshToken);
  params.append("grant_type", "refresh_token");
  params.append("client_id", env.TWITTER_CLIENT_ID);

  const resp = await axios.post<TwitterOAuthResponse>(
    "https://api.twitter.com/2/oauth2/token",
    params,
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      auth: {
        username: env.TWITTER_CLIENT_ID,
        password: env.TWITTER_CLIENT_SECRET,
      },
    }
  );

  const newAccess = resp.data.access_token;
  const newRefresh = resp.data.refresh_token || refreshToken;
  await saveTokens(newAccess, newRefresh, env.ENCRYPTION_KEY);
  ACCESS_TOKEN_CACHE = newAccess;
  return newAccess;
}

// Keep your public refresh function (used elsewhere)
export const refreshAccessToken = async (
  refreshToken: string
): Promise<{ accessToken: string; refreshToken: string }> => {
  const params = new URLSearchParams();
  params.append("refresh_token", refreshToken);
  params.append("grant_type", "refresh_token");
  params.append("client_id", env.TWITTER_CLIENT_ID);

  const resp = await axios.post<TwitterOAuthResponse>(
    "https://api.twitter.com/2/oauth2/token",
    params,
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      auth: {
        username: env.TWITTER_CLIENT_ID,
        password: env.TWITTER_CLIENT_SECRET,
      },
    }
  );

  const accessToken = resp.data.access_token;
  const newRefresh = resp.data.refresh_token || refreshToken;
  await saveTokens(accessToken, newRefresh, env.ENCRYPTION_KEY);
  ACCESS_TOKEN_CACHE = accessToken;
  return { accessToken, refreshToken: newRefresh };
};

// Keep this export for compatibility (now it just returns cached/loaded token)
export const getAccessToken = async (): Promise<string> => {
  try {
    const t = await ensureAccessToken();
    return t.accessToken;
  } catch (e) {
    console.error("Error getting Twitter access token:", e);
    throw new Error("Failed to get Twitter access token. Check if tokens are set up correctly.");
  }
};

// =============== Rate-limit helpers ===============
function resetTimestampFromHeaders(headers: Record<string, any>): number | null {
  const reset = headers["x-rate-limit-reset"];
  if (reset) return Number(reset) * 1000;

  const retryAfter = headers["retry-after"];
  if (retryAfter) {
    const n = Number(retryAfter);
    if (!Number.isNaN(n)) return Date.now() + n * 1000;
  }
  return null;
}

function enrichTwitterError(ax: AxiosError) {
  const status = ax.response?.status;
  const headers = ax.response?.headers || {};
  const until = resetTimestampFromHeaders(headers);

  const err = new Error(
    (ax.response?.data as any)?.detail || ax.message || "Twitter error"
  ) as Error & { status?: number; rateLimitedUntil?: number | null };

  err.status = status;
  if (status === 429) err.rateLimitedUntil = until;
  return err;
}

// =============== Single request wrapper ===============
async function twitterRequest<T>(
  req: AxiosRequestConfig,
  opts: { retry401?: boolean; retry429?: boolean } = { retry401: true, retry429: true }
): Promise<T> {
  const { refreshToken } = await ensureAccessToken();
  const token = await getAccessToken();

  const doReq = async (bearer: string) =>
    axios.request<T>({
      ...req,
      headers: {
        ...(req.headers || {}),
        Authorization: `Bearer ${bearer}`,
      },
    });

  try {
    const r = await doReq(token);
    return r.data;
  } catch (e: any) {
    const ax = e as AxiosError;
    const status = ax.response?.status;

    // 401 -> refresh once, then retry
    if (status === 401 && opts.retry401) {
      const fresh = await refreshAccessTokenInternal(refreshToken);
      const r2 = await doReq(fresh);
      return r2.data;
    }

    // 429 -> wait until reset (or fallback) and retry once
    if (status === 429 && opts.retry429) {
      const until = resetTimestampFromHeaders(ax.response?.headers || {});
      const waitMs = until ? Math.max(0, until - Date.now()) : 120_000;
      console.warn(`[rate-limit] 429: backing off ${waitMs}ms (retry once)`);
      await new Promise((r) => setTimeout(r, waitMs));
      const r2 = await doReq(await getAccessToken());
      return r2.data;
    }

    throw enrichTwitterError(ax);
  }
}

// =============== Twitter endpoints (use wrapper) ===============
export const postTweet = async (
  _accessToken: string, // kept for signature compatibility
  message: string
): Promise<TwitterPostResponse> => {
  return twitterRequest<TwitterPostResponse>({
    method: "POST",
    url: "https://api.twitter.com/2/tweets",
    headers: { "Content-Type": "application/json" },
    data: { text: message },
  });
};

export async function postReply(
  _accessToken: string, // kept for signature compatibility
  message: string,
  inReplyToTweetId: string
): Promise<TwitterPostResponse> {
  return twitterRequest<TwitterPostResponse>({
    method: "POST",
    url: "https://api.twitter.com/2/tweets",
    headers: { "Content-Type": "application/json" },
    data: { text: message, reply: { in_reply_to_tweet_id: inReplyToTweetId } },
  });
}

export async function replyToTweet(inReplyToTweetId: string, message: string) {
  return postReply("", message, inReplyToTweetId);
}

export async function getSelfUserId(): Promise<string> {
  if (SELF_USER_ID_CACHE) return SELF_USER_ID_CACHE;
  const data = await twitterRequest<{ data: { id: string } }>({
    method: "GET",
    url: "https://api.twitter.com/2/users/me",
  });
  SELF_USER_ID_CACHE = data.data.id;
  return SELF_USER_ID_CACHE;
}

// 👉 Backward-compat alias to satisfy old imports:
export const getMeId = getSelfUserId;

// =============== Content generation (ChainGPT) ===============
export const getTextForTweet = async (prompt: string): Promise<string> => {
  try {
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
    const text = (response.data?.tweet || "").toString();
    return text.slice(0, 270);
  } catch (error) {
    console.error("Error generating tweet text:", error);
    throw new Error("Failed to generate tweet content using ChainGPT API");
  }
};

// Free-form for mentions (kept for compatibility)
export async function generateFreeformReply(prompt: string): Promise<string> {
  return getTextForTweet(prompt);
}

// =============== High-level helpers for your jobs ===============
export const generateAndPostTweet = async (
  prompt: string
): Promise<{ response: TwitterPostResponse; tweet: string }> => {
  const tweet = await getTextForTweet(prompt);
  const response = await postTweet("", tweet);
  console.log(`Tweet posted successfully: ${tweet}`);
  return { response, tweet };
};

export const uploadTwitterPostTweet = async (message: string): Promise<TwitterPostResponse> => {
  return postTweet("", message);
};
