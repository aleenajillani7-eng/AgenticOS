import { Hono } from "hono";
import { authRouter } from "./auth.route";
import { tweetRouter } from "./tweet.route";
import { mentionRouter } from "./mention.route";

export const apiRouter = new Hono();

// API routes
apiRouter.route("/auth", authRouter);
apiRouter.route("/tweets", tweetRouter);
apiRouter.route("/mentions", mentionRouter);
