// src/index.ts (only the scheduler part)
import { existsSync } from "fs";
import { loadTokens, TOKENS_FILE_PATH } from "./utils/encryption";

// Start Bun server above… then:
(async () => {
  try {
    if (existsSync(TOKENS_FILE_PATH)) {
      await loadTokens(process.env.ENCRYPTION_KEY || "");
      scheduleTweets();
      console.log("[scheduler] Started");
    } else {
      console.warn(`[scheduler] Skipped: tokens not found at ${TOKENS_FILE_PATH}`);
    }
  } catch (err) {
    console.error("[scheduler] Skipped: token decrypt failed ->", (err as Error).message);
  }
})();
