// src/routes/dashboard.routes.ts
import { Hono } from "hono";
import { ScheduleController } from "../controllers/schedule.controller";
import { renderLiveNews } from "../controllers/webhook.controller";

const dashboardRouter = new Hono();

// Keep only scheduler & live news pages
dashboardRouter.get("/", ScheduleController.getSchedule);
dashboardRouter.get("/live-news", renderLiveNews);

export default dashboardRouter;
