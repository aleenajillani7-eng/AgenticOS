// src/services/twitter.service.ts
import axios, { AxiosError } from "axios";
import { env } from "../config/env";
import { loadTokens, saveTokens } from "../utils/encryption";
import { TwitterOAuthResponse, TwitterPostResponse } from "../types";

// ChainGPT API URL
const CHAINGPT_API_URL = "https://webapi.chaingpt.org";

/** ---------------- Existing helpers you already had ---------------- **/
export const getAccessToken = async (): Promise<string> => {
  try {
    const tokens = await loadTokens(env.ENCRYPTION_KEY);

    try {
      await axios.get("https://api.twitter.com/2/users/me", {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
      return tokens.accessToken;
    } catch {
      const newTokens = await refreshAccessToken(tokens.refreshToken);
      await saveTokens(newTokens.accessToken, newTokens.refreshToken, env.ENCRYPTION_KEY);
      return newTokens.accessToken;
    }
  } catch (error) {
    console.error("Error getting Twitter access token:", error);
    throw new Error("Failed to get Twitter access token. Check if tokens are set up correctly.");
  }
};

export const refreshAccessToken = async (refreshToken: string) => {
  try {
    const params = new URLSearchParams();
    params.append("refresh_token", refreshToken);
    params.append("grant_type", "refresh_token");
    params.append("client_id", env.TWITTER_CLIENT_ID);

    const response = await axios.post<TwitterOAuthResponse>("https://api.twitter.com/2/oauth2/token", params, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      auth: { username: env.TWITTER_CLIENT_ID, password: env.TWITTER_CLIENT_SECRET },
    });

    return {
      accessToken: response.data.access_token,
      refreshToken: response.data.refresh_token || refreshToken,
    };
  } catch (error) {
    console.error("Error refreshing access token:", error);
    throw new Error("Failed to refresh Twitter access token");
  }
};

export const getTextForTweet = async (prompt: string): Promise<string> => {
  try {
    const response = await axios.post(
      `${CHAINGPT_API_URL}/tweet-generator`,
      { prompt },
      { headers: { "Content-Type": "application/json", "api-key": env.CHAINGPT_API_KEY } }
    );
    // Trim to safe length for base tier
    return response.data.tweet.slice(0, 270);
  } catch (error) {
    console.error("Error generating tweet text:", error);
    throw new Error("Failed to generate tweet content using ChainGPT API");
  }
};

export const postTweet = async (accessToken: string, message: string): Promise<TwitterPostResponse> => {
  try {
    const response = await axios.post<TwitterPostResponse>(
      "https://api.twitter.com/2/tweets",
      { text: message },
      { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" } }
    );
    return response.data;
  } catch (error) {
    throw enrichTwitterError(error);
  }
};

export const generateAndPostTweet = async (prompt: string) => {
  const tweet = await getTextForTweet(prompt);
  const accessToken = await getAccessToken();
  const response = await postTweet(accessToken, tweet);
  console.log(`Tweet posted successfully: ${tweet}`);
  return { response, tweet };
};

export const uploadTwitterPostTweet = async (message: string): Promise<TwitterPostResponse> => {
  const accessToken = await getAccessToken();
  const response = await postTweet(accessToken, message);
  console.log(`Tweet posted successfully: ${message}`);
  return response;
};

/** ---------------- New helpers for mentions & rate limits ---------------- **/

let CACHED_ME_ID: string | null = null;

export async function getMeId(): Promise<string> {
  if (CACHED_ME_ID) return CACHED_ME_ID;
  const accessToken = await getAccessToken();
  const r = await axios.get("https://api.twitter.com/2/users/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  CACHED_ME_ID = r.data?.data?.id;
  return CACHED_ME_ID!;
}

export function enrichTwitterError(error: any) {
  const ax = error as AxiosError<any>;
  const status = ax.response?.status;
  const headers = ax.response?.headers || {};
  const resetHeader = headers["x-rate-limit-reset"];
  const resetMs = resetHeader ? Number(resetHeader) * 1000 : null;

  const e = new Error(ax.response?.data?.detail || ax.message || "Twitter error") as Error & {
    status?: number;
    rateLimited?: boolean;
    resetAt?: number | null;
  };
  e.status = status;
  if (status === 429) {
    e.rateLimited = true;
    e.resetAt = resetMs ?? Date.now() + 15 * 60 * 1000; // default 15 min window if header missing
  }
  return e;
}

export async function postTweetReply(
  accessToken: string,
  message: string,
  inReplyToId: string
): Promise<TwitterPostResponse> {
  try {
    const response = await axios.post<TwitterPostResponse>(
      "https://api.twitter.com/2/tweets",
      { text: message, reply: { in_reply_to_tweet_id: inReplyToId } },
      { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" } }
    );
    return response.data;
  } catch (error) {
    throw enrichTwitterError(error);
  }
}

export type Mention = {
  id: string;
  text: string;
  author_id?: string;
  created_at?: string;
};

export async function fetchMentions(accessToken: string, meId: string, sinceId?: string, max = 5): Promise<Mention[]> {
  try {
    const url = new URL(`https://api.twitter.com/2/users/${meId}/mentions`);
    url.searchParams.set("max_results", String(Math.min(25, Math.max(1, max))));
    url.searchParams.set("tweet.fields", "author_id,created_at");
    if (sinceId) url.searchParams.set("since_id", sinceId);

    const r = await axios.get(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    return r.data?.data || [];
  } catch (error) {
    throw enrichTwitterError(error);
  }
}

/** Utility for persona two-liner (fallback if you don't call ChainGPT) */
export function formatTwoLineReply(source: string): string {
  // very conservative fallback formatter
  const clean = source.replace(/\s+/g, " ").trim();
  const tl = clean.slice(0, 140);
  const zing = "Smart take, zero fluff.";
  return `TL;DR: ${tl}\nZinger: ${zing.slice(0, 100)}`;
}
