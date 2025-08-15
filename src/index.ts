// src/index.ts
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";

import { env } from "./config/env";
import { apiRouter, viewRouter } from "./routes";
import { scheduleTweets } from "./jobs/tweet.job";

const app = new Hono();

// Middleware
app.use("*", logger());
app.use("*", prettyJSON());
// (optional) static files if you use them
app.use("/style.css", serveStatic({ root: "./public" }));
app.use("/images/*", serveStatic({ root: "./public" }));

// Health
app.get("/health", (c) => c.json({ ok: true }));

// Mount routers
app.route("/api", apiRouter);   // all API endpoints live under /api/*
app.route("/", viewRouter);     // server-rendered pages at / and /dashboard/*

// Error handler
app.onError((err, c) => {
  console.error("Global Error Handler:", err);
  return c.json(
    { success: false, message: "Internal Server Error", error: (err as Error).message },
    500
  );
});

// Start Bun server
const port = Number(env.PORT) || 3000;
Bun.serve({ fetch: app.fetch, port });
console.log(`🚀 Twitter AI Agent listening on port ${port}`);

// Start tweet scheduler
try {
  scheduleTweets();
} catch (error) {
  console.error("Failed to start tweet scheduler:", error);
}
