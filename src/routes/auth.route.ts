// src/routes/auth.route.ts
import { Hono } from "hono";
import { getAuthUrl, handleCallback } from "../services/auth.service";
import { env } from "../config/env";
import {
  saveTokens,
  loadTokens,
  TOKENS_FILE_PATH,
  tokensFileExists,
  deleteTokensFile,
} from "../utils/encryption";
import { scheduleTweets } from "../jobs/tweet.job"; // optional: start scheduler after auth

export const authRouter = new Hono();

// Start OAuth
authRouter.get("/", async (c) => c.redirect(await getAuthUrl()));

// OAuth callback: save tokens; then (optionally) verify & start scheduler
authRouter.get("/callback", async (c) => {
  try {
    const url = new URL(c.req.url);
    const code = url.searchParams.get("code") || "";
    const state = url.searchParams.get("state") || "";

    const t = await handleCallback(code, state);
    await saveTokens(t.access_token, t.refresh_token, env.ENCRYPTION_KEY);

    // optional: probe and start scheduler immediately
    try {
      await loadTokens(env.ENCRYPTION_KEY);
      scheduleTweets();
      console.log("[scheduler] Started after auth");
    } catch (e) {
      console.warn("[scheduler] Not started after auth (probe failed):", (e as Error).message);
    }

    return c.json({
      success: true,
      message: "Authorized. Use /api/auth/status or /api/auth/probe to verify.",
      path: TOKENS_FILE_PATH,
    });
  } catch (err: any) {
    console.error("[auth] callback error:", err);
    return c.json({ success: false, error: err?.message || "Auth callback failed" }, 500);
  }
});

// Helpers
authRouter.get("/status", (c) =>
  c.json({ tokensPresent: tokensFileExists(), path: TOKENS_FILE_PATH })
);

authRouter.get("/probe", async (c) => {
  try {
    await loadTokens(env.ENCRYPTION_KEY);
    return c.json({ ok: true, canDecrypt: true, path: TOKENS_FILE_PATH });
  } catch (err: any) {
    return c.json(
      { ok: false, canDecrypt: false, error: err?.message || String(err), path: TOKENS_FILE_PATH },
      500
    );
  }
});

authRouter.get("/reset", (c) => {
  const deleted = deleteTokensFile();
  return c.json({ success: true, deleted, path: TOKENS_FILE_PATH });
});
