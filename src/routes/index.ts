import { Hono } from "hono";
import webhookRouter from "./webhook.routes";
import tokenRouter from "./token.routes";
import loginRouter from "../routes/login.routes";
import scheduleRouter from "./schedule.routes";
import dashboardRouter from "./dashboard.routes";

// Create a Hono router for API routes
const apiRouter = new Hono();
const viewRouter = new Hono();

// Register API routes
apiRouter.route("/webhook", webhookRouter);
apiRouter.route("/tokens", tokenRouter);
apiRouter.route("/login", loginRouter);
apiRouter.route("/schedule", scheduleRouter);

// View routes
viewRouter.route("/", dashboardRouter);

export { apiRouter, viewRouter };
import { Hono } from "hono";
import { authRouter } from "./auth.route"; // ADD THIS

export const apiRouter = new Hono();

// existing routes...
apiRouter.route("/auth", authRouter); // ADD THIS

