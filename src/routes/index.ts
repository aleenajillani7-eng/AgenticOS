// src/routes/index.ts
import { Hono } from "hono";

// ✅ Import EXACT file names (case-sensitive on Render)
import { tweetRouter } from "./tweet.route";
import { mentionRouter } from "./mention.route";
import scheduleRouter from "./schedule.routes"; // default export

// Single API aggregator
export const apiRouter = new Hono();

// Mount sub-routers at /api/*
apiRouter.route("/tweets", tweetRouter);
apiRouter.route("/mentions", mentionRouter);
apiRouter.route("/schedule", scheduleRouter);

// Add more routers here as you create them, e.g.
// import { authRouter } from "./auth.route";
// apiRouter.route("/auth", authRouter);
