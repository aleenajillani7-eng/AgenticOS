// src/routes/twitter.route.ts
import { Hono } from "hono";
import { getSelfUserId } from "../services/twitter.service";

const twitterRouter = new Hono();

/**
 * GET /api/twitter/me
 * Returns the numeric user id of the authenticated bot account.
 */
twitterRouter.get("/me", async (c) => {
  try {
    const id = await getSelfUserId();
    return c.json({ id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return c.json({ ok: false, error: message }, 500);
  }
});

export default twitterRouter;
