// src/services/auth.service.ts
import { randomBytes, createHash } from "crypto";
import { existsSync } from "fs";
import { saveTokens, TOKENS_FILE_PATH, TwitterTokens } from "../utils/encryption";

const CLIENT_ID = process.env.TWITTER_CLIENT_ID!;
const CLIENT_SECRET = process.env.TWITTER_CLIENT_SECRET!;
const REDIRECT_URI = process.env.TWITTER_REDIRECT_URI!;
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY!;
const TOKEN_URL = "https://api.twitter.com/2/oauth2/token";
const AUTH_BASE = "https://twitter.com/i/oauth2/authorize";

const verifierStore = new Map<string, string>();

function b64url(input: Buffer | string) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function sha256Buf(input: string) {
  return createHash("sha256").update(input).digest();
}

export function getAuthUrl(): string {
  const code_verifier = b64url(randomBytes(32));
  const code_challenge = b64url(sha256Buf(code_verifier));
  const state = b64url(randomBytes(16));

  verifierStore.set(state, code_verifier);

  const scope = ["tweet.read", "tweet.write", "users.read", "offline.access"].join(" ");

  const url = new URL(AUTH_BASE);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("scope", scope);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", code_challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

function normalizeTokens(raw: any): TwitterTokens {
  const now = Date.now();
  return {
    token_type: raw.token_type,
    tokenType: raw.token_type,
    expires_in: raw.expires_in,
    expiresIn: raw.expires_in,
    access_token: raw.access_token,
    accessToken: raw.access_token,
    scope: raw.scope,
    refresh_token: raw.refresh_token,
    refreshToken: raw.refresh_token,
    created_at: now,
  };
}

export async function handleCallback(code: string, state: string) {
  const code_verifier = verifierStore.get(state);
  if (!code_verifier) throw new Error("Missing or expired PKCE verifier (invalid state). Try auth again.");
  verifierStore.delete(state);

  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("client_id", CLIENT_ID);
  body.set("redirect_uri", REDIRECT_URI);
  body.set("code_verifier", code_verifier);
  body.set("code", code);

  const basicAuth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { Authorization: `Basic ${basicAuth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${text}`);
  }

  const raw = await res.json();
  const toSave = normalizeTokens(raw);

  if (!ENCRYPTION_KEY) throw new Error("ENCRYPTION_KEY is not set");
  await saveTokens(toSave, ENCRYPTION_KEY);

  if (!existsSync(TOKENS_FILE_PATH)) {
    console.error(`[auth] saveTokens completed but file not found at ${TOKENS_FILE_PATH}`);
    throw new Error("Token save failed (file missing after save). Check TOKENS_FILE_PATH and /data disk.");
  } else {
    console.log(`[auth] Tokens saved to ${TOKENS_FILE_PATH}`);
  }

  return toSave;
}
