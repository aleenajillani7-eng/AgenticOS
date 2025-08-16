// src/routes/index.ts
import { Hono } from "hono";

// API routers
import { tweetRouter } from "./tweet.route";
import { mentionRouter } from "./mention.route";
import scheduleRouter from "./schedule.routes";
import webhookRouter from "./webhook.routes";
import { authRouter } from "./auth.route";
import twitterRouter from "./twitter.route"; // ⬅️ NEW

// VIEW routers
import loginRouter from "./login.routes";
import dashboardRouter from "./dashboard.routes";

// ---- API aggregator ----
export const apiRouter = new Hono();
apiRouter.route("/tweets", tweetRouter);
apiRouter.route("/mentions", mentionRouter);
apiRouter.route("/schedule", scheduleRouter);
apiRouter.route("/webhook", webhookRouter);
apiRouter.route("/auth", authRouter);
apiRouter.route("/twitter", twitterRouter); // ⬅️ NEW

// ---- VIEW aggregator ----
export const viewRouter = new Hono();
viewRouter.route("/", loginRouter);
viewRouter.route("/dashboard", dashboardRouter);
