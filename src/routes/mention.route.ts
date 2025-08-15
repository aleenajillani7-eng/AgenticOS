// src/routes/mention.route.ts
import { Hono } from "hono";

export const mentionRouter = new Hono();

mentionRouter.get("/", (c) => {
  return c.json({ success: true, message: "Mentions endpoint is live." });
});
