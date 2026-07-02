import nodemailer from "nodemailer";
import type { Config } from "../config.js";
import type { Todo } from "../db.js";

export function createMailer(config: Config) {
  const transport = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: config.gmailUser, pass: config.gmailAppPassword },
  });

  return {
    /** Schickt ein fälliges Todo als Mail an den eigenen Posteingang. */
    async sendTodo(todo: Todo): Promise<void> {
      const dueText = todo.due_date ? ` (fällig ${formatGerman(todo.due_date)})` : "";
      const lines = [
        todo.notes ?? "",
        todo.url ?? "",
        "",
        `Quelle: ${todo.source}`,
        config.baseUrl ? `Verwalten: ${config.baseUrl}/` : "",
      ].filter(Boolean);

      await transport.sendMail({
        from: `"inboxZero" <${config.gmailUser}>`,
        to: config.gmailUser,
        subject: `✅ ${todo.title}${dueText}`,
        text: lines.join("\n"),
      });
    },
  };
}
export type Mailer = ReturnType<typeof createMailer>;

function formatGerman(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}
