// src/routes/dashboard.routes.ts
import { Hono } from "hono";
import { ScheduleController } from "../controllers/schedule.controller";
import { renderLiveNews } from "../controllers/webhook.controller";
import { renderMentions } from "../controllers/mentions.controller";

const dashboardRouter = new Hono();

dashboardRouter.get("/", ScheduleController.getSchedule);
dashboardRouter.get("/live-news", renderLiveNews);
dashboardRouter.get("/mentions", renderMentions);   // ⬅️ new page

export default dashboardRouter;
