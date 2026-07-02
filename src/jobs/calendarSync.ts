import ical from "node-ical";
import type { Config } from "../config.js";
import type { Store } from "../db.js";
import { createTodo } from "../api.js";
import { computeSurfaceDate, toIsoDate } from "../parse.js";

const MARKER = "#todo";
const LEAD_TOKEN = /\b(\d{1,3})d\b/;

/**
 * Fetches the secret ICS URL and turns events with "#todo" in the title into todos.
 * Lead time optional via an "Nd" token in the title (e.g. "#todo 5d taxes").
 * Dedupe/update via "uid:date" (so every recurrence creates its own todo);
 * vanished, not-yet-sent entries are cancelled.
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

    // determine the next occurrence (RRULE: next event from now, today inclusive)
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
        console.log(`[calendar] updated: #${existing.id} "${title}"`);
      }
      continue;
    }

    // do not re-create past one-off events
    if (due < toIsoDate(now)) continue;

    const todo = createTodo(store, config, { title, due, leadDays, notes: item.description ? String(item.description) : null }, "calendar", ref);
    console.log(`[calendar] captured: #${todo.id} "${todo.title}" (inbox on ${todo.surface_date})`);
  }

  const cancelled = store.cancelCalendarTodosNotIn(activeRefs);
  if (cancelled > 0) console.log(`[calendar] cancelled ${cancelled} todo(s) (event removed)`);
}
