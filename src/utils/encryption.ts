// src/utils/encryption.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import path, { join, dirname } from "path";

export type TwitterTokens = {
  token_type?: string;
  tokenType?: string;
  expires_in?: number;
  expiresIn?: number;
  access_token?: string;
  accessToken?: string;
  scope?: string;
  refresh_token?: string;
  refreshToken?: string;
  created_at: number;
};

// ---------- stable path resolution (absolute) ----------
function isDirWritable(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true });
    const tmp = join(dir, ".__write_test.tmp");
    writeFileSync(tmp, "ok");
    unlinkSync(tmp);
    return true;
  } catch {
    return false;
  }
}

// project root = two levels up from this file: src/utils → (..) → src → (..) → repo root
const REPO_ROOT = path.resolve(import.meta.dir, "../..");

function resolveTokensPath(): string {
  const fromEnv = process.env.TOKENS_FILE_PATH;
  if (fromEnv) {
    // Make env relative to project root if not absolute
    const abs = path.isAbsolute(fromEnv) ? fromEnv : path.join(REPO_ROOT, fromEnv);
    return abs;
  }

  // Prefer Render disk (/data) if writable
  if (isDirWritable("/data")) return "/data/tokens.json";

  // Fallback to repo-local data directory
  const localDir = path.join(REPO_ROOT, "data");
  mkdirSync(localDir, { recursive: true });
  return path.join(localDir, "tokens.json");
}

// Single source of truth (absolute path)
export const TOKENS_FILE_PATH = resolveTokensPath();

// Some parts of the code import this:
export function tokenAlreadyExists(): boolean {
  return existsSync(TOKENS_FILE_PATH);
}

// ---------- crypto helpers ----------
const te = new TextEncoder();
const td = new TextDecoder();

async function deriveAesKey(passphrase: string, salt: Uint8Array) {
  const material = await crypto.subtle.importKey("raw", te.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 310_000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function saveTokens(tokens: TwitterTokens, passphrase: string): Promise<void> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveAesKey(passphrase, salt);

  const plaintext = te.encode(JSON.stringify(tokens));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext));

  mkdirSync(dirname(TOKENS_FILE_PATH), { recursive: true });

  const payload = {
    iv: Buffer.from(iv).toString("base64"),
    salt: Buffer.from(salt).toString("base64"),
    data: Buffer.from(ciphertext).toString("base64"),
    created_at: tokens.created_at ?? Date.now(),
  };

  console.log(`[tokens] Saving tokens to ${TOKENS_FILE_PATH}`);
  writeFileSync(TOKENS_FILE_PATH, JSON.stringify(payload), "utf8");
}

export async function loadTokens(passphrase: string): Promise<TwitterTokens> {
  console.log(`[tokens] Loading tokens from ${TOKENS_FILE_PATH}`);

  if (!existsSync(TOKENS_FILE_PATH)) {
    console.error(`[tokens] Not found at ${TOKENS_FILE_PATH}`);
    throw new Error("Twitter tokens file not found. Please set up tokens first.");
  }

  const raw = readFileSync(TOKENS_FILE_PATH, "utf8");
  const { iv, salt, data } = JSON.parse(raw);

  const key = await deriveAesKey(passphrase, Buffer.from(salt, "base64"));
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: Buffer.from(iv, "base64") },
    key,
    Buffer.from(data, "base64")
  );

  return JSON.parse(td.decode(plaintext)) as TwitterTokens;
}
