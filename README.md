# inboxZero

[![Docker Hub](https://img.shields.io/docker/v/cutzenfriend/inboxzero?label=docker%20hub)](https://hub.docker.com/r/cutzenfriend/inboxzero)

Use your Gmail inbox as your todo list: todos land in your inbox **at the right moment** (due date minus lead time) as emails and stay there until you deal with them. For mails that are already in your inbox, Gmail's built-in snooze remains the tool of choice — this service fills the gap for tasks that do **not** arrive by mail.

## How it works

- **Capture** (three ways, all LLM-powered — free-form input is enough):
  1. **Mail to your plus address** `your.name+todo@…` — subject/body free-form, e.g. *"Change tires by end of October, remind me 5 days before"*. A local [Ollama](https://ollama.com) extracts title, due date and lead time; image attachments (e.g. screenshots) are analyzed by a vision model. Alternatively use the exact grammar `@01.03. 5d title` (no LLM round-trip). After capture the mail disappears from your inbox (label `inboxZero/captured`).
  2. **iOS shortcut** in the share sheet → `POST /api/todos/freeform` (see below).
  3. **Calendar**: events with `#todo` in the title are picked up automatically (secret iCal URL, read-only). Optional lead time via a `5d` token in the title.
- **Surface**: a cron job mails each todo on its surface date (`due date − lead days`, default via `DEFAULT_LEAD_DAYS`) as `✅ <title> (due <date>)` into your inbox — at the todo's own time of day, or at `SURFACE_TIME` (default 07:00) when it has none. The mail body carries the AI-generated context (2-3 sentences), notes and link; a captured image comes along as attachment. Without an inferable date the todo surfaces immediately.
- **Web UI** (basic auth): list of scheduled/sent todos, capture form at `/new` (installable as a PWA), settings at `/settings` for the LLM system prompt, model and todo language.

## Setup

1. Create a **Google app password** (requires 2FA): <https://myaccount.google.com/apppasswords>.
2. Grab your **iCal URL** (optional): Google Calendar → Settings → select calendar → "Secret address in iCal format".
3. Create a `docker-compose.yml` and fill in your values (full reference with comments: [docker-compose.yml](docker-compose.yml)):

   ```yaml
   services:
     inboxzero:
       image: cutzenfriend/inboxzero:latest
       container_name: inboxzero
       restart: unless-stopped
       ports:
         - "3000:3000"
       environment:
         TZ: Europe/Berlin
         GMAIL_USER: your.name@gmail.com
         GMAIL_APP_PASSWORD: your-app-password
         CAPTURE_ADDRESS: your.name+todo@gmail.com
         API_TOKEN: long-random-token
         UI_USER: you
         UI_PASSWORD: strong-password
         OLLAMA_URL: http://your-ollama-host:11434
         LLM_LANGUAGE: English   # language the LLM writes todos in
         ICS_URL: ""             # secret iCal address, optional
         DEFAULT_LEAD_DAYS: 2
         SURFACE_TIME: "07:00"  # when todo mails land, if the todo has no own time
       volumes:
         # bind mount — the SQLite database lives in ./data next to this file
         - ./data:/app/data
   ```

4. Run: `docker compose up -d` — this pulls the prebuilt image [`cutzenfriend/inboxzero`](https://hub.docker.com/r/cutzenfriend/inboxzero) from Docker Hub.

The SQLite database is stored in the `./data` bind mount — back up or migrate by copying that directory.

### Building from source

- Local dev: `npm install && npm run dev` (set the variables in your environment).
- Docker: `docker compose build` tags a local build as `cutzenfriend/inboxzero`, `docker compose push` publishes it to Docker Hub.

## API

Auth: `Authorization: Bearer $API_TOKEN`

| Route | Description |
| --- | --- |
| `POST /api/todos/freeform` | `{text?, image?, due?, time?, leadDays?}` — Ollama structures text and/or image (base64, e.g. a chat screenshot) into title, due date, time, lead days and a short context; explicit `due`/`time` override. Text and image can be combined. A captured image is kept until the todo is surfaced and attached to the mail |
| `POST /api/todos` | `{title, due?, time?, leadDays?, notes?, url?}` — structured, no LLM |
| `GET /api/todos?status=scheduled` | list |
| `PATCH /api/todos/:id` | update fields (`status: "cancelled"` to cancel) |
| `DELETE /api/todos/:id` | delete |

## iPhone

### Share-sheet shortcut

Create a new shortcut in the Shortcuts app:

1. **Shortcut details** → enable "Show in Share Sheet", input types: text, URLs, Safari web pages, **images**.
2. Action **"Receive input"**: if there is no input → "Ask for Text" (so it also works from the home screen / via Siri dictation).
3. Optional action **"Ask for Input"** (type: text, prompt: "Note (optional)") — lets you add a note to a shared link or screenshot; just tap Done to skip. Include the result in the JSON body as described below.
4. Action **"If"** — input is an image:
   - **Then:** "Resize Image" (width 1024, keeps the request small) → "Base64 Encode" → **"Get Contents of URL"** with JSON body `image` = the Base64 Encoded variable (not the raw image!) and `text` = the note from step 3
   - **Otherwise:** **"Get Contents of URL"** with JSON body `text` = note from step 3 + shortcut input (put both variables into the same value field)
   - Both times: URL `https://<your-host>/api/todos/freeform`, method POST, header `Authorization: Bearer <API_TOKEN>`

The shortcut then shows up in every share sheet: share a link, text **or screenshot** → done, zero typing. Example: screenshot of a chat message *"please buy 3 bananas on Friday"* → todo "Buy 3 bananas", due Friday.

> Image capture needs a vision-capable Ollama model. If a non-vision model is selected, the service automatically falls back to a vision model for images; the settings dropdown marks them with 👁.

### Mail (works everywhere, including desktop/Outlook)

Send a mail to `your.name+todo@…`, subject free-form. An attached image (e.g. a screenshot) is analyzed by the vision model too and re-attached to the surfaced mail. Tip: save the address as a contact named "✅ Todo".

### PWA

Open `https://<your-host>/new` in Safari → Share → "Add to Home Screen".

## Operations

- SQLite lives in the `./data` bind mount.
- Logs: `docker compose logs -f` — shows captures (`[imap]`, `[calendar]`) and sends (`[surface]`).
- If LLM structuring fails (Ollama down), the capture mail stays in your inbox and is retried on the next run.
