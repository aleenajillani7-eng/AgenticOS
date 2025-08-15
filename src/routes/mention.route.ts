// src/routes/mention.route.ts
import { Hono } from "hono";
import authMiddleware from "../middleware/auth.middleware";
import { runMentionsOnce } from "../jobs/mentions.job";
import { dirname, join } from "path";
import { TOKENS_FILE_PATH } from "../utils/encryption";
import { existsSync, readFileSync } from "fs";

export const mentionRouter = new Hono();

// Liveness
mentionRouter.get("/", (c) =>
  c.json({ success: true, message: "Mentions endpoint is live." })
);

// Status: last sinceId (if any)
mentionRouter.get("/status", (c) => {
  const path = join(dirname(TOKENS_FILE_PATH), "mentions-state.json");
  let sinceId: string | undefined;
  let nextAllowedAt: number | undefined;

  if (existsSync(path)) {
    try {
      const s = JSON.parse(readFileSync(path, "utf8")) as { sinceId?: string; nextAllowedAt?: number };
      sinceId = s.sinceId;
      nextAllowedAt = s.nextAllowedAt;
    } catch {}
  }
  return c.json({ ok: true, sinceId, nextAllowedAt, statePath: path });
});

// Manual one-off run
mentionRouter.post("/run", authMiddleware, async (c) => {
  const res = await runMentionsOnce({ manual: true });
  return c.json({ ok: true, ...res });
});
