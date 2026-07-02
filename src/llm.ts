import type { Store } from "./db.js";
import { toIsoDate } from "./parse.js";

export interface StructuredTodo {
  title: string;
  due: string | null;
  leadDays: number | null;
  notes: string | null;
  url: string | null;
}

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    due: { type: ["string", "null"], description: "YYYY-MM-DD oder null" },
    leadDays: { type: ["integer", "null"] },
    notes: { type: ["string", "null"] },
  },
  required: ["title", "due", "leadDays", "notes"],
} as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const URL_PATTERN = /https?:\/\/\S+/;

export class Llm {
  constructor(
    private baseUrl: string,
    private store: Store,
  ) {}

  async listModels(): Promise<string[]> {
    const res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`Ollama /api/tags: HTTP ${res.status}`);
    const data = (await res.json()) as { models?: { name: string }[] };
    return (data.models ?? []).map((m) => m.name);
  }

  private async resolveModel(): Promise<string> {
    const configured = this.store.getSetting("llm_model");
    if (configured) return configured;
    const models = await this.listModels();
    if (!models.length) throw new Error("Ollama hat keine Modelle installiert");
    return models[0]!;
  }

  /** Strukturiert Freitext zu einem Todo. Wirft bei Nichterreichbarkeit/kaputter Antwort. */
  async structureTodo(text: string): Promise<StructuredTodo> {
    const model = await this.resolveModel();
    const systemPrompt = this.store
      .getSetting("llm_system_prompt")
      .replaceAll("{today}", toIsoDate(new Date()));

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        format: RESPONSE_SCHEMA,
        options: { temperature: 0 },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: text },
        ],
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`Ollama /api/chat: HTTP ${res.status}`);

    const data = (await res.json()) as { message?: { content?: string } };
    const raw = data.message?.content;
    if (!raw) throw new Error("Ollama lieferte keine Antwort");

    let parsed: Partial<StructuredTodo>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`Ollama lieferte kein valides JSON: ${raw.slice(0, 200)}`);
    }
    if (!parsed.title?.trim()) throw new Error("Ollama lieferte keinen Titel");

    const due = typeof parsed.due === "string" && ISO_DATE.test(parsed.due) ? parsed.due : null;
    const leadDays =
      typeof parsed.leadDays === "number" && Number.isInteger(parsed.leadDays) && parsed.leadDays >= 0
        ? parsed.leadDays
        : null;

    return {
      title: parsed.title.trim(),
      due,
      leadDays,
      notes: typeof parsed.notes === "string" && parsed.notes.trim() ? parsed.notes.trim() : null,
      // URLs übernehmen wir deterministisch aus dem Originaltext, nicht vom LLM
      url: URL_PATTERN.exec(text)?.[0] ?? null,
    };
  }
}
