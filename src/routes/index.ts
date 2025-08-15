// src/routes/index.ts
import { Hono } from "hono";
import { tweetRouter } from "./tweet.route";
import { mentionRouter } from "./mention.route";

export const apiRouter = new Hono();

// Mount child routers
apiRouter.route("/tweets", tweetRouter);
apiRouter.route("/mentions", mentionRouter);
