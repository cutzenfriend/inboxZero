import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

function sniffExtension(base64: string): string {
  if (base64.startsWith("iVBOR")) return "png";
  if (base64.startsWith("/9j/")) return "jpg";
  if (base64.startsWith("R0lGOD")) return "gif";
  if (base64.startsWith("UklGR")) return "webp";
  return "jpg";
}

/** Stores a captured image until the todo is surfaced; returns a path relative to dataDir. */
export function saveImage(dataDir: string, base64: string): string {
  const dir = join(dataDir, "attachments");
  mkdirSync(dir, { recursive: true });
  const relative = join("attachments", `${randomUUID()}.${sniffExtension(base64)}`);
  writeFileSync(join(dataDir, relative), Buffer.from(base64, "base64"));
  return relative;
}

export function deleteImage(dataDir: string, relativePath: string): void {
  rmSync(join(dataDir, relativePath), { force: true });
}
