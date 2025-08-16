import { Hono } from "hono";
import { login, callback } from "../controllers/login.controllers";

const router = new Hono();

// Login routes
router.get("/", login);
router.get("/callback", callback);

export default router;