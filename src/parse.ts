/**
 * Deterministischer Fast-Path für die Betreff-Grammatik:
 *   @<TT.MM.[JJJJ]> [<N>d] <Titel>   z.B. "@01.03. 5d Steuererklärung"
 *   @<JJJJ-MM-TT>   [<N>d] <Titel>   z.B. "@2026-03-01 Steuererklärung"
 * Matcht die Grammatik nicht, liefert parseSubject null → Aufrufer nutzt das LLM.
 */

export interface ParsedTodo {
  title: string;
  /** Fälligkeit als YYYY-MM-DD */
  due: string;
  /** Vorlauftage; null = Default verwenden */
  leadDays: number | null;
}

const GERMAN_DATE = /@(\d{1,2})\.(\d{1,2})\.(\d{4})?/;
const ISO_DATE = /@(\d{4})-(\d{2})-(\d{2})/;
const LEAD = /^\s*(\d{1,3})d\b/;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Lokales Datum als YYYY-MM-DD (kein UTC-Versatz). */
export function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function isValidDate(year: number, month: number, day: number): boolean {
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
}

/**
 * Parst einen Betreff nach der @-Grammatik. `today` bestimmt das Jahr
 * bei jahrlosen Datumsangaben: nächstes Vorkommen (heute zählt als zukünftig).
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

  const rest = subject.slice(0, match.index) + subject.slice(match.index + match[0].length);
  const afterDate = subject.slice(match.index + match[0].length);
  const leadMatch = LEAD.exec(afterDate);

  let title: string;
  let leadDays: number | null = null;
  if (leadMatch) {
    leadDays = Number(leadMatch[1]);
    title = (subject.slice(0, match.index) + afterDate.slice(leadMatch[0].length)).trim();
  } else {
    title = rest.trim();
  }

  title = title.replace(/\s+/g, " ");
  if (!title) return null;

  return { title, due: `${year}-${pad(month)}-${pad(day)}`, leadDays };
}

/**
 * surface_date = due − leadDays. Liegt das Ergebnis in der Vergangenheit,
 * gibt es das heutige Datum zurück (→ sofort senden).
 */
export function computeSurfaceDate(due: string, leadDays: number, today: Date): string {
  const [y, m, d] = due.split("-").map(Number);
  const surface = new Date(y!, m! - 1, d! - leadDays);
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return surface < todayMidnight ? toIsoDate(todayMidnight) : toIsoDate(surface);
}
