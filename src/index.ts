// src/index.ts
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";

import { env } from "./config/env";
import { apiRouter, viewRouter } from "./routes";
import { scheduleTweets } from "./jobs/tweet.job";

import { existsSync } from "fs";
import { loadTokens, TOKENS_FILE_PATH } from "./utils/encryption";

const app = new Hono();

// Middleware
app.use("*", logger());
app.use("*", prettyJSON());
app.use("/style.css", serveStatic({ root: "./public" }));
app.use("/images/*", serveStatic({ root: "./public" }));

// Health
app.get("/health", (c) => c.json({ ok: true }));

// Routers
app.route("/api", apiRouter);   // /api/*
app.route("/", viewRouter);     // / and /dashboard/*

// Global error handler
app.onError((err, c) => {
  console.error("Global Error Handler:", err);
  return c.json(
    { success: false, message: "Internal Server Error", error: (err as Error).message },
    500
  );
});

// Start server
const port = Number(env.PORT) || 3000;
Bun.serve({ fetch: app.fetch, port });
console.log(`🚀 Twitter AI Agent listening on port ${port}`);

// Start scheduler ONLY if tokens exist and decrypt successfully
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
