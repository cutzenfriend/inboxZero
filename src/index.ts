import { serve } from "@hono/node-server";
import { Hono } from "hono";
import cron from "node-cron";
import { config } from "./config.js";
import { openDb, Store } from "./db.js";
import { Llm } from "./llm.js";
import { apiRoutes } from "./api.js";
import { uiRoutes } from "./ui.js";
import { createMailer } from "./mail/send.js";
import { surfaceDueTodos } from "./jobs/surface.js";
import { captureFromImap } from "./jobs/imapCapture.js";
import { syncCalendar } from "./jobs/calendarSync.js";

const db = openDb(config.dataDir, config.llmLanguage);
const store = new Store(db);
const llm = new Llm(config.ollamaUrl, store);
const mailer = createMailer(config);

const app = new Hono();
app.route("/api", apiRoutes(store, config, llm));
app.route("/", uiRoutes(store, config, llm));

// jobs — guarded against overlapping runs
function guarded(name: string, fn: () => Promise<void>): () => void {
  let running = false;
  return () => {
    if (running) return;
    running = true;
    fn()
      .catch((err) => console.error(`[${name}]`, err))
      .finally(() => (running = false));
  };
}

const runSurface = guarded("surface", () => surfaceDueTodos(store, mailer));
const runImap = guarded("imap", () => captureFromImap(store, config, llm));
const runCalendar = guarded("calendar", () => syncCalendar(store, config));

cron.schedule("*/5 * * * *", runSurface);
cron.schedule("2-59/5 * * * *", runImap); // offset so captures land before the next surface tick
cron.schedule("7 * * * *", runCalendar);

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`inboxZero listening on http://localhost:${info.port} (Ollama: ${config.ollamaUrl})`);
  // startup ticks
  runCalendar();
  runImap();
  runSurface();
});
