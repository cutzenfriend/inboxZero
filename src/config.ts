function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env variable: ${name}`);
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
  /** Plus address; its presence in the To header marks a mail as capture */
  captureAddress: optional("CAPTURE_ADDRESS", "").toLowerCase(),

  apiToken: required("API_TOKEN"),
  uiUser: required("UI_USER"),
  uiPassword: required("UI_PASSWORD"),

  ollamaUrl: optional("OLLAMA_URL", "http://localhost:11434").replace(/\/$/, ""),
  icsUrl: optional("ICS_URL", ""),

  /** Language the LLM writes todo titles/notes in; seeds the setting, changeable in the web UI */
  llmLanguage: optional("LLM_LANGUAGE", "English"),

  defaultLeadDays: Number(optional("DEFAULT_LEAD_DAYS", "2")),
  /** Time of day (HH:MM) at which todo mails land when the todo has no own time */
  surfaceTime: optional("SURFACE_TIME", "07:00"),
  /** Public base URL of this service, used for links in surfaced mails */
  baseUrl: optional("BASE_URL", "").replace(/\/$/, ""),
};
export type Config = typeof config;
