// src/routes/index.ts
import { Hono } from "hono";

// API routers (mentions removed)
import { tweetRouter } from "./tweet.route";
import scheduleRouter from "./schedule.routes";
import webhookRouter from "./webhook.routes";
import { authRouter } from "./auth.route";

// VIEW routers
import loginRouter from "./login.routes";
import dashboardRouter from "./dashboard.routes";

// ---- API aggregator ----
export const apiRouter = new Hono();
apiRouter.route("/tweets", tweetRouter);
apiRouter.route("/schedule", scheduleRouter);
apiRouter.route("/webhook", webhookRouter);
apiRouter.route("/auth", authRouter);

// ---- VIEW aggregator ----
export const viewRouter = new Hono();
viewRouter.route("/", loginRouter);
viewRouter.route("/dashboard", dashboardRouter);
