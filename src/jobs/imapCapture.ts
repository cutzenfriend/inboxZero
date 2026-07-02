import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { Config } from "../config.js";
import type { Store } from "../db.js";
import type { Llm } from "../llm.js";
import { createTodo } from "../api.js";
import { parseSubject } from "../parse.js";

const CAPTURED_FOLDER = "inboxZero/erfasst";
const LOOKBACK_DAYS = 14;

/**
 * Durchsucht den Posteingang nach Erfassungs-Mails:
 *  - To enthält die Capture-Adresse (z.B. name+todo@…), Betreff/Body frei (Grammatik, sonst LLM)
 *  - oder Mail von sich selbst mit @-Datums-Betreff (Grammatik-Fast-Path)
 * Erfolgreich erfasste Mails wandern in den Ordner "inboxZero/erfasst".
 * Bei LLM-Fehlern bleibt die Mail im Posteingang (nächster Tick versucht es erneut).
 */
export async function captureFromImap(store: Store, config: Config, llm: Llm): Promise<void> {
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: config.gmailUser, pass: config.gmailAppPassword },
    logger: false,
  });

  await client.connect();
  try {
    await client.mailboxCreate(CAPTURED_FOLDER).catch(() => {}); // existiert ggf. schon

    const lock = await client.getMailboxLock("INBOX");
    const toCapture: { uid: number; messageId: string; subject: string; source: Buffer }[] = [];
    try {
      const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000);
      const uids = await client.search({ since }, { uid: true });
      if (!uids || uids.length === 0) return;

      for await (const msg of client.fetch(uids, { uid: true, envelope: true, source: true }, { uid: true })) {
        const env = msg.envelope;
        if (!env || !msg.source) continue;
        const subject = env.subject ?? "";
        const recipients = [...(env.to ?? []), ...(env.cc ?? [])]
          .map((a) => a.address?.toLowerCase() ?? "")
          .filter(Boolean);
        const fromSelf = (env.from ?? []).some((a) => a.address?.toLowerCase() === config.gmailUser.toLowerCase());

        const viaCaptureAddress = !!config.captureAddress && recipients.includes(config.captureAddress);
        const viaSelfGrammar = fromSelf && parseSubject(subject, new Date()) !== null;
        if (!viaCaptureAddress && !viaSelfGrammar) continue;

        toCapture.push({
          uid: msg.uid,
          messageId: env.messageId ?? `no-message-id-${msg.uid}`,
          subject,
          source: msg.source,
        });
      }
    } finally {
      lock.release();
    }

    for (const mail of toCapture) {
      // Schon erfasst (z.B. Move beim letzten Lauf gescheitert) → nur noch wegräumen
      if (!store.findBySourceRef("email", mail.messageId)) {
        const grammar = parseSubject(mail.subject, new Date());
        const parsed = await simpleParser(mail.source);
        const bodyText = (parsed.text ?? "").trim();

        let input;
        if (grammar) {
          input = {
            title: grammar.title,
            due: grammar.due,
            leadDays: grammar.leadDays,
            notes: bodyText ? bodyText.slice(0, 1000) : null,
            url: /https?:\/\/\S+/.exec(bodyText)?.[0] ?? null,
          };
        } else {
          try {
            // Erster Bild-Anhang (z.B. geteilter Screenshot) geht mit ans multimodale Modell
            const imageAttachment = parsed.attachments.find((a) => a.contentType?.startsWith("image/"));
            const imageBase64 = imageAttachment ? imageAttachment.content.toString("base64") : null;
            const structured = await llm.structureTodo(
              [mail.subject, bodyText].filter(Boolean).join("\n\n") || null,
              imageBase64,
            );
            input = { title: structured.title, due: structured.due, leadDays: structured.leadDays, notes: structured.notes, url: structured.url };
          } catch (err) {
            console.error(`[imap] LLM-Fehler für „${mail.subject}" — Mail bleibt im Posteingang:`, err);
            continue;
          }
        }

        const todo = createTodo(store, config, input, "email", mail.messageId);
        console.log(`[imap] erfasst: #${todo.id} „${todo.title}" (📥 ${todo.surface_date})`);
      }

      await client.messageMove(String(mail.uid), CAPTURED_FOLDER, { uid: true });
    }
  } finally {
    await client.logout().catch(() => {});
  }
}
