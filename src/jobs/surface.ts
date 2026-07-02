import type { Store } from "../db.js";
import type { Mailer } from "../mail/send.js";
import { toIsoDate } from "../parse.js";

/** Sends all due todos (surface_date <= today) into the inbox. */
export async function surfaceDueTodos(store: Store, mailer: Mailer): Promise<void> {
  const due = store.listDue(toIsoDate(new Date()));
  for (const todo of due) {
    try {
      await mailer.sendTodo(todo);
      store.markSent(todo.id);
      console.log(`[surface] sent: #${todo.id} "${todo.title}"`);
    } catch (err) {
      // stays scheduled → next tick retries
      console.error(`[surface] sending failed for #${todo.id}:`, err);
    }
  }
}
