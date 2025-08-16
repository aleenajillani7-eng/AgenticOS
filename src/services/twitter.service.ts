// src/services/twitter.service.ts
import axios, { AxiosError } from "axios";
import { env } from "../config/env";
import { loadTokens, saveTokens } from "../utils/encryption";
import { TwitterOAuthResponse, TwitterPostResponse } from "../types";

/**
 * ChainGPT API base (for text generation you already use in scheduler)
 */
const CHAINGPT_API_URL = "https://webapi.chaingpt.org";

/**
 * Small helper: turn axios errors into clearer messages (adds rate-limit info)
 */
function enrichTwitterError(err: unknown): Error {
  const ax = err as AxiosError<any>;
  const status = ax.response?.status;
  const headers = ax.response?.headers || {};
  const resetHeader = headers["x-rate-limit-reset"];
  const resetMs = resetHeader ? Number(resetHeader) * 1000 : null;

  const e = new Error(
    ax.response?.data?.detail ||
      ax.response?.data?.title ||
      ax.message ||
      "Twitter error"
  ) as Error & { status?: number; rateResetAt?: number | null };
  e.status = status;
  e.rateResetAt = resetMs;
  return e;
}

/**
 * Refresh Twitter access token using a refresh token.
 */
export async function refreshAccessToken(
  refreshToken: string
): Promise<{ accessToken: string; refreshToken: string }> {
  try {
    const params = new URLSearchParams();
    params.append("refresh_token", refreshToken);
    params.append("grant_type", "refresh_token");
    params.append("client_id", env.TWITTER_CLIENT_ID);

    const res = await axios.post<TwitterOAuthResponse>(
      "https://api.twitter.com/2/oauth2/token",
      params,
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        // Many setups succeed with client_id + client_secret here.
        // If your app is strictly PKCE-only, remove `auth` and rely on body only.
        auth: {
          username: env.TWITTER_CLIENT_ID,
          password: env.TWITTER_CLIENT_SECRET,
        },
      }
    );

    return {
      accessToken: res.data.access_token,
      refreshToken: res.data.refresh_token || refreshToken,
    };
  } catch (err) {
    throw enrichTwitterError(err);
  }
}

/**
 * Returns a valid access token; refreshes if the current one is invalid.
 */
export async function getAccessToken(): Promise<string> {
  try {
    const tokens = await loadTokens(env.ENCRYPTION_KEY);

    // quick probe to see if current access token is alive
    try {
      await axios.get("https://api.twitter.com/2/users/me", {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
      return tokens.accessToken;
    } catch {
      // refresh flow
      const newTokens = await refreshAccessToken(tokens.refreshToken);
      await saveTokens(
        newTokens.accessToken,
        newTokens.refreshToken,
        env.ENCRYPTION_KEY
      );
      return newTokens.accessToken;
    }
  } catch (err) {
    // surface a consistent message upwards
    const e = enrichTwitterError(err);
    console.error("Error getting Twitter access token:", e);
    throw new Error(
      "Failed to get Twitter access token. Check if tokens are set up correctly."
    );
  }
}

/**
 * Generate tweet text using ChainGPT (trimmed to fit basic Tweet length).
 */
export async function getTextForTweet(prompt: string): Promise<string> {
  try {
    const res = await axios.post(
      `${CHAINGPT_API_URL}/tweet-generator`,
      { prompt },
      {
        headers: {
          "Content-Type": "application/json",
          "api-key": env.CHAINGPT_API_KEY,
        },
      }
    );

    // If your app uses native X API (no media), keeping under ~270 is safe.
    const text: string = res.data?.tweet ?? "";
    return text.slice(0, 270);
  } catch (err) {
    console.error("Error generating tweet text:", err);
    throw new Error("Failed to generate tweet content using ChainGPT API");
  }
}

/**
 * Low-level: post a tweet with a given access token.
 */
export async function postTweet(
  accessToken: string,
  message: string
): Promise<TwitterPostResponse> {
  try {
    const res = await axios.post<TwitterPostResponse>(
      "https://api.twitter.com/2/tweets",
      { text: message },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );
    return res.data;
  } catch (err) {
    throw enrichTwitterError(err);
  }
}

/**
 * Low-level: reply to an existing tweetId (requires access token).
 */
export async function postReply(
  accessToken: string,
  message: string,
  inReplyToTweetId: string
): Promise<TwitterPostResponse> {
  try {
    const res = await axios.post<TwitterPostResponse>(
      "https://api.twitter.com/2/tweets",
      {
        text: message,
        reply: { in_reply_to_tweet_id: inReplyToTweetId },
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );
    return res.data;
  } catch (err) {
    throw enrichTwitterError(err);
  }
}

/**
 * Convenience: generate text, then post it.
 */
export async function generateAndPostTweet(
  prompt: string
): Promise<{ response: TwitterPostResponse; tweet: string }> {
  const tweet = await getTextForTweet(prompt);
  const accessToken = await getAccessToken();

  try {
    const response = await postTweet(accessToken, tweet);
    console.log(`Tweet posted successfully: ${tweet}`);
    return { response, tweet };
  } catch (err) {
    const e = enrichTwitterError(err);
    console.error("Error generating and posting tweet:", e);
    throw e;
  }
}

/**
 * Convenience: post a tweet (no need to pass token).
 */
export async function uploadTwitterPostTweet(
  message: string
): Promise<TwitterPostResponse> {
  const token = await getAccessToken();
  try {
    const res = await postTweet(token, message);
    console.log(`Tweet posted successfully: ${message}`);
    return res;
  } catch (err) {
    const e = enrichTwitterError(err);
    console.error("Error posting tweet:", e);
    throw e;
  }
}

/**
 * Compatibility export: some modules may import this older name.
 * Supports both signatures:
 *   postTweetReply(accessToken, message, inReplyTo)
 *   postTweetReply(inReplyTo, message)
 */
export function postTweetReply(
  a: string,
  b: string,
  c?: string
): Promise<TwitterPostResponse> {
  if (c) {
    // old signature: (accessToken, message, inReplyTo)
    return postReply(a, b, c);
  }
  // alt signature: (inReplyTo, message)
  return (async () => {
    const token = await getAccessToken();
    return postReply(token, b, a);
  })();
}

/**
 * Fetch the authenticated user's id (handy for mentions/replies code).
 */
export async function getSelfUserId(): Promise<string> {
  const token = await getAccessToken();
  const res = await axios.get("https://api.twitter.com/2/users/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const id = res.data?.data?.id;
  if (!id) throw new Error("Failed to resolve self user id");
  return id;
}

// some codebases import getMeId; keep an alias for compatibility
export const getMeId = getSelfUserId;
