import { Hono } from "hono";
import { loadTokens } from "../controllers/token.controller";

// Create a Hono router for token routes
const tokenRouter = new Hono();

// Register token routes
tokenRouter.post("/", loadTokens);

export default tokenRouter;
