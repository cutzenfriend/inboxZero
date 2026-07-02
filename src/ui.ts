import { Hono } from "hono";
import { html, raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import type { Store, Todo } from "./db.js";
import type { Config } from "./config.js";
import type { Llm, ModelInfo } from "./llm.js";
import { createTodo } from "./api.js";

const STYLE = `
  :root { color-scheme: light dark; --accent: #2563eb; --muted: #6b7280; --border: #d1d5db; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 640px; margin: 0 auto; padding: 16px; }
  h1 { font-size: 1.3rem; } h1 a { text-decoration: none; color: inherit; }
  nav { display: flex; gap: 12px; margin-bottom: 16px; }
  nav a { color: var(--accent); text-decoration: none; font-weight: 500; }
  table { width: 100%; border-collapse: collapse; }
  td, th { padding: 8px 6px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; }
  .muted { color: var(--muted); font-size: 0.85rem; }
  .done { opacity: 0.55; }
  form.inline { display: inline; }
  input, textarea, select, button { font: inherit; padding: 8px; border-radius: 8px; border: 1px solid var(--border); width: 100%; margin: 4px 0 12px; background: transparent; color: inherit; }
  button { background: var(--accent); color: white; border: none; cursor: pointer; width: auto; padding: 8px 20px; }
  button.small { padding: 2px 10px; font-size: 0.8rem; background: transparent; color: var(--muted); border: 1px solid var(--border); }
  .error { background: #fee2e2; color: #991b1b; padding: 10px; border-radius: 8px; }
  .ok { background: #dcfce7; color: #166534; padding: 10px; border-radius: 8px; }
`;

function page(title: string, body: HtmlEscapedString | Promise<HtmlEscapedString>) {
  return html`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-title" content="inboxZero" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="apple-touch-icon" href="/icon.png" />
  <title>${title} · inboxZero</title>
  <style>${raw(STYLE)}</style>
</head>
<body>
  <h1><a href="/">📥 inboxZero</a></h1>
  <nav><a href="/">List</a> <a href="/new">+ New</a> <a href="/settings">Settings</a></nav>
  ${body}
</body>
</html>`;
}

function todoRow(t: Todo) {
  return html`<tr class="${t.status !== "scheduled" ? "done" : ""}">
    <td>
      ${t.title}
      ${t.url ? html`<br /><a class="muted" href="${t.url}">${t.url}</a>` : ""}
      ${t.notes ? html`<br /><span class="muted">${t.notes}</span>` : ""}
    </td>
    <td class="muted">due ${t.due_date ?? "—"}<br />📥 ${t.surface_date}</td>
    <td class="muted">${t.status === "scheduled" ? t.source : t.status}</td>
    <td>
      <form class="inline" method="post" action="/todos/${t.id}/delete" onsubmit="return confirm('Delete?')">
        <button class="small" type="submit">✕</button>
      </form>
    </td>
  </tr>`;
}

export function uiRoutes(store: Store, config: Config, llm: Llm): Hono {
  const ui = new Hono();

  // Basic auth for everything except manifest/icon (iOS fetches those without credentials)
  ui.use("*", async (c, next) => {
    if (c.req.path === "/manifest.webmanifest" || c.req.path === "/icon.png") return next();
    const header = c.req.header("Authorization") ?? "";
    const expected = "Basic " + Buffer.from(`${config.uiUser}:${config.uiPassword}`).toString("base64");
    if (header !== expected) {
      return c.text("Authentication required", 401, { "WWW-Authenticate": 'Basic realm="inboxZero"' });
    }
    await next();
  });

  ui.get("/icon.png", async (c) => {
    const { readFile } = await import("node:fs/promises");
    const png = await readFile(new URL("../public/icon.png", import.meta.url));
    return c.body(new Uint8Array(png), 200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" });
  });

  ui.get("/manifest.webmanifest", (c) =>
    c.json({
      name: "inboxZero",
      short_name: "inboxZero",
      start_url: "/new",
      display: "standalone",
      background_color: "#1e293b",
      theme_color: "#2563eb",
      icons: [{ src: "/icon.png", sizes: "180x180", type: "image/png" }],
    }),
  );

  ui.get("/", (c) => {
    const todos = store.listTodos();
    const scheduled = todos.filter((t) => t.status === "scheduled");
    const rest = todos.filter((t) => t.status !== "scheduled").slice(0, 20);
    return c.html(
      page(
        "List",
        html`
          <h2>Scheduled (${scheduled.length})</h2>
          <table>${scheduled.map(todoRow)}</table>
          ${scheduled.length === 0 ? html`<p class="muted">Nothing scheduled.</p>` : ""}
          <h2>Sent / cancelled</h2>
          <table>${rest.map(todoRow)}</table>
        `,
      ),
    );
  });

  ui.post("/todos/:id/delete", (c) => {
    store.deleteTodo(Number(c.req.param("id")));
    return c.redirect("/");
  });

  ui.get("/new", (c) => c.html(page("New", newForm(null, null))));

  ui.post("/new", async (c) => {
    const form = await c.req.formData();
    const text = String(form.get("text") ?? "").trim();
    const due = String(form.get("due") ?? "").trim() || null;
    const leadRaw = String(form.get("leadDays") ?? "").trim();
    const leadDays = leadRaw ? Number(leadRaw) : null;

    const imageFile = form.get("image");
    let imageBase64: string | null = null;
    if (imageFile instanceof File && imageFile.size > 0) {
      imageBase64 = Buffer.from(await imageFile.arrayBuffer()).toString("base64");
    }
    if (!text && !imageBase64) return c.html(page("New", newForm("Please enter text or choose an image.", null)));

    try {
      const structured = await llm.structureTodo(text || null, imageBase64);
      const todo = createTodo(store, config, {
        title: structured.title,
        notes: structured.notes,
        url: structured.url,
        due: due ?? structured.due,
        leadDays: leadDays ?? structured.leadDays,
      }, "api");
      return c.html(
        page("New", newForm(null, `Captured: "${todo.title}" — will land in your inbox on ${todo.surface_date}.`)),
      );
    } catch (err) {
      return c.html(page("New", newForm(`Ollama error: ${err instanceof Error ? err.message : err}`, null)));
    }
  });

  ui.get("/settings", async (c) => {
    let models: ModelInfo[] = [];
    let modelError: string | null = null;
    try {
      models = await llm.listModels();
    } catch (err) {
      modelError = err instanceof Error ? err.message : String(err);
    }
    return c.html(page("Settings", settingsForm(store, models, modelError, false)));
  });

  ui.post("/settings", async (c) => {
    const form = await c.req.formData();
    store.setSetting("llm_system_prompt", String(form.get("systemPrompt") ?? ""));
    store.setSetting("llm_model", String(form.get("model") ?? ""));
    store.setSetting("llm_language", String(form.get("language") ?? "").trim() || "English");
    let models: ModelInfo[] = [];
    try {
      models = await llm.listModels();
    } catch {
      /* dropdown stays empty, the stored value is kept */
    }
    return c.html(page("Settings", settingsForm(store, models, null, true)));
  });

  return ui;
}

function newForm(error: string | null, ok: string | null) {
  return html`
    ${error ? html`<p class="error">${error}</p>` : ""}
    ${ok ? html`<p class="ok">${ok}</p>` : ""}
    <form method="post" action="/new" enctype="multipart/form-data">
      <label>What needs to be done? (free-form — the LLM extracts date & details)</label>
      <textarea name="text" rows="4" placeholder="e.g. Change tires by end of October, remind me 5 days before"></textarea>
      <label>… or an image (screenshot etc. — analyzed only, not stored)</label>
      <input type="file" name="image" accept="image/*" />
      <label>Override due date (optional)</label>
      <input type="date" name="due" />
      <label>Lead days (optional)</label>
      <input type="number" name="leadDays" min="0" placeholder="default: from env" />
      <button type="submit">Capture</button>
    </form>
  `;
}

function settingsForm(store: Store, models: ModelInfo[], modelError: string | null, saved: boolean) {
  const currentModel = store.getSetting("llm_model");
  const prompt = store.getSetting("llm_system_prompt");
  const language = store.getSetting("llm_language");
  return html`
    ${saved ? html`<p class="ok">Saved.</p>` : ""}
    ${modelError ? html`<p class="error">Ollama unreachable: ${modelError}</p>` : ""}
    <form method="post" action="/settings">
      <label>Ollama model (👁 = supports images; image captures fall back to a vision model automatically)</label>
      <select name="model">
        <option value="">(first available model)</option>
        ${models.map(
          (m) => html`<option value="${m.name}" ${m.name === currentModel ? "selected" : ""}>${m.name}${m.vision ? " 👁" : ""}</option>`,
        )}
        ${currentModel && !models.some((m) => m.name === currentModel)
          ? html`<option value="${currentModel}" selected>${currentModel} (not in list)</option>`
          : ""}
      </select>
      <label>Todo language (what the LLM writes titles/notes in, e.g. "English", "German")</label>
      <input type="text" name="language" value="${language}" />
      <label>System prompt (placeholders: {today}, {language})</label>
      <textarea name="systemPrompt" rows="12">${prompt}</textarea>
      <button type="submit">Save</button>
    </form>
  `;
}
