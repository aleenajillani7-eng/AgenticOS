// src/routes/index.ts
import { Hono } from "hono";

// API routers
import { tweetRouter } from "./tweet.route";       // named export
import { mentionRouter } from "./mention.route";   // named export
import scheduleRouter from "./schedule.routes";    // default export
import { authRouter } from "./auth.route";         // named export

// VIEW routers (both are default exports in your repo)
import loginRouter from "./login.routes";
import dashboardRouter from "./dashboard.routes";

// ---- API aggregator ----
export const apiRouter = new Hono();
apiRouter.route("/tweets", tweetRouter);
apiRouter.route("/mentions", mentionRouter);
apiRouter.route("/schedule", scheduleRouter);
apiRouter.route("/auth", authRouter);

// ---- VIEW aggregator ----
// Mount login pages at "/" and dashboard pages at "/dashboard"
export const viewRouter = new Hono();
viewRouter.route("/", loginRouter);
viewRouter.route("/dashboard", dashboardRouter);
