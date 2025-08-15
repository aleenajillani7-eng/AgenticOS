// src/routes/index.ts
import { Hono } from "hono";

// API routers (import exactly what you have)
import { tweetRouter } from "./tweet.route";
import { mentionRouter } from "./mention.route";
// ⬇️ default import because schedule.routes.ts uses `export default`
import scheduleRouter from "./schedule.routes";

export const apiRouter = new Hono();

// Mount API sub-routers
apiRouter.route("/tweets", tweetRouter);
apiRouter.route("/mentions", mentionRouter);
apiRouter.route("/schedule", scheduleRouter);

// If you later add other routers, mount them here too.
// export const viewRouter = ...  // only if you need pages at "/"
