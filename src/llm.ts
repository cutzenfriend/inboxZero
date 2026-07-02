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

export interface ModelInfo {
  name: string;
  vision: boolean;
}

export class Llm {
  private capsCache = new Map<string, string[]>();

  constructor(
    private baseUrl: string,
    private store: Store,
  ) {}

  private async capabilities(model: string): Promise<string[]> {
    const cached = this.capsCache.get(model);
    if (cached) return cached;
    const res = await fetch(`${this.baseUrl}/api/show`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { capabilities?: string[] };
    const caps = data.capabilities ?? [];
    this.capsCache.set(model, caps);
    return caps;
  }

  async listModels(): Promise<ModelInfo[]> {
    const res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`Ollama /api/tags: HTTP ${res.status}`);
    const data = (await res.json()) as { models?: { name: string }[] };
    const names = (data.models ?? []).map((m) => m.name);
    return Promise.all(
      names.map(async (name) => ({ name, vision: (await this.capabilities(name)).includes("vision") })),
    );
  }

  /** Konfiguriertes Modell; bei Bild-Eingaben automatisch ein Vision-fähiges, falls nötig. */
  private async resolveModel(needVision: boolean): Promise<string> {
    const configured = this.store.getSetting("llm_model");
    if (configured && (!needVision || (await this.capabilities(configured)).includes("vision"))) {
      return configured;
    }
    const models = await this.listModels();
    if (!models.length) throw new Error("Ollama hat keine Modelle installiert");
    if (!needVision) return configured || models[0]!.name;

    const visionModel = models.find((m) => m.vision);
    if (!visionModel) throw new Error("Kein Vision-fähiges Modell in Ollama installiert (z.B. gemma4)");
    if (configured) console.log(`[llm] „${configured}" kann keine Bilder — nutze „${visionModel.name}"`);
    return visionModel.name;
  }

  /**
   * Strukturiert Freitext und/oder ein Bild (base64, z.B. Chat-Screenshot) zu einem Todo.
   * Bilder erfordern ein multimodales Modell (z.B. gemma4). Wirft bei Nichterreichbarkeit/kaputter Antwort.
   */
  async structureTodo(text?: string | null, imageBase64?: string | null): Promise<StructuredTodo> {
    if (!text?.trim() && !imageBase64) throw new Error("Weder Text noch Bild übergeben");
    const model = await this.resolveModel(!!imageBase64);
    const systemPrompt = this.store
      .getSetting("llm_system_prompt")
      .replaceAll("{today}", toIsoDate(new Date()));

    const userContent =
      text?.trim() ||
      "Extrahiere die Aufgabe aus dem angehängten Bild (z.B. Screenshot einer Chat-Nachricht oder eines Dokuments).";

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
          { role: "user", content: userContent, ...(imageBase64 ? { images: [imageBase64] } : {}) },
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
      url: text ? URL_PATTERN.exec(text)?.[0] ?? null : null,
    };
  }
}
