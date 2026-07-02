function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Fehlende Env-Variable: ${name}`);
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

export const config = {
  port: Number(optional("PORT", "3000")),
  dataDir: optional("DATA_DIR", "./data"),

  gmailUser: required("GMAIL_USER"),
  gmailAppPassword: required("GMAIL_APP_PASSWORD"),
  /** Plus-Adresse, deren Auftauchen im To-Header eine Mail als Erfassung markiert */
  captureAddress: optional("CAPTURE_ADDRESS", "").toLowerCase(),

  apiToken: required("API_TOKEN"),
  uiUser: required("UI_USER"),
  uiPassword: required("UI_PASSWORD"),

  ollamaUrl: optional("OLLAMA_URL", "http://192.168.178.250:11434").replace(/\/$/, ""),
  icsUrl: optional("ICS_URL", ""),

  defaultLeadDays: Number(optional("DEFAULT_LEAD_DAYS", "2")),
  /** Öffentliche Basis-URL des Service für Links in gesendeten Mails */
  baseUrl: optional("BASE_URL", "").replace(/\/$/, ""),
};
export type Config = typeof config;
