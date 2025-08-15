// src/index.ts
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";

import { env } from "./config/env";
import { apiRouter } from "./routes";   // ✅ only import the aggregator
import { scheduleTweets } from "./jobs/tweet.job";

const app = new Hono();

app.use("*", logger());
app.use("*", prettyJSON());
app.use("/style.css", serveStatic({ root: "./public" }));
app.use("/images/*", serveStatic({ root: "./public" }));

app.get("/health", (c) => c.json({ ok: true }));

app.route("/api", apiRouter);           // ✅ mount the aggregator

app.onError((err, c) => {
  console.error("Global Error Handler:", err);
  return c.json(
    { success: false, message: "Internal Server Error", error: (err as Error).message },
    500
  );
});

const port = Number(env.PORT) || 3000;
Bun.serve({ fetch: app.fetch, port });
console.log(`🚀 Twitter AI Agent listening on port ${port}`);

try { scheduleTweets(); } catch (error) {
  console.error("Failed to start tweet scheduler:", error);
}
