import { Hono } from "hono";
import { html, raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import type { Store, Todo } from "./db.js";
import type { Config } from "./config.js";
import type { Llm } from "./llm.js";
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
<html lang="de">
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
  <nav><a href="/">Liste</a> <a href="/new">+ Neu</a> <a href="/settings">Einstellungen</a></nav>
  ${body}
</body>
</html>`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

function todoRow(t: Todo) {
  return html`<tr class="${t.status !== "scheduled" ? "done" : ""}">
    <td>
      ${t.title}
      ${t.url ? html`<br /><a class="muted" href="${t.url}">${t.url}</a>` : ""}
      ${t.notes ? html`<br /><span class="muted">${t.notes}</span>` : ""}
    </td>
    <td class="muted">fällig ${fmtDate(t.due_date)}<br />📥 ${fmtDate(t.surface_date)}</td>
    <td class="muted">${t.status === "sent" ? "gesendet" : t.status === "cancelled" ? "storniert" : t.source}</td>
    <td>
      <form class="inline" method="post" action="/todos/${t.id}/delete" onsubmit="return confirm('Löschen?')">
        <button class="small" type="submit">✕</button>
      </form>
    </td>
  </tr>`;
}

export function uiRoutes(store: Store, config: Config, llm: Llm): Hono {
  const ui = new Hono();

  // Basic Auth für alles außer Manifest/Icon (iOS lädt die ohne Credentials)
  ui.use("*", async (c, next) => {
    if (c.req.path === "/manifest.webmanifest" || c.req.path === "/icon.png") return next();
    const header = c.req.header("Authorization") ?? "";
    const expected = "Basic " + Buffer.from(`${config.uiUser}:${config.uiPassword}`).toString("base64");
    if (header !== expected) {
      return c.text("Authentifizierung erforderlich", 401, { "WWW-Authenticate": 'Basic realm="inboxZero"' });
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
        "Liste",
        html`
          <h2>Geplant (${scheduled.length})</h2>
          <table>${scheduled.map(todoRow)}</table>
          ${scheduled.length === 0 ? html`<p class="muted">Nichts geplant.</p>` : ""}
          <h2>Erledigt / storniert</h2>
          <table>${rest.map(todoRow)}</table>
        `,
      ),
    );
  });

  ui.post("/todos/:id/delete", (c) => {
    store.deleteTodo(Number(c.req.param("id")));
    return c.redirect("/");
  });

  ui.get("/new", (c) => c.html(page("Neu", newForm(null, null))));

  ui.post("/new", async (c) => {
    const form = await c.req.formData();
    const text = String(form.get("text") ?? "").trim();
    const due = String(form.get("due") ?? "").trim() || null;
    const leadRaw = String(form.get("leadDays") ?? "").trim();
    const leadDays = leadRaw ? Number(leadRaw) : null;
    if (!text) return c.html(page("Neu", newForm("Bitte Text eingeben.", null)));

    try {
      const structured = await llm.structureTodo(text);
      const todo = createTodo(store, config, {
        title: structured.title,
        notes: structured.notes,
        url: structured.url,
        due: due ?? structured.due,
        leadDays: leadDays ?? structured.leadDays,
      }, "api");
      return c.html(
        page("Neu", newForm(null, `Erfasst: „${todo.title}" — landet am ${fmtDate(todo.surface_date)} im Posteingang.`)),
      );
    } catch (err) {
      return c.html(page("Neu", newForm(`Ollama-Fehler: ${err instanceof Error ? err.message : err}`, null)));
    }
  });

  ui.get("/settings", async (c) => {
    let models: string[] = [];
    let modelError: string | null = null;
    try {
      models = await llm.listModels();
    } catch (err) {
      modelError = err instanceof Error ? err.message : String(err);
    }
    return c.html(page("Einstellungen", settingsForm(store, models, modelError, false)));
  });

  ui.post("/settings", async (c) => {
    const form = await c.req.formData();
    store.setSetting("llm_system_prompt", String(form.get("systemPrompt") ?? ""));
    store.setSetting("llm_model", String(form.get("model") ?? ""));
    let models: string[] = [];
    try {
      models = await llm.listModels();
    } catch {
      /* Dropdown bleibt leer, gespeicherter Wert bleibt erhalten */
    }
    return c.html(page("Einstellungen", settingsForm(store, models, null, true)));
  });

  return ui;
}

function newForm(error: string | null, ok: string | null) {
  return html`
    ${error ? html`<p class="error">${error}</p>` : ""}
    ${ok ? html`<p class="ok">${ok}</p>` : ""}
    <form method="post" action="/new">
      <label>Was ist zu tun? (Freitext — Datum & Details erkennt das LLM)</label>
      <textarea name="text" rows="4" placeholder="z.B. Reifen wechseln bis Ende Oktober, erinner mich 5 Tage vorher" required></textarea>
      <label>Fälligkeit überschreiben (optional)</label>
      <input type="date" name="due" />
      <label>Vorlauftage (optional)</label>
      <input type="number" name="leadDays" min="0" placeholder="Standard: aus Env" />
      <button type="submit">Erfassen</button>
    </form>
  `;
}

function settingsForm(store: Store, models: string[], modelError: string | null, saved: boolean) {
  const currentModel = store.getSetting("llm_model");
  const prompt = store.getSetting("llm_system_prompt");
  return html`
    ${saved ? html`<p class="ok">Gespeichert.</p>` : ""}
    ${modelError ? html`<p class="error">Ollama nicht erreichbar: ${modelError}</p>` : ""}
    <form method="post" action="/settings">
      <label>Ollama-Modell</label>
      <select name="model">
        <option value="">(erstes verfügbares Modell)</option>
        ${models.map((m) => html`<option value="${m}" ${m === currentModel ? "selected" : ""}>${m}</option>`)}
        ${currentModel && !models.includes(currentModel)
          ? html`<option value="${currentModel}" selected>${currentModel} (nicht in Liste)</option>`
          : ""}
      </select>
      <label>System-Prompt (Platzhalter: {today})</label>
      <textarea name="systemPrompt" rows="12">${prompt}</textarea>
      <button type="submit">Speichern</button>
    </form>
  `;
}
