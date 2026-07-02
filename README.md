# inboxZero

Use your Gmail inbox as your todo list: todos land in your inbox **at the right moment** (due date minus lead time) as emails and stay there until you deal with them. For mails that are already in your inbox, Gmail's built-in snooze remains the tool of choice — this service fills the gap for tasks that do **not** arrive by mail.

## How it works

- **Capture** (three ways, all LLM-powered — free-form input is enough):
  1. **Mail to your plus address** `your.name+todo@…` — subject/body free-form, e.g. *"Change tires by end of October, remind me 5 days before"*. A local [Ollama](https://ollama.com) extracts title, due date and lead time; image attachments (e.g. screenshots) are analyzed by a vision model. Alternatively use the exact grammar `@01.03. 5d title` (no LLM round-trip). After capture the mail disappears from your inbox (label `inboxZero/captured`).
  2. **iOS shortcut** in the share sheet → `POST /api/todos/freeform` (see below).
  3. **Calendar**: events with `#todo` in the title are picked up automatically (secret iCal URL, read-only). Optional lead time via a `5d` token in the title.
- **Surface**: a cron job mails each todo on its surface date (`due date − lead days`, default via `DEFAULT_LEAD_DAYS`) as `✅ <title> (due <date>)` into your inbox. Without an inferable date it surfaces immediately.
- **Web UI** (basic auth): list of scheduled/sent todos, capture form at `/new` (installable as a PWA), settings at `/settings` for the LLM system prompt, model and todo language.

## Setup

1. Create a **Google app password** (requires 2FA): <https://myaccount.google.com/apppasswords>.
2. Grab your **iCal URL** (optional): Google Calendar → Settings → select calendar → "Secret address in iCal format".
3. Configure via a git-ignored compose override — create `docker-compose.override.yml` next to `docker-compose.yml` with your real values (never commit credentials):

   ```yaml
   services:
     inboxzero:
       environment:
         GMAIL_USER: your.name@gmail.com
         GMAIL_APP_PASSWORD: your-app-password
         CAPTURE_ADDRESS: your.name+todo@gmail.com
         API_TOKEN: long-random-token
         UI_USER: you
         UI_PASSWORD: strong-password
         OLLAMA_URL: http://your-ollama-host:11434
         LLM_LANGUAGE: English   # language the LLM writes todos in
         ICS_URL: https://calendar.google.com/calendar/ical/…/basic.ics
   ```

4. Run: `docker compose up -d --build` — or locally with `npm install && npm run dev` (set the variables in your environment).

All variables and their defaults are listed in [docker-compose.yml](docker-compose.yml).

## API

Auth: `Authorization: Bearer $API_TOKEN`

| Route | Description |
| --- | --- |
| `POST /api/todos/freeform` | `{text?, image?, due?, leadDays?}` — Ollama structures text and/or image (base64, e.g. a chat screenshot); an explicit `due` overrides. Images are analyzed only, never stored |
| `POST /api/todos` | `{title, due?, leadDays?, notes?, url?}` — structured, no LLM |
| `GET /api/todos?status=scheduled` | list |
| `PATCH /api/todos/:id` | update fields (`status: "cancelled"` to cancel) |
| `DELETE /api/todos/:id` | delete |

## iPhone

### Share-sheet shortcut

Create a new shortcut in the Shortcuts app:

1. **Shortcut details** → enable "Show in Share Sheet", input types: text, URLs, Safari web pages, **images**.
2. Action **"Receive input"**: if there is no input → "Ask for Text" (so it also works from the home screen / via Siri dictation).
3. Action **"Ask for Input"** (type: date, prompt: "Due?") — *optional and skippable*. If you never want to date things manually, drop this step — the LLM reads dates from text and images.
4. Action **"If"** — input is an image:
   - **Then:** "Resize Image" (width 1024, keeps the request small) → "Base64 Encode" → **"Get Contents of URL"** with JSON body `image` = base64 text (+ `due` if set)
   - **Otherwise:** **"Get Contents of URL"** with JSON body `text` = shortcut input (+ `due` if set)
   - Both times: URL `https://<your-host>/api/todos/freeform`, method POST, header `Authorization: Bearer <API_TOKEN>`

The shortcut then shows up in every share sheet: share a link, text **or screenshot** → done, zero typing. Example: screenshot of a chat message *"please buy 3 bananas on Friday"* → todo "Buy 3 bananas", due Friday.

> Image capture needs a vision-capable Ollama model. If a non-vision model is selected, the service automatically falls back to a vision model for images; the settings dropdown marks them with 👁.

### Mail (works everywhere, including desktop/Outlook)

Send a mail to `your.name+todo@…`, subject free-form. An attached image (e.g. a screenshot) is analyzed by the vision model too. Tip: save the address as a contact named "✅ Todo".

### PWA

Open `https://<your-host>/new` in Safari → Share → "Add to Home Screen".

## Operations

- SQLite lives in the `./data` volume.
- Logs: `docker compose logs -f` — shows captures (`[imap]`, `[calendar]`) and sends (`[surface]`).
- If LLM structuring fails (Ollama down), the capture mail stays in your inbox and is retried on the next run.
