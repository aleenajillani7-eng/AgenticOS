import { Hono } from "hono";
import { getAuthUrl, handleCallback } from "../services/auth.service";

export const authRouter = new Hono();

// Step 1 — Redirect user to Twitter OAuth
authRouter.get("/", async (c) => {
  const authUrl = getAuthUrl();
  return c.redirect(authUrl);
});

// Step 2 — Handle Twitter callback
authRouter.get("/callback", async (c) => {
  try {
    const url = new URL(c.req.url);
    const code = url.searchParams.get("code");

    if (!code) {
      return c.json({ error: "Missing OAuth code" }, 400);
    }

    const result = await handleCallback(code);

    return c.json({
      success: true,
      message: "Bot is now authorized to reply to mentions 🚀",
      tokens: result,
    });
  } catch (error) {
    console.error("Auth callback error:", error);
    return c.json({ error: error.message }, 500);
  }
});
