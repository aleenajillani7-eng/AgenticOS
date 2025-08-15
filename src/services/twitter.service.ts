// src/services/twitter.service.ts
import axios from "axios";
import { env } from "../config/env";
import { loadTokens, saveTokens } from "../utils/encryption";
import { TwitterOAuthResponse, TwitterPostResponse } from "../types";

// ChainGPT API URL (still used elsewhere – we won't rely on it for mentions persona)
const CHAINGPT_API_URL = "https://webapi.chaingpt.org";

/** Get a valid access token (refresh if needed) */
export const getAccessToken = async (): Promise<string> => {
  try {
    const tokens = await loadTokens(env.ENCRYPTION_KEY);

    // try current token
    try {
      await axios.get("https://api.twitter.com/2/users/me", {
        headers: { Authorization: `Bearer ${tokens.accessToken || tokens.access_token}` },
      });
      return (tokens.accessToken || tokens.access_token) as string;
    } catch {
      // refresh on failure
      const refreshed = await refreshAccessToken(
        (tokens.refreshToken || tokens.refresh_token) as string
      );

      // save new tokens using the encryption util's object shape
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
    }
  } catch (error) {
    console.error("Error getting Twitter access token:", error);
    throw new Error(
      "Failed to get Twitter access token. Check if tokens are set up correctly."
    );
  }
};

/** Refresh with OAuth2 refresh_token */
export const refreshAccessToken = async (
  refreshToken: string
): Promise<{ accessToken: string; refreshToken: string; expiresIn?: number }> => {
  try {
    const params = new URLSearchParams();
    params.append("refresh_token", refreshToken);
    params.append("grant_type", "refresh_token");
    params.append("client_id", env.TWITTER_CLIENT_ID);

    const response = await axios.post<TwitterOAuthResponse>(
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

    return {
      accessToken: response.data.access_token,
      refreshToken: response.data.refresh_token || refreshToken,
      expiresIn: response.data.expires_in,
    };
  } catch (error) {
    console.error("Error refreshing access token:", error);
    throw new Error("Failed to refresh Twitter access token");
  }
};

/** Generate a tweet with ChainGPT (kept for scheduled posts) */
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
    // base API: trim to fit
    const tweetText = (response.data.tweet || "").slice(0, 270);
    return tweetText;
  } catch (error) {
    console.error("Error generating tweet text:", error);
    throw new Error("Failed to generate tweet content using ChainGPT API");
  }
};

/** Post a tweet */
export const postTweet = async (
  accessToken: string,
  message: string
): Promise<TwitterPostResponse> => {
  try {
    const response = await axios.post<TwitterPostResponse>(
      "https://api.twitter.com/2/tweets",
      { text: message },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );
    return response.data;
  } catch (error) {
    console.error("Error posting tweet:", error);
    throw error;
  }
};

/** Post a reply to a tweet (in-thread) */
export const postReply = async (
  message: string,
  inReplyToTweetId: string
): Promise<TwitterPostResponse> => {
  const accessToken = await getAccessToken();
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
  } catch (error) {
    console.error("Error posting reply:", error);
    throw error;
  }
};

/** Get the bot's user id */
export const getSelfUserId = async (): Promise<string> => {
  const accessToken = await getAccessToken();
  const res = await axios.get("https://api.twitter.com/2/users/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return res.data.data.id as string;
};

/** Fetch mentions for the user, optionally since a tweet ID */
export const fetchMentions = async (
  userId: string,
  sinceId?: string
): Promise<
  Array<{ id: string; text: string; author_id: string; created_at?: string }>
> => {
  const accessToken = await getAccessToken();
  const url = new URL(`https://api.twitter.com/2/users/${userId}/mentions`);
  url.searchParams.set("max_results", "20");
  url.searchParams.set("tweet.fields", "author_id,created_at");
  if (sinceId) url.searchParams.set("since_id", sinceId);

  const res = await axios.get(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  return (res.data?.data || []) as Array<{
    id: string;
    text: string;
    author_id: string;
    created_at?: string;
  }>;
};

/** Generate + post tweet (kept for scheduler) */
export const generateAndPostTweet = async (
  prompt: string
): Promise<{ response: TwitterPostResponse; tweet: string }> => {
  try {
    const tweet = await getTextForTweet(prompt);
    const accessToken = await getAccessToken();
    const response = await postTweet(accessToken, tweet);
    console.log(`Tweet posted successfully: ${tweet}`);
    return { response, tweet };
  } catch (error) {
    console.error("Error generating and posting tweet:", error);
    throw error;
  }
};

/** Direct upload of a tweet message (kept for webhooks) */
export const uploadTwitterPostTweet = async (
  message: string
): Promise<TwitterPostResponse> => {
  try {
    const accessToken = await getAccessToken();
    const response = await postTweet(accessToken, message);
    console.log(`Tweet posted successfully: ${message}`);
    return response;
  } catch (error) {
    console.error("Error posting tweet:", error);
    throw error;
  }
};
