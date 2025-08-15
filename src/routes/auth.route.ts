// src/routes/auth.route.ts
import { Hono } from "hono";
import { getAuthUrl, handleCallback } from "../services/auth.service";

export const authRouter = new Hono();

// Step 1 — Redirect user to Twitter OAuth
authRouter.get("/", (c) => {
  const authUrl = getAuthUrl();
  return c.redirect(authUrl);
});

// Optional alias so /api/auth/login also works
authRouter.get("/login", (c) => c.redirect(getAuthUrl()));

// Step 2 — Handle Twitter callback
authRouter.get("/callback", async (c) => {
  try {
    const url = new URL(c.req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");

    if (!code || !state) {
      return c.json({ error: "Missing OAuth code/state" }, 400);
    }

    const result = await handleCallback(code, state);

    return c.json({
      success: true,
      message: "Bot is now authorized to reply to mentions 🚀",
      tokens: result,
    });
  } catch (error: any) {
    console.error("Auth callback error:", error);
    return c.json({ error: error.message }, 500);
  }
});
