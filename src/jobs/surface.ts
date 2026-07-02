import type { Store } from "../db.js";
import type { Mailer } from "../mail/send.js";
import { toIsoDate } from "../parse.js";

/** Sendet alle fälligen Todos (surface_date <= heute) in den Posteingang. */
export async function surfaceDueTodos(store: Store, mailer: Mailer): Promise<void> {
  const due = store.listDue(toIsoDate(new Date()));
  for (const todo of due) {
    try {
      await mailer.sendTodo(todo);
      store.markSent(todo.id);
      console.log(`[surface] gesendet: #${todo.id} „${todo.title}"`);
    } catch (err) {
      // Bleibt scheduled → nächster Tick versucht es erneut
      console.error(`[surface] Senden fehlgeschlagen für #${todo.id}:`, err);
    }
  }
}
