import ical from "node-ical";
import type { Config } from "../config.js";
import type { Store } from "../db.js";
import { createTodo } from "../api.js";
import { computeSurfaceDate, toIsoDate } from "../parse.js";

const MARKER = "#todo";
const LEAD_TOKEN = /\b(\d{1,3})d\b/;

/**
 * Holt die geheime ICS-URL und übernimmt Termine mit "#todo" im Titel als Todos.
 * Vorlauf optional per "Nd"-Token im Titel (z.B. "#todo 5d Steuer").
 * Dedupe/Update per "uid:datum" (so erzeugt jede Wiederholung ein eigenes Todo);
 * verschwundene, noch nicht gesendete Einträge werden storniert.
 */
export async function syncCalendar(store: Store, config: Config): Promise<void> {
  if (!config.icsUrl) return;

  const events = await ical.async.fromURL(config.icsUrl);
  const activeRefs: string[] = [];
  const now = new Date();

  for (const component of Object.values(events)) {
    if (!component || component.type !== "VEVENT") continue;
    const item = component as ical.VEvent;
    const summary = String(item.summary ?? "");
    if (!summary.toLowerCase().includes(MARKER)) continue;

    // Nächstes Vorkommen bestimmen (RRULE: nächster Termin ab jetzt, heute inklusive)
    let start: Date | undefined;
    if (item.rrule) {
      const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      start = item.rrule.after(todayMidnight, true) ?? undefined;
    } else if (item.start) {
      start = item.start;
    }
    if (!start) continue;

    const due = toIsoDate(start);
    const leadMatch = LEAD_TOKEN.exec(summary);
    const leadDays = leadMatch ? Number(leadMatch[1]) : null;
    const title = summary
      .replace(new RegExp(MARKER, "i"), "")
      .replace(LEAD_TOKEN, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!title) continue;

    const ref = `${item.uid}:${due}`;
    activeRefs.push(ref);

    const existing = store.findBySourceRef("calendar", ref);
    if (existing) {
      if (existing.status === "scheduled" && (existing.title !== title || existing.lead_days !== leadDays)) {
        store.updateTodo(existing.id, {
          title,
          lead_days: leadDays,
          surface_date: computeSurfaceDate(due, leadDays ?? config.defaultLeadDays, now),
        });
        console.log(`[calendar] aktualisiert: #${existing.id} „${title}"`);
      }
      continue;
    }

    // Vergangene Einzeltermine nicht mehr neu anlegen
    if (due < toIsoDate(now)) continue;

    const todo = createTodo(store, config, { title, due, leadDays, notes: item.description ? String(item.description) : null }, "calendar", ref);
    console.log(`[calendar] erfasst: #${todo.id} „${todo.title}" (📥 ${todo.surface_date})`);
  }

  const cancelled = store.cancelCalendarTodosNotIn(activeRefs);
  if (cancelled > 0) console.log(`[calendar] ${cancelled} Todo(s) storniert (Termin entfernt)`);
}
