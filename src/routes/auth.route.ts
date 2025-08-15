// src/routes/auth.route.ts
import { Hono } from "hono";
import { existsSync } from "fs";
import { getAuthUrl, handleCallback } from "../services/auth.service";

export const authRouter = new Hono();

const TOKENS_FILE_PATH = process.env.TOKENS_FILE_PATH ?? "/data/tokens.json";

// Start OAuth (both /api/auth and /api/auth/login)
authRouter.get("/", (c) => c.redirect(getAuthUrl()));
authRouter.get("/login", (c) => c.redirect(getAuthUrl()));

// OAuth callback — save tokens, but don't return them
authRouter.get("/callback", async (c) => {
  try {
    const url = new URL(c.req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");

    if (!code || !state) {
      return c.json({ success: false, error: "Missing OAuth code/state" }, 400);
    }

    await handleCallback(code, state);

    return c.json({
      success: true,
      message: "Bot is now authorized to reply to mentions 🚀",
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Auth failed (unknown error)";
    console.error("Auth callback error:", err);
    return c.json({ success: false, error: message }, 500);
  }
});

// Simple status endpoint to confirm tokens file exists (no secrets returned)
authRouter.get("/status", (c) => {
  const present = existsSync(TOKENS_FILE_PATH);
  return c.json({ tokensPresent: present });
});
