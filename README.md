# Vertragsmanager

A desktop application for phone shops to manage mobile-phone contract sales, track customers, and never miss a contract renewal — with **Excel import**, **automatic reminders**, and **zero-config LAN sync** across multiple PCs.

> Built with Electron + SQLite. German user interface. Windows 10/11 (x64).

---

## Features

- **Records management** — Add, edit, delete mobile-phone contracts with German fields (Datum, Kundenname/Firma, Tarif, N/VVL, PK Klasse, Aktivierungs, Rufnummer, IBAN, Kundenkennwort, Geburtsdatum).
- **Excel import** — Import one or many `.xlsx`/`.csv` files at once:
  - Each worksheet is treated as a provider (Anbieter); the sheet name becomes the brand.
  - Year is auto-detected from the file name and stored per record.
  - Handles inflated/merged headers, skips dealer numbers, and ignores unknown columns gracefully.
  - Progress bar with chunked writing — handles thousands of records without freezing.
- **Excel export** — Export back to Excel, grouped by provider (one sheet per brand).
- **Contract-end & reminders** — Contract end is auto-derived (activation + 2 years). Color-coded; per-brand reminder thresholds (e.g. Vodafone 1 month, others 3 months). In-app reminder filter + Windows notifications (daily check while running in the background).
- **Status tracking** — Three color-coded states per record: *Noch nicht angerufen*, *Überlegt noch*, *Kunde bestätigt*.
- **Filtering** — By year (single year at a time, newest first), provider tabs, status, and live search.
- **WhatsApp reminders** — One click opens WhatsApp with the customer's number and a pre-filled German reminder message (via wa.me, no setup).
- **Zero-config LAN sync** — Multiple PCs on the same network discover each other automatically (UDP + TCP mesh) and sync records in real time. Changes and notifications propagate to all machines. Conflict resolution via last-write-wins.
- **Security & backup** — Optional password lock on startup; automatic daily database backups + manual backup.
- **Statistics** — Dashboard with counts per provider/status/year, contracts ending this month, and confirmation rate.
- **System tray** — Runs in the background (closing the window minimizes to tray) so reminders keep working.

## Tech Stack

- [Electron](https://www.electronjs.org/) (desktop shell)
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) (local database)
- [SheetJS / xlsx](https://github.com/SheetJS/sheetjs) (Excel import/export)
- Node's built-in `net` / `dgram` for the LAN sync (no external dependency)
- Plain HTML/CSS/JS renderer (no framework)

## Getting Started

### Requirements
- [Node.js](https://nodejs.org/) 18+ and npm
- Windows 10/11 (x64)

### Run in development
```bash
npm install
npm start
```

### Build a distributable
```bash
npm run dist
```
Outputs to `dist/`:
- `Vertragsmanager Setup <version>.exe` — installer (per-user, no admin required)
- `Vertragsmanager <version>.exe` — portable (no installation)

> The build is unsigned. On some machines Windows SmartScreen / Smart App Control may warn or block it; choose *More info → Run anyway*, or sign the app with a code-signing certificate.

## Tests

Automated tests use Node's built-in test runner (no extra dependency):
```bash
npm test          # all: logic + parser + sync + database
npm run test:logic  # pure logic, Excel parser, LAN sync
npm run test:db     # database & sync-merge (runs under Electron)
```
See [TEST.md](TEST.md) for coverage details.

## Project Structure

```
main.js          Electron main process (windows, tray, IPC, build glue)
preload.js       Secure bridge between main and renderer
renderer.js      UI logic (table, filters, forms, dialogs)
index.html       UI markup + styles
logic.js         Shared pure logic (dates, phone, IBAN, matching) — used by app and tests
fields.js        Field definitions, header/alias matching, brand aliases, statuses
excelParser.js   Sectioned Excel parser (multi-sheet, dealer-number filtering, dates)
database.js      SQLite access + migrations + sync merge (LWW)
sync.js          Zero-config P2P LAN sync (UDP discovery + TCP mesh)
test/            Automated tests
```

## How LAN Sync Works

Each running instance announces itself via UDP broadcast on the local network and connects to discovered peers over TCP (full mesh). Every record carries a UUID and a last-modified timestamp; on any change the affected records are broadcast to all peers and merged using last-write-wins. No server, IP configuration, or accounts required — just run the app on PCs in the same network. (Windows Firewall may ask to allow the app on private networks once.)

## License

[MIT](LICENSE)
