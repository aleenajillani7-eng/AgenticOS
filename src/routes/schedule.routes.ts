import { Hono } from "hono";
import { ScheduleController } from "../controllers/schedule.controller";
import authMiddleware from "../middleware/auth.middleware";

const scheduleRouter = new Hono();

// Apply auth middleware to all routes
scheduleRouter.use("/*", authMiddleware);

// scheduleRouter.get("/", ScheduleController.getSchedule);

scheduleRouter.patch("/config", authMiddleware, ScheduleController.updateConfig);

scheduleRouter.patch("/time", authMiddleware, ScheduleController.updateTimeRecord);

scheduleRouter.delete("/time", authMiddleware, ScheduleController.deleteTimeRecord);

export default scheduleRouter;
