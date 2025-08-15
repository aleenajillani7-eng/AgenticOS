// src/index.ts
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";

import { env } from "./config/env";
import { apiRouter, viewRouter } from "./routes"; // <- only import routers from routes aggregator
import { scheduleTweets } from "./jobs/tweet.job";

// Create Hono app
const app = new Hono();

// Middleware
app.use("*", logger());
app.use("*", prettyJSON());
app.use("/style.css", serveStatic({ root: "./public" }));
app.use("/images/*", serveStatic({ root: "./public" }));

// Health check (optional)
app.get("/health", (c) => c.json({ ok: true }));

// Mount routers
app.route("/api", apiRouter);
app.route("/", viewRouter);

// Error handling middleware
app.onError((err, c) => {
  console.error("Global Error Handler:", err);
  return c.json(
    {
      success: false,
      message: "Internal Server Error",
      error: (err as Error).message,
    },
    500
  );
});

// Start the server with Bun
const port = Number(env.PORT) || 3000;
console.log(`Starting server in ${env.NODE_ENV} mode...`);

Bun.serve({
  fetch: app.fetch,
  port,
});

console.log(`🚀 Twitter AI Agent listening on port ${port}`);

// Start tweet scheduler
try {
  scheduleTweets();
} catch (error) {
  console.error("Failed to start tweet scheduler:", error);
}
