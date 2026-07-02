# inboxZero

Der Gmail-Posteingang als Todo-Liste: Todos landen **zum richtigen Zeitpunkt** (Fälligkeit minus Vorlauf) als E-Mail im Posteingang und bleiben dort, bis sie abgearbeitet sind. Für Mails, die schon da sind, bleibt Gmail-„Zurückstellen" das Mittel der Wahl — dieser Service füllt die Lücke für Aufgaben, die **nicht** per Mail entstehen.

## Wie es funktioniert

- **Erfassen** (drei Wege, alle LLM-gestützt — Freitext genügt):
  1. **Mail an die Plus-Adresse** `dein.name+todo@…` — Betreff/Body frei, z.B. *„Reifen wechseln bis Ende Oktober, erinner mich 5 Tage vorher"*. Ein lokales Ollama extrahiert Titel, Fälligkeit und Vorlauf. Alternativ die exakte Grammatik `@01.03. 5d Titel` (dann ohne LLM). Die Mail verschwindet nach der Erfassung aus dem Posteingang (Label `inboxZero/erfasst`).
  2. **iOS-Kurzbefehl** im Share Sheet → `POST /api/todos/freeform` (siehe unten).
  3. **Kalender**: Termine mit `#todo` im Titel werden automatisch übernommen (geheime iCal-URL, read-only). Vorlauf optional per `5d`-Token im Titel.
- **Auftauchen**: Ein Cron-Job schickt jedes Todo am Stichtag (`Fälligkeit − Vorlauftage`, Standard per `DEFAULT_LEAD_DAYS`) als Mail `✅ <Titel> (fällig <Datum>)` in den Posteingang. Ohne ableitbares Datum erscheint es sofort.
- **Web-UI** (Basic Auth): Liste der geplanten/gesendeten Todos, Erfassungsmaske `/new` (als PWA installierbar), Einstellungen `/settings` für LLM-System-Prompt und Ollama-Modell.

## Setup

1. **Google-App-Passwort** erstellen (2FA vorausgesetzt): <https://myaccount.google.com/apppasswords> → „inboxZero".
2. **iCal-URL** holen (optional): Google Calendar → Einstellungen → Kalender wählen → „Privatadresse im iCal-Format".
3. `.env` anlegen: `cp .env.example .env` und ausfüllen.
4. Starten: `docker compose up -d --build` — oder lokal `npm install && npm run dev`.

## API

Auth: `Authorization: Bearer $API_TOKEN`

| Route | Beschreibung |
| --- | --- |
| `POST /api/todos/freeform` | `{text, due?, leadDays?}` — Ollama strukturiert den Text; explizites `due` überschreibt |
| `POST /api/todos` | `{title, due?, leadDays?, notes?, url?}` — strukturiert, ohne LLM |
| `GET /api/todos?status=scheduled` | Liste |
| `PATCH /api/todos/:id` | Felder ändern (`status: "cancelled"` zum Stornieren) |
| `DELETE /api/todos/:id` | Löschen |

## iPhone

### Share-Sheet-Kurzbefehl „✅ Todo"

In der Kurzbefehle-App einen neuen Kurzbefehl anlegen:

1. **Kurzbefehl-Details** → „Im Share Sheet anzeigen" aktivieren, Eingabetyp: Text, URLs, Safari-Webseiten.
2. Aktion **„Empfange Eingabe"**: Wenn keine Eingabe → „Nach Text fragen" (so funktioniert er auch vom Homescreen/per Siri mit Diktat).
3. Aktion **„Nach Eingabe fragen"** (Typ: Datum, Frage: „Fällig am?") — *optional überspringbar: bei Abbruch einfach weiter*. Wer nie manuell datieren will, lässt diesen Schritt weg — das LLM liest Datumsangaben aus dem Text.
4. Aktion **„Inhalt von URL abrufen"**:
   - URL: `https://<dein-host>/api/todos/freeform`
   - Methode: POST, Header: `Authorization: Bearer <API_TOKEN>`
   - JSON-Body: `text` = Eingabe des Share Sheets (+ ggf. `due` = formatiertes Datum `yyyy-MM-dd` aus Schritt 3)

Danach taucht der Kurzbefehl in jedem Share Sheet auf: Link/Text teilen → fertig, null Tipparbeit.

### Mail-Weg (funktioniert überall, auch Desktop/Outlook)

Mail an `dein.name+todo@…` schicken, Betreff frei. Tipp: die Adresse als Kontakt „✅ Todo" speichern.

### PWA

`https://<dein-host>/new` in Safari öffnen → Teilen → „Zum Home-Bildschirm".

## Betrieb

- SQLite liegt im Volume `./data`.
- Logs: `docker compose logs -f` — zeigt Erfassungen (`[imap]`, `[calendar]`) und Versand (`[surface]`).
- Schlägt die LLM-Strukturierung fehl (Ollama down), bleibt die Erfassungs-Mail im Posteingang und wird beim nächsten Lauf erneut versucht.
