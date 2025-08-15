// src/routes/tweet.route.ts
import { Hono } from "hono";

export const tweetRouter = new Hono();

// Temporary Auth Endpoint (so 404 stops happening)
tweetRouter.get("/auth", (c) => {
  return c.json({
    success: true,
    message: "Auth endpoint is live. You can connect your Twitter here."
  });
});

// Temporary Tweet Posting Endpoint
tweetRouter.post("/", async (c) => {
  const body = await c.req.json();
  // For now, just echo back the request
  return c.json({
    success: true,
    received: body
  });
});

