import nodemailer from "nodemailer";
import { basename, join } from "node:path";
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
      const dueText = todo.due_date
        ? ` (due ${todo.due_date}${todo.surface_time ? ` ${todo.surface_time}` : ""})`
        : "";
      const sections: string[] = [];
      if (todo.context) sections.push(todo.context);
      const details = [todo.notes, todo.url].filter(Boolean).join("\n");
      if (details) sections.push(details);
      sections.push(
        [`Source: ${todo.source}`, config.baseUrl ? `Manage: ${config.baseUrl}/` : ""].filter(Boolean).join("\n"),
      );

      await transport.sendMail({
        from: `"inboxZero" <${config.gmailUser}>`,
        to: config.gmailUser,
        subject: `✅ ${todo.title}${dueText}`,
        text: sections.join("\n\n"),
        attachments: todo.image_path
          ? [{ filename: basename(todo.image_path), path: join(config.dataDir, todo.image_path) }]
          : [],
      });
    },
  };
}
export type Mailer = ReturnType<typeof createMailer>;
