// src/controllers/mentions.controller.ts
import { Context } from "hono";
import ejs from "ejs";
import { join } from "path";

export async function renderMentions(c: Context): Promise<Response> {
  // Render the page body
  const body = await ejs.renderFile(
    join(import.meta.dir, "../../views/mentions.ejs"),
    { title: "Mentions" }
  );

  // Wrap with layout
  const html = await ejs.renderFile(
    join(import.meta.dir, "../../views/layout.ejs"),
    { title: "Mentions", body, path: c.req.path }
  );

  return c.html(html);
}
