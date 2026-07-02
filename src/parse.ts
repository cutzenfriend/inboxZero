/**
 * Deterministic fast path for the subject grammar:
 *   @<DD.MM.[YYYY]> [<HH:MM>] [<N>d] <title>   e.g. "@01.03. 14:30 5d file tax return"
 *   @<YYYY-MM-DD>   [<HH:MM>] [<N>d] <title>   e.g. "@2026-03-01 file tax return"
 * If the grammar does not match, parseSubject returns null → the caller uses the LLM.
 */

export interface ParsedTodo {
  title: string;
  /** due date as YYYY-MM-DD */
  due: string;
  /** time of day as HH:MM; null = use the SURFACE_TIME default */
  time: string | null;
  /** lead days; null = use default */
  leadDays: number | null;
}

const GERMAN_DATE = /@(\d{1,2})\.(\d{1,2})\.(\d{4})?/;
const ISO_DATE = /@(\d{4})-(\d{2})-(\d{2})/;
const TIME = /^\s*([01]?\d|2[0-3]):([0-5]\d)\b/;
const LEAD = /^\s*(\d{1,3})d\b/;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Local date as YYYY-MM-DD (no UTC offset). */
export function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function isValidDate(year: number, month: number, day: number): boolean {
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
}

/**
 * Parses a subject against the @ grammar. `today` determines the year for
 * year-less dates: next occurrence (today counts as upcoming).
 */
export function parseSubject(subject: string, today: Date): ParsedTodo | null {
  let match = ISO_DATE.exec(subject);
  let year: number, month: number, day: number;

  if (match) {
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  } else {
    match = GERMAN_DATE.exec(subject);
    if (!match) return null;
    day = Number(match[1]);
    month = Number(match[2]);
    if (match[3]) {
      year = Number(match[3]);
    } else {
      year = today.getFullYear();
      const candidate = new Date(year, month - 1, day);
      const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      if (isValidDate(year, month, day) && candidate < todayMidnight) year += 1;
    }
  }

  if (!isValidDate(year, month, day)) return null;

  const before = subject.slice(0, match.index);
  let after = subject.slice(match.index + match[0].length);

  let time: string | null = null;
  const timeMatch = TIME.exec(after);
  if (timeMatch) {
    time = `${pad(Number(timeMatch[1]))}:${timeMatch[2]}`;
    after = after.slice(timeMatch[0].length);
  }

  let leadDays: number | null = null;
  const leadMatch = LEAD.exec(after);
  if (leadMatch) {
    leadDays = Number(leadMatch[1]);
    after = after.slice(leadMatch[0].length);
  }

  const title = (before + after).replace(/\s+/g, " ").trim();
  if (!title) return null;

  return { title, due: `${year}-${pad(month)}-${pad(day)}`, time, leadDays };
}

/**
 * surface_date = due − leadDays. If the result lies in the past,
 * today's date is returned (→ send immediately).
 */
export function computeSurfaceDate(due: string, leadDays: number, today: Date): string {
  const [y, m, d] = due.split("-").map(Number);
  const surface = new Date(y!, m! - 1, d! - leadDays);
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return surface < todayMidnight ? toIsoDate(todayMidnight) : toIsoDate(surface);
}
