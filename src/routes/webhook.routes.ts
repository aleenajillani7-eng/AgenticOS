// src/routes/webhook.routes.ts
import { Hono } from "hono";
import authMiddleware from "../middleware/auth.middleware";
import {
  registerWebhook,
  subscribeToCategories,
  tweetWebhook,
} from "../controllers/webhook.controller";

const webhookRouter = new Hono();

// Public endpoint for external webhook to hit your bot (optional)
webhookRouter.post("/incoming", tweetWebhook);

// Protect management endpoints with your password middleware
webhookRouter.use("/*", authMiddleware);
webhookRouter.post("/register", registerWebhook);
webhookRouter.post("/categories/subscribe", subscribeToCategories);

export default webhookRouter;
