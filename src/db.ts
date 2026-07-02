import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export type TodoSource = "api" | "email" | "calendar";
export type TodoStatus = "scheduled" | "sent" | "cancelled";

export interface Todo {
  id: number;
  title: string;
  notes: string | null;
  url: string | null;
  due_date: string | null;
  lead_days: number | null;
  surface_date: string;
  source: TodoSource;
  source_ref: string | null;
  status: TodoStatus;
  created_at: string;
  sent_at: string | null;
}

export interface NewTodo {
  title: string;
  notes?: string | null;
  url?: string | null;
  dueDate?: string | null;
  leadDays?: number | null;
  surfaceDate: string;
  source: TodoSource;
  sourceRef?: string | null;
}

const DEFAULT_SYSTEM_PROMPT = `You are an assistant that converts free-form text or images (e.g. chat screenshots) into a todo.
Today is {today}. Extract from the input:
- title: short, concise task title (imperative, written in {language}); always keep details like quantities and places in the title ("Buy 3 bananas", never just "Buy bananas")
- due: due date as YYYY-MM-DD if one is mentioned or can be inferred ("next Tuesday", "end of March", "in 2 weeks"), otherwise null
- leadDays: lead time in days if mentioned ("remind me 3 days before"), otherwise null
- notes: relevant details/links from the input, otherwise null
Respond with the JSON object only.`;

export function openDb(dataDir: string, defaultLanguage: string): Database.Database {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, "inboxzero.sqlite"));
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS todos (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      title        TEXT NOT NULL,
      notes        TEXT,
      url          TEXT,
      due_date     TEXT,
      lead_days    INTEGER,
      surface_date TEXT NOT NULL,
      source       TEXT NOT NULL CHECK (source IN ('api','email','calendar')),
      source_ref   TEXT,
      status       TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','sent','cancelled')),
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      sent_at      TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_todos_source_ref ON todos(source, source_ref) WHERE source_ref IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_todos_status_surface ON todos(status, surface_date);

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('llm_system_prompt', ?)").run(DEFAULT_SYSTEM_PROMPT);
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('llm_model', '')").run();
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('llm_language', ?)").run(defaultLanguage);

  return db;
}

export class Store {
  constructor(private db: Database.Database) {}

  insertTodo(t: NewTodo): Todo {
    const info = this.db
      .prepare(
        `INSERT INTO todos (title, notes, url, due_date, lead_days, surface_date, source, source_ref)
         VALUES (@title, @notes, @url, @dueDate, @leadDays, @surfaceDate, @source, @sourceRef)`,
      )
      .run({
        title: t.title,
        notes: t.notes ?? null,
        url: t.url ?? null,
        dueDate: t.dueDate ?? null,
        leadDays: t.leadDays ?? null,
        surfaceDate: t.surfaceDate,
        source: t.source,
        sourceRef: t.sourceRef ?? null,
      });
    return this.getTodo(Number(info.lastInsertRowid))!;
  }

  getTodo(id: number): Todo | undefined {
    return this.db.prepare("SELECT * FROM todos WHERE id = ?").get(id) as Todo | undefined;
  }

  findBySourceRef(source: TodoSource, sourceRef: string): Todo | undefined {
    return this.db.prepare("SELECT * FROM todos WHERE source = ? AND source_ref = ?").get(source, sourceRef) as
      | Todo
      | undefined;
  }

  listTodos(status?: TodoStatus): Todo[] {
    if (status) {
      return this.db
        .prepare("SELECT * FROM todos WHERE status = ? ORDER BY surface_date ASC, id ASC")
        .all(status) as Todo[];
    }
    return this.db
      .prepare(
        "SELECT * FROM todos ORDER BY CASE status WHEN 'scheduled' THEN 0 WHEN 'sent' THEN 1 ELSE 2 END, surface_date ASC, id ASC",
      )
      .all() as Todo[];
  }

  /** Due, not-yet-sent todos (surface_date <= today). */
  listDue(todayIso: string): Todo[] {
    return this.db
      .prepare("SELECT * FROM todos WHERE status = 'scheduled' AND surface_date <= ?")
      .all(todayIso) as Todo[];
  }

  updateTodo(id: number, fields: Partial<Pick<Todo, "title" | "notes" | "url" | "due_date" | "lead_days" | "surface_date" | "status">>): Todo | undefined {
    const existing = this.getTodo(id);
    if (!existing) return undefined;
    const merged = { ...existing, ...fields };
    this.db
      .prepare(
        `UPDATE todos SET title=@title, notes=@notes, url=@url, due_date=@due_date,
         lead_days=@lead_days, surface_date=@surface_date, status=@status WHERE id=@id`,
      )
      .run(merged);
    return this.getTodo(id);
  }

  markSent(id: number): void {
    this.db.prepare("UPDATE todos SET status='sent', sent_at=datetime('now') WHERE id = ?").run(id);
  }

  deleteTodo(id: number): boolean {
    return this.db.prepare("DELETE FROM todos WHERE id = ?").run(id).changes > 0;
  }

  /** Cancels calendar todos whose iCal UID is no longer in the feed. */
  cancelCalendarTodosNotIn(activeUids: string[]): number {
    const rows = this.db
      .prepare("SELECT id, source_ref FROM todos WHERE source='calendar' AND status='scheduled'")
      .all() as Pick<Todo, "id" | "source_ref">[];
    const active = new Set(activeUids);
    let cancelled = 0;
    for (const row of rows) {
      if (row.source_ref && !active.has(row.source_ref)) {
        this.db.prepare("UPDATE todos SET status='cancelled' WHERE id = ?").run(row.id);
        cancelled++;
      }
    }
    return cancelled;
  }

  getSetting(key: string): string {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? "";
  }

  setSetting(key: string, value: string): void {
    this.db
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, value);
  }
}
