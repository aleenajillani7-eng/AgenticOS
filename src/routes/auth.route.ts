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

export const authRouter = new Hono();

// Kick off OAuth
authRouter.get("/", (c) => c.redirect(getAuthUrl()));

// OAuth callback: save tokens only, don't decrypt here
authRouter.get("/callback", async (c) => {
  try {
    const url = new URL(c.req.url);
    const code = url.searchParams.get("code");
    if (!code) return c.json({ success: false, error: "Missing OAuth code" }, 400);

    const t = await handleCallback(code);
    // Save with your passphrase; do not verify here
    await saveTokens(t.access_token, t.refresh_token, env.ENCRYPTION_KEY);
    console.log("[auth] Tokens saved to", TOKENS_FILE_PATH);

    // Return success; you can verify via /api/auth/probe
    return c.json({
      success: true,
      message: "Bot authorized. Use /api/auth/probe to verify decryption.",
      path: TOKENS_FILE_PATH,
    });
  } catch (err: any) {
    const message = err?.message || "Auth callback failed";
    console.error("[auth] callback error:", err);
    return c.json({ success: false, error: message }, 500);
  }
});

// Is there a tokens file?
authRouter.get("/status", (c) =>
  c.json({ tokensPresent: tokensFileExists(), path: TOKENS_FILE_PATH })
);

// Try decrypting with current ENCRYPTION_KEY
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

// Remove tokens to re-auth cleanly
authRouter.get("/reset", (c) => {
  const deleted = deleteTokensFile();
  return c.json({ success: true, deleted, path: TOKENS_FILE_PATH });
});
