import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { Config } from "../config.js";
import type { Store } from "../db.js";
import type { Llm } from "../llm.js";
import { createTodo } from "../api.js";
import { parseSubject } from "../parse.js";
import { saveImage } from "../attachments.js";

const CAPTURED_FOLDER = "inboxZero/captured";
const LOOKBACK_DAYS = 14;

/**
 * Scans the inbox for capture mails:
 *  - To contains the capture address (e.g. name+todo@…), subject/body free-form (grammar fast path, LLM otherwise)
 *  - or a self-sent mail with an @-date subject (grammar fast path)
 * Successfully captured mails are moved to the "inboxZero/captured" folder.
 * On LLM errors the mail stays in the inbox (the next tick retries).
 */
export async function captureFromImap(store: Store, config: Config, llm: Llm): Promise<void> {
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: config.gmailUser, pass: config.gmailAppPassword },
    logger: false,
  });

  // Gmail drops idle connections; without a listener an 'error' event would crash the process
  client.on("error", (err) => console.error("[imap] connection error:", err.message));

  await client.connect();
  try {
    await client.mailboxCreate(CAPTURED_FOLDER).catch(() => {}); // may already exist

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
      // already captured (e.g. move failed on the last run) → just tidy up
      if (!store.findBySourceRef("email", mail.messageId)) {
        const grammar = parseSubject(mail.subject, new Date());
        const parsed = await simpleParser(mail.source);
        const bodyText = (parsed.text ?? "").trim();

        // first image attachment (e.g. a shared screenshot) is analyzed and later re-attached to the surfaced mail
        const imageAttachment = parsed.attachments.find((a) => a.contentType?.startsWith("image/"));
        const imageBase64 = imageAttachment ? imageAttachment.content.toString("base64") : null;

        let input;
        if (grammar) {
          input = {
            title: grammar.title,
            due: grammar.due,
            time: grammar.time,
            leadDays: grammar.leadDays,
            notes: bodyText ? bodyText.slice(0, 1000) : null,
            url: /https?:\/\/\S+/.exec(bodyText)?.[0] ?? null,
            imagePath: imageBase64 ? saveImage(config.dataDir, imageBase64) : null,
          };
        } else {
          try {
            const structured = await llm.structureTodo(
              [mail.subject, bodyText].filter(Boolean).join("\n\n") || null,
              imageBase64,
            );
            input = {
              title: structured.title,
              due: structured.due,
              time: structured.time,
              leadDays: structured.leadDays,
              notes: structured.notes,
              context: structured.context,
              url: structured.url,
              imagePath: imageBase64 ? saveImage(config.dataDir, imageBase64) : null,
            };
          } catch (err) {
            console.error(`[imap] LLM error for "${mail.subject}" — mail stays in inbox:`, err);
            continue;
          }
        }

        const todo = createTodo(store, config, input, "email", mail.messageId);
        console.log(`[imap] captured: #${todo.id} "${todo.title}" (inbox on ${todo.surface_date})`);
      }

      await client.messageMove(String(mail.uid), CAPTURED_FOLDER, { uid: true });
    }
  } finally {
    await client.logout().catch(() => {});
  }
}
