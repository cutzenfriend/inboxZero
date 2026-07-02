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
    /** Sends a due todo as a mail into the user's own inbox. */
    async sendTodo(todo: Todo): Promise<void> {
      const dueText = todo.due_date ? ` (due ${todo.due_date})` : "";
      const lines = [
        todo.notes ?? "",
        todo.url ?? "",
        "",
        `Source: ${todo.source}`,
        config.baseUrl ? `Manage: ${config.baseUrl}/` : "",
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
