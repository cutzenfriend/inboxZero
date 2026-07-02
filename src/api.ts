import { Hono } from "hono";
import type { Store } from "./db.js";
import type { Config } from "./config.js";
import type { Llm } from "./llm.js";
import { computeSurfaceDate, toIsoDate } from "./parse.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface CreateTodoInput {
  title: string;
  notes?: string | null;
  url?: string | null;
  due?: string | null;
  leadDays?: number | null;
}

/** Creates a todo; without a due date it surfaces immediately (surface = today). */
export function createTodo(store: Store, config: Config, input: CreateTodoInput, source: "api" | "email" | "calendar", sourceRef?: string) {
  const today = new Date();
  const surfaceDate = input.due
    ? computeSurfaceDate(input.due, input.leadDays ?? config.defaultLeadDays, today)
    : toIsoDate(today);
  return store.insertTodo({
    title: input.title,
    notes: input.notes ?? null,
    url: input.url ?? null,
    dueDate: input.due ?? null,
    leadDays: input.leadDays ?? null,
    surfaceDate,
    source,
    sourceRef: sourceRef ?? null,
  });
}

export function apiRoutes(store: Store, config: Config, llm: Llm): Hono {
  const api = new Hono();

  api.use("*", async (c, next) => {
    const auth = c.req.header("Authorization");
    if (auth !== `Bearer ${config.apiToken}`) {
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  });

  api.get("/todos", (c) => {
    const status = c.req.query("status") as "scheduled" | "sent" | "cancelled" | undefined;
    return c.json(store.listTodos(status));
  });

  api.post("/todos", async (c) => {
    const body = await c.req.json<CreateTodoInput>().catch(() => null);
    if (!body?.title?.trim()) return c.json({ error: "title missing" }, 400);
    if (body.due && !ISO_DATE.test(body.due)) return c.json({ error: "due must be YYYY-MM-DD" }, 400);
    const todo = createTodo(store, config, { ...body, title: body.title.trim() }, "api");
    return c.json(todo, 201);
  });

  api.post("/todos/freeform", async (c) => {
    const body = await c.req
      .json<{ text?: string; image?: string; due?: string; leadDays?: number }>()
      .catch(() => null);
    if (!body || (!body.text?.trim() && !body.image)) return c.json({ error: "text or image missing" }, 400);
    if (body.due && !ISO_DATE.test(body.due)) return c.json({ error: "due must be YYYY-MM-DD" }, 400);

    // tolerate data URL prefix (data:image/png;base64,…)
    const image = body.image ? body.image.replace(/^data:image\/\w+;base64,/, "").replace(/\s/g, "") : null;
    if (image && !/^[A-Za-z0-9+/]+={0,2}$/.test(image)) {
      return c.json(
        { error: "image is not valid base64 — send the output of a Base64 Encode action, not the raw image" },
        400,
      );
    }

    let structured;
    try {
      structured = await llm.structureTodo(body.text?.trim(), image);
    } catch (err) {
      return c.json({ error: `LLM structuring failed: ${err instanceof Error ? err.message : err}` }, 502);
    }

    const todo = createTodo(store, config, {
      title: structured.title,
      notes: structured.notes,
      url: structured.url,
      due: body.due ?? structured.due, // an explicit date overrides the LLM
      leadDays: body.leadDays ?? structured.leadDays,
    }, "api");
    return c.json(todo, 201);
  });

  api.patch("/todos/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const body = await c.req.json<CreateTodoInput & { status?: "scheduled" | "cancelled" }>().catch(() => null);
    if (!body) return c.json({ error: "invalid body" }, 400);
    if (body.due && !ISO_DATE.test(body.due)) return c.json({ error: "due must be YYYY-MM-DD" }, 400);

    const existing = store.getTodo(id);
    if (!existing) return c.json({ error: "not found" }, 404);

    const due = body.due !== undefined ? body.due : existing.due_date;
    const leadDays = body.leadDays !== undefined ? body.leadDays : existing.lead_days;
    const surfaceDate = due
      ? computeSurfaceDate(due, leadDays ?? config.defaultLeadDays, new Date())
      : existing.surface_date;

    const updated = store.updateTodo(id, {
      title: body.title?.trim() || existing.title,
      notes: body.notes !== undefined ? body.notes : existing.notes,
      url: body.url !== undefined ? body.url : existing.url,
      due_date: due,
      lead_days: leadDays,
      surface_date: surfaceDate,
      status: body.status ?? existing.status,
    });
    return c.json(updated);
  });

  api.delete("/todos/:id", (c) => {
    const ok = store.deleteTodo(Number(c.req.param("id")));
    return ok ? c.body(null, 204) : c.json({ error: "not found" }, 404);
  });

  return api;
}
