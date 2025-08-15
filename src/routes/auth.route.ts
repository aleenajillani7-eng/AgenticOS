// src/routes/auth.route.ts
import { Hono } from "hono";
import { existsSync, writeFileSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { getAuthUrl, handleCallback } from "../services/auth.service";
import { TOKENS_FILE_PATH, loadTokens } from "../utils/encryption";

export const authRouter = new Hono();

// Start OAuth (also allow /login as alias)
authRouter.get("/", (c) => c.redirect(getAuthUrl()));
authRouter.get("/login", (c) => c.redirect(getAuthUrl()));

// OAuth callback — save tokens, do NOT return them
authRouter.get("/callback", async (c) => {
  try {
    const url = new URL(c.req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) return c.json({ success: false, error: "Missing OAuth code/state" }, 400);

    await handleCallback(code, state);
    return c.json({ success: true, message: "Bot is now authorized to reply to mentions 🚀" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Auth failed (unknown error)";
    console.error("Auth callback error:", err);
    return c.json({ success: false, error: message }, 500);
  }
});

// -------- Diagnostics (no secrets) --------

// File exists?
authRouter.get("/status", (c) => {
  const present = existsSync(TOKENS_FILE_PATH);
  return c.json({ tokensPresent: present, path: TOKENS_FILE_PATH });
});

// Can decrypt with current ENCRYPTION_KEY?
authRouter.get("/probe", async (c) => {
  try {
    const key = process.env.ENCRYPTION_KEY || "";
    await loadTokens(key);
    return c.json({ ok: true, canDecrypt: true });
  } catch (e: any) {
    return c.json({ ok: false, canDecrypt: false, error: e?.message || "decrypt failed" }, 500);
  }
});

// Is /data writable? Is key set? (detect missing disk or env)
authRouter.get("/debug", (c) => {
  const dir = dirname(TOKENS_FILE_PATH);
  let canWrite = false;
  try {
    const testFile = join(dir, "._write_test.tmp");
    writeFileSync(testFile, "ok");
    unlinkSync(testFile);
    canWrite = true;
  } catch {}
  const keyLen = (process.env.ENCRYPTION_KEY || "").length;
  return c.json({
    path: TOKENS_FILE_PATH,
    dir,
    dirWritable: canWrite,
    encryptionKeySet: keyLen > 0,
    encryptionKeyLen: keyLen,
  });
});

// Danger reset (deletes tokens file). Use: /api/auth/reset?confirm=DELETE
authRouter.get("/reset", (c) => {
  const url = new URL(c.req.url);
  const confirm = url.searchParams.get("confirm");
  if (confirm !== "DELETE") {
    return c.json({ ok: false, error: "Add ?confirm=DELETE to reset tokens (destructive)" }, 400);
  }
  try {
    if (existsSync(TOKENS_FILE_PATH)) unlinkSync(TOKENS_FILE_PATH);
    return c.json({ ok: true, reset: true, path: TOKENS_FILE_PATH });
  } catch (e: any) {
    return c.json({ ok: false, reset: false, error: e?.message || "failed to delete" }, 500);
  }
});
