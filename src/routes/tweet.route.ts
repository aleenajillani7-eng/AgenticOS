// src/routes/tweet.route.ts
import { Hono } from "hono";

export const tweetRouter = new Hono();

// Simple health/auth placeholder
tweetRouter.get("/auth", (c) => {
  return c.json({
    success: true,
    message: "Tweets auth placeholder is live."
  });
});

// Example tweet endpoint
tweetRouter.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return c.json({ success: true, received: body });
});
