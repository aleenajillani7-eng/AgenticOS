// src/routes/index.ts
import { Hono } from "hono";

// API routers
import { tweetRouter } from "./tweet.route";
import { mentionRouter } from "./mention.route";
import scheduleRouter from "./schedule.routes";
import { authRouter } from "./auth.route";

// VIEW routers (default exports in your repo)
import loginRouter from "./login.routes";
import dashboardRouter from "./dashboard.routes";

// ---- API aggregator ----
export const apiRouter = new Hono();
apiRouter.route("/tweets", tweetRouter);
apiRouter.route("/mentions", mentionRouter);
apiRouter.route("/schedule", scheduleRouter);
apiRouter.route("/auth", authRouter); // <-- ensures /api/auth/* exists

// ---- VIEW aggregator ----
export const viewRouter = new Hono();
viewRouter.route("/", loginRouter);
viewRouter.route("/dashboard", dashboardRouter);
