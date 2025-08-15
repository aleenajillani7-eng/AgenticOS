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

// (Optional) static assets if you have a /public folder
app.use("/assets/*", serveStatic({ root: "./public" }));
app.use("/images/*", serveStatic({ root: "./public" }));
app.use("/favicon.ico", serveStatic({ root: "./public" }));

// Health check
app.get("/health", (c) => c.json({ ok: true }));

// Mount all API endpoints at /api (this includes /api/auth once you export it)
app.route("/api", apiRouter);

// Root page (responds to GET/HEAD)
app.all("/", (c) =>
  c.html(String.raw`<!doctype html>
<html>
  <head><meta charset="utf-8"><title>AgenticOS</title></head>
  <body>
    <h1>AgenticOS is running</h1>
    <p>Health: <a href="/health">/health</a></p>
    <p>API base: <code>/api</code></p>
  </body>
</html>`)
);

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

// Start tweet scheduler (keep your existing logic)
try {
  scheduleTweets();
} catch (error) {
  console.error("Failed to start tweet scheduler:", error);
}
