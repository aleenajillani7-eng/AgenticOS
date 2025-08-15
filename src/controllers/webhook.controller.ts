// src/controllers/webhook.controller.ts
import { Context } from "hono";
import axios from "axios";
import ejs from "ejs";
import { env } from "../config/env";
import { uploadTwitterPostTweet } from "../services/twitter.service";
import { ApiResponse, TweetWebhookRequest, WebhookRegistrationRequest } from "../types";
import { join } from "path";

const CHAINGPT_API_URL = "https://webapi.chaingpt.org";

// --- helpers ---
async function fetchConnectedWebhook(): Promise<string | null> {
  if (!env.CHAINGPT_API_KEY) return null;
  try {
    const res = await axios.get(`${CHAINGPT_API_URL}/webhook-subscription/`, {
      headers: {
        "Content-Type": "application/json",
        "Accept-Encoding": "gzip, deflate",
        "api-key": env.CHAINGPT_API_KEY,
      },
    });
    return res?.data?.webhookUrl || null;
  } catch (err) {
    console.error("Error fetching connected webhook:", err);
    return null;
  }
}

async function fetchCategories(): Promise<any[]> {
  if (!env.CHAINGPT_API_KEY) return [];
  try {
    const res = await axios.get(`${CHAINGPT_API_URL}/category-subscription`, {
      headers: {
        "Content-Type": "application/json",
        "Accept-Encoding": "gzip, deflate",
        "api-key": env.CHAINGPT_API_KEY,
      },
    });

    const allCategories = res?.data?.allCategories || [];
    const subscribed = res?.data?.subscribedCategories || [];
    return allCategories.map((c: any) => ({
      ...c,
      isSubscribed: subscribed.some((s: any) => s?.categoryId === c?.id),
    }));
  } catch (err) {
    console.error("Error fetching categories:", err);
    return [];
  }
}

// --- API handlers used by your UI JS ---
export const registerWebhook = async (c: Context): Promise<Response> => {
  try {
    const { url } = await c.req.json<WebhookRegistrationRequest>();
    if (!url) {
      return c.json<ApiResponse>({ success: false, message: "URL is required", error: "Missing url" }, 400);
    }
    if (!env.CHAINGPT_API_KEY) {
      return c.json<ApiResponse>({ success: false, message: "CHAINGPT_API_KEY not set" }, 400);
    }

    const res = await axios.post(`${CHAINGPT_API_URL}/webhook-subscription/register`, { url }, {
      headers: { "api-key": env.CHAINGPT_API_KEY },
    });

    return c.json<ApiResponse>({ success: true, message: "Webhook registered", data: res.data });
  } catch (error: any) {
    console.error("Error registering webhook:", error);
    return c.json<ApiResponse>({
      success: false,
      message: "Failed to register webhook",
      error: error?.message || "Unknown error",
    }, 500);
  }
};

export const subscribeToCategories = async (c: Context): Promise<Response> => {
  try {
    const { categoryIds } = await c.req.json();
    if (!Array.isArray(categoryIds)) {
      return c.json<ApiResponse>({ success: false, message: "categoryIds must be an array" }, 400);
    }
    if (!env.CHAINGPT_API_KEY) {
      return c.json<ApiResponse>({ success: false, message: "CHAINGPT_API_KEY not set" }, 400);
    }

    const res = await axios.post(`${CHAINGPT_API_URL}/category-subscription/subscribe`, { categoryIds }, {
      headers: { "api-key": env.CHAINGPT_API_KEY },
    });

    return c.json<ApiResponse>({ success: true, message: "Categories subscribed", data: res.data });
  } catch (error: any) {
    console.error("Error subscribing to categories:", error);
    return c.json<ApiResponse>({
      success: false,
      message: "Failed to subscribe to categories",
      error: error?.message || "Unknown error",
    }, 500);
  }
};

// Public endpoint to receive external webhook -> post to X
export const tweetWebhook = async (c: Context): Promise<Response> => {
  try {
    const { tweet } = await c.req.json<TweetWebhookRequest>();
    if (!tweet) {
      return c.json<ApiResponse>({ success: false, message: "tweet is required", error: "Missing tweet" }, 400);
    }
    const tweetText = tweet; // you can trim if needed
    const response = await uploadTwitterPostTweet(tweetText);
    return c.json<ApiResponse>({ success: true, message: "Tweet posted", data: { tweetText, response } });
  } catch (error: any) {
    console.error("Error posting tweet via webhook:", error);
    return c.json<ApiResponse>({ success: false, message: "Failed to post tweet", error: error?.message }, 500);
  }
};

// View: /dashboard/live-news
export const renderLiveNews = async (c: Context): Promise<Response> => {
  try {
    const [categories, currentWebhookUrl] = await Promise.all([
      fetchCategories(),
      fetchConnectedWebhook(),
    ]);

    // Render body
    const body = await ejs.renderFile(join(import.meta.dir, "../../views/live-news.ejs"), {
      title: "Live News",
      data: categories,
      currentWebhookUrl,
    });

    // Wrap in layout
    const html = await ejs.renderFile(join(import.meta.dir, "../../views/layout.ejs"), {
      title: "Live News",
      body,
      path: c.req.path,
    });

    return c.html(html);
  } catch (error: any) {
    console.error("Error rendering live news:", error);

    // Graceful fallback: render the page with empty data instead of 500
    const body = await ejs.renderFile(join(import.meta.dir, "../../views/live-news.ejs"), {
      title: "Live News",
      data: [],
      currentWebhookUrl: null,
    });
    const html = await ejs.renderFile(join(import.meta.dir, "../../views/layout.ejs"), {
      title: "Live News",
      body,
      path: c.req.path,
    });
    return c.html(html);
  }
};
