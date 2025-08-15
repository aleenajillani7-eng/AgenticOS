// src/routes/mention.route.ts
import { Hono } from "hono";
import authMiddleware from "../middleware/auth.middleware";
import { runMentionsOnce } from "../jobs/mentions.job";
import { dirname, join } from "path";
import { TOKENS_FILE_PATH } from "../utils/encryption";
import { existsSync, readFileSync } from "fs";

export const mentionRouter = new Hono();

// simple in-memory lock to avoid overlapping runs
let isRunning = false;

// Liveness
mentionRouter.get("/", (c) =>
  c.json({ success: true, message: "Mentions endpoint is live." })
);

// Status: last sinceId, backoff window, and whether a run is in-flight
mentionRouter.get("/status", (c) => {
  const path = join(dirname(TOKENS_FILE_PATH), "mentions-state.json");
  let sinceId: string | undefined;
  let nextAllowedAt: number | undefined;
  let lastRunAt: number | undefined;

  if (existsSync(path)) {
    try {
      const s = JSON.parse(readFileSync(path, "utf8")) as {
        sinceId?: string;
        nextAllowedAt?: number;
        lastRunAt?: number;
      };
      sinceId = s.sinceId;
      nextAllowedAt = s.nextAllowedAt;
      lastRunAt = s.lastRunAt;
    } catch {}
  }
  return c.json({ ok: true, sinceId, nextAllowedAt, lastRunAt, statePath: path, running: isRunning });
});

// Manual one-off run, **non-blocking**: starts in background and returns 202 immediately
mentionRouter.post("/run", authMiddleware, async (c) => {
  if (isRunning) {
    return c.json({ ok: false, error: "runner_busy" }, 429);
  }

  isRunning = true;
  (async () => {
    try {
      const res = await runMentionsOnce({ manual: true });
      console.log("[mentions] manual run result:", res);
    } catch (e) {
      console.error("[mentions] manual run error:", e);
    } finally {
      isRunning = false;
    }
  })();

  return c.json({ ok: true, started: true, note: "Runner started in background" }, 202);
});
