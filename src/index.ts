// src/index.ts
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";

import { env } from "./config/env";
import { apiRouter } from "./routes";
import { scheduleTweets } from "./jobs/tweet.job";

const app = new Hono();

// Middleware
app.use("*", logger());
app.use("*", prettyJSON());

// Serve static asset folders (update paths as needed for your build)
app.use("/assets/*", serveStatic({ root: "./public" }));
app.use("/static/*", serveStatic({ root: "./public" }));
app.use("/images/*", serveStatic({ root: "./public" }));
app.use("/favicon.ico", serveStatic({ root: "./public" }));

// Health check
app.get("/health", (c) => c.json({ ok: true }));

// Mount API first so it doesn't get swallowed by SPA fallback
app.route("/api", apiRouter);

// SPA fallback: serve index.html for any non-API route
app.get("/", serveStatic({ path: "./public/index.html" }));
app.get("/*", serveStatic({ path: "./public/index.html" }));

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
