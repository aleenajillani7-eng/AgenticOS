// src/utils/encryption.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "fs";
import { join } from "path";

export type TwitterTokens = {
  accessToken: string;
  refreshToken: string;
};

const DATA_DIR = join(import.meta.dir, "../../data");
export const TOKENS_FILE_PATH = join(DATA_DIR, "tokens.json");

type EncryptedBlobV2 = {
  version: 2;
  kdf: "PBKDF2-SHA256";
  rounds: number;        // 100_000
  salt: string;          // base64
  iv: string;            // base64 (12 bytes)
  ciphertext: string;    // base64
  createdAt: number;
};

function toBytes(s: string) {
  return new TextEncoder().encode(s);
}
function fromBytes(b: Uint8Array) {
  return new TextDecoder().decode(b);
}
function b64e(buf: Uint8Array) {
  return Buffer.from(buf).toString("base64");
}
function b64d(b64: string) {
  return new Uint8Array(Buffer.from(b64, "base64"));
}

async function deriveKey(passphrase: string, salt: Uint8Array) {
  const keyMaterial = await crypto.subtle.importKey("raw", toBytes(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function saveTokens(
  accessToken: string,
  refreshToken: string,
  passphrase: string
): Promise<void> {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);

  const plaintext = toBytes(JSON.stringify({ accessToken, refreshToken } as TwitterTokens));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext)
  );

  const blob: EncryptedBlobV2 = {
    version: 2,
    kdf: "PBKDF2-SHA256",
    rounds: 100_000,
    salt: b64e(salt),
    iv: b64e(iv),
    ciphertext: b64e(ciphertext),
    createdAt: Date.now(),
  };

  writeFileSync(TOKENS_FILE_PATH, JSON.stringify(blob, null, 2));
  console.log(`[tokens] Saving tokens to ${TOKENS_FILE_PATH}`);
}

export async function loadTokens(passphrase: string): Promise<TwitterTokens> {
  console.log(`[tokens] Loading tokens from ${TOKENS_FILE_PATH}`);

  if (!existsSync(TOKENS_FILE_PATH)) {
    console.error(`[tokens] Not found at ${TOKENS_FILE_PATH}`);
    throw new Error("Twitter tokens file not found. Please set up tokens first.");
  }

  const raw = readFileSync(TOKENS_FILE_PATH, "utf8");

  try {
    const parsed = JSON.parse(raw);

    // V2 encrypted format
    if (parsed?.version === 2 && parsed?.ciphertext && parsed?.salt && parsed?.iv) {
      const salt = b64d(parsed.salt);
      const iv = b64d(parsed.iv);
      const key = await deriveKey(passphrase, salt);

      try {
        const plain = new Uint8Array(
          await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, b64d(parsed.ciphertext))
        );
        const obj = JSON.parse(fromBytes(plain));
        if (!obj?.accessToken || !obj?.refreshToken) {
          throw new Error("Decrypted content missing tokens");
        }
        return obj as TwitterTokens;
      } catch {
        throw new Error(
          "Decryption failed (likely wrong ENCRYPTION_KEY or corrupted tokens file). Reset tokens and re-authorize."
        );
      }
    }

    // Legacy plaintext fallback (allow one-time migration if present)
    if (parsed?.accessToken && parsed?.refreshToken) {
      return parsed as TwitterTokens;
    }

    throw new Error("Unrecognized tokens file format. Reset tokens and re-authorize.");
  } catch (e: any) {
    if (e?.message?.includes("Decryption failed")) throw e;
    console.error("[tokens] loadTokens parse error:", e);
    throw new Error("Invalid tokens file. Reset tokens and re-authorize.");
  }
}

export function tokensFileExists(): boolean {
  return existsSync(TOKENS_FILE_PATH);
}

export function deleteTokensFile(): boolean {
  try {
    if (existsSync(TOKENS_FILE_PATH)) {
      rmSync(TOKENS_FILE_PATH);
      return true;
    }
    return false;
  } catch (e) {
    console.error("[tokens] delete error:", e);
    return false;
  }
}

/** ✅ Back-compat alias for older imports */
export function tokenAlreadyExists(): boolean {
  return tokensFileExists();
}
