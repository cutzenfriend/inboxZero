import type { Config } from "../config.js";
import type { Store } from "../db.js";
import type { Mailer } from "../mail/send.js";
import { toIsoDate } from "../parse.js";
import { deleteImage } from "../attachments.js";

/**
 * Sends all due todos into the inbox. A todo is due when its surface_date is in
 * the past, or is today and the current time has reached its surface_time
 * (or the SURFACE_TIME default when the todo has no own time).
 */
export async function surfaceDueTodos(store: Store, config: Config, mailer: Mailer): Promise<void> {
  const now = new Date();
  const today = toIsoDate(now);
  const nowTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  const due = store
    .listDue(today)
    .filter((t) => t.surface_date < today || (t.surface_time ?? config.surfaceTime) <= nowTime);

  for (const todo of due) {
    try {
      await mailer.sendTodo(todo);
      store.markSent(todo.id);
      if (todo.image_path) {
        // the mail carries the image now; the local copy is no longer needed
        deleteImage(config.dataDir, todo.image_path);
        store.clearImagePath(todo.id);
      }
      console.log(`[surface] sent: #${todo.id} "${todo.title}"`);
    } catch (err) {
      // stays scheduled → next tick retries
      console.error(`[surface] sending failed for #${todo.id}:`, err);
    }
  }
}
