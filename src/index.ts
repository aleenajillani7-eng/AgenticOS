// src/index.ts
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";

import { env } from "./config/env";
import { apiRouter } from "./routes";   // ✅ routes aggregator
import { scheduleTweets } from "./jobs/tweet.job";

const app = new Hono();

// Middleware
app.use("*", logger());
app.use("*", prettyJSON());
app.use("/style.css", serveStatic({ root: "./public" }));
app.use("/images/*", serveStatic({ root: "./public" }));

// Health check
app.get("/health", (c) => c.json({ ok: true }));

// Home page at "/"
app.get("/", (c) =>
  c.html(`<!doctype html>
<html>
  <head><meta charset="utf-8"><title>AgenticOS</title></head>
  <body>
    <h1>AgenticOS is running</h1>
    <p>Health: <a href="/health">/health</a></p>
    <p>API base: <code>/api</code></p>
  </bod
