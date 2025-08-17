// src/routes/auth.route.ts
import { Hono } from "hono";
import { getAuthUrl, handleCallback } from "../services/auth.service";
import { loadTokens, TOKENS_FILE_PATH } from "../utils/encryption";
import { scheduleTweets } from "../jobs/tweet.job";

export const authRouter = new Hono();

// 1) Begin OAuth (redirect to X)
authRouter.get("/", (c) => {
  const url = getAuthUrl();
  return c.redirect(url);
});

// 2) OAuth callback from X
authRouter.get("/callback", async (c) => {
  try {
    const url = new URL(c.req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state") || "";

    if (!code) {
      return c.json({ error: "Missing OAuth code" }, 400);
    }

    // This should save tokens to the encrypted tokens file
    await handleCallback(code, state);

    // Verify we can decrypt tokens with the current ENCRYPTION_KEY
    await loadTokens(process.env.ENCRYPTION_KEY || "");

    // Start scheduler (mentions removed)
    scheduleTweets();
    console.log("[scheduler] Started after auth");

    return c.json({
      success: true,
      message: "Bot is now authorized ✅",
      tokensSavedAt: TOKENS_FILE_PATH,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Auth callback failed";
    console.error("[auth] callback error:", err);
    return c.json({ error: message }, 500);
  }
});

// 3) Quick status (tokens present?)
authRouter.get("/status", async (c) => {
  try {
    const t = await loadTokens(process.env.ENCRYPTION_KEY || "");
    const present = !!(t as any)?.accessToken || !!(t as any)?.access_token;
    return c.json({ tokensPresent: present, path: TOKENS_FILE_PATH });
  } catch {
    return c.json({ tokensPresent: false, path: TOKENS_FILE_PATH });
  }
});

// 4) Probe decryption explicitly
authRouter.get("/probe", async (c) => {
  try {
    await loadTokens(process.env.ENCRYPTION_KEY || "");
    return c.json({ ok: true, canDecrypt: true, path: TOKENS_FILE_PATH });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Decrypt failed";
    return c.json({ ok: false, canDecrypt: false, error: message, path: TOKENS_FILE_PATH }, 500);
  }
});

export default authRouter;
