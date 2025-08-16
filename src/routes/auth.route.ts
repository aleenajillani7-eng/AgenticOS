// src/services/auth.service.ts
import axios from "axios";
import { env } from "../config/env";

/**
 * We embed the PKCE code_verifier inside the OAuth state token, signed (HMAC-SHA256)
 * with ENCRYPTION_KEY so we don't need server-side storage.
 */

type OAuthStatePayloadV1 = {
  v: 1;
  cv: string;   // code_verifier
  t: number;    // timestamp ms
};

function toBytes(s: string) {
  return new TextEncoder().encode(s);
}
function fromBytes(b: Uint8Array) {
  return new TextDecoder().decode(b);
}
function b64url(data: Uint8Array | string): string {
  const buf = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return new Uint8Array(Buffer.from(b64, "base64"));
}

async function hmacSha256(keyRaw: string, msg: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    toBytes(keyRaw),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, toBytes(msg));
  return new Uint8Array(sig);
}

function randomBytesURLSafe(n: number): string {
  const u8 = crypto.getRandomValues(new Uint8Array(n));
  return b64url(u8);
}

async function makeSignedState(codeVerifier: string): Promise<string> {
  const payload: OAuthStatePayloadV1 = { v: 1, cv: codeVerifier, t: Date.now() };
  const payloadStr = JSON.stringify(payload);
  const sig = await hmacSha256(env.ENCRYPTION_KEY, payloadStr);
  return `${b64url(payloadStr)}.${b64url(sig)}`;
}

async function parseSignedState(state: string): Promise<OAuthStatePayloadV1> {
  const [payloadB64, sigB64] = state.split(".");
  if (!payloadB64 || !sigB64) throw new Error("Invalid state token format");

  const payloadStr = fromBytes(b64urlToBytes(payloadB64));
  const expectedSig = await hmacSha256(env.ENCRYPTION_KEY, payloadStr);
  const gotSig = b64urlToBytes(sigB64);

  // constant-time compare
  if (expectedSig.length !== gotSig.length) throw new Error("Invalid state signature");
  let ok = 0;
  for (let i = 0; i < expectedSig.length; i++) ok |= expectedSig[i] ^ gotSig[i];
  if (ok !== 0) throw new Error("Invalid state signature");

  const payload = JSON.parse(payloadStr) as OAuthStatePayloadV1;
  if (payload.v !== 1 || typeof payload.cv !== "string") throw new Error("Invalid state payload");
  // Optional: expire state after 10 minutes
  if (Date.now() - payload.t > 10 * 60 * 1000) throw new Error("State expired, restart auth");
  return payload;
}

function sha256(data: Uint8Array): Promise<Uint8Array> {
  return crypto.subtle.digest("SHA-256", data).then((b) => new Uint8Array(b));
}

async function codeChallengeS256(codeVerifier: string): Promise<string> {
  const digest = await sha256(toBytes(codeVerifier));
  return b64url(digest);
}

/** Build the Twitter OAuth URL with PKCE and signed state */
export async function getAuthUrl(): Promise<string> {
  const {
    TWITTER_CLIENT_ID,
    TWITTER_REDIRECT_URI,
  } = env;

  const codeVerifier = randomBytesURLSafe(64);
  const codeChallenge = await codeChallengeS256(codeVerifier);
  const state = await makeSignedState(codeVerifier);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: TWITTER_CLIENT_ID,
    redirect_uri: TWITTER_REDIRECT_URI,
    scope: "tweet.read tweet.write users.read offline.access",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  return `https://twitter.com/i/oauth2/authorize?${params.toString()}`;
}

/** Exchange the authorization code for access/refresh tokens */
export async function handleCallback(code: string, state?: string): Promise<{
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}> {
  const {
    TWITTER_CLIENT_ID,
    TWITTER_CLIENT_SECRET,
    TWITTER_REDIRECT_URI,
  } = env;

  if (!state) throw new Error("Missing state");
  const parsed = await parseSignedState(state);
  const code_verifier = parsed.cv;

  const form = new URLSearchParams();
  form.set("grant_type", "authorization_code");
  form.set("code", code);
  form.set("redirect_uri", TWITTER_REDIRECT_URI);
  form.set("code_verifier", code_verifier);
  form.set("client_id", TWITTER_CLIENT_ID);

  const res = await axios.post(
    "https://api.twitter.com/2/oauth2/token",
    form,
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      auth: { username: TWITTER_CLIENT_ID, password: TWITTER_CLIENT_SECRET },
    }
  );

  const data = res.data as {
    token_type: string;
    expires_in: number;
    access_token: string;
    scope: string;
    refresh_token: string;
  };

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    token_type: data.token_type,
    expires_in: data.expires_in,
    scope: data.scope,
  };
}
