// src/routes/index.ts
import { Hono } from "hono";

// API sub-routers (match file names & export styles EXACTLY)
import { tweetRouter } from "./tweet.route";        // named export
import { mentionRouter } from "./mention.route";    // named export
import scheduleRouter from "./schedule.routes";     // default export
import { authRouter } from "./auth.route";          // named export (matches your file)

// Single API aggregator
export const apiRouter = new Hono();

// Mount under /api/*
apiRouter.route("/tweets", tweetRouter);
apiRouter.route("/mentions", mentionRouter);
apiRouter.route("/schedule", scheduleRouter);
apiRouter.route("/auth", authRouter);
