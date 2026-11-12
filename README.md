#Desktop ERP

A keyboard-first desktop application for accounting, billing, inventory and business reporting. Built with Electron and JavaScript, with a local PostgreSQL database managed by the app.

This repository contains **Speedoone-Pos2.0**, the desktop application. It can run locally without the separate Speedo One web, backend or mobile repositories. Connecting to the Speedo One backend is optional.

## Requirements

- Node.js **22.12 or newer** and npm.
- Git to clone this repository.
- Windows for the documented installer build. Development on other platforms depends on Electron and embedded PostgreSQL binary availability; the Windows workflow is the primary tested path.
- Internet access for the initial dependency installation. Local accounting does not require an internet connection.

No separate PostgreSQL installation, database provisioning or `.env` file is required for local use. Dependency installation scripts must be enabled: Electron and embedded PostgreSQL need their platform binaries.

## Setup and run

```bash
git clone https://github.com/prithvi438/desktop-erp.git
cd desktop-erp
npm ci
npm start
```

`npm ci` installs the versions recorded in `package-lock.json`. Use `npm install` when intentionally changing dependencies, and commit the updated lockfile.

On first launch, the app initializes its local database. Configure your company and financial year in **Companies & years**, then create your account and inventory masters. Existing legacy SQLite books are migrated by the app; do not delete or manually replace them.

### Development commands

| Command | Purpose |
| --- | --- |
| `npm start` | Launch the desktop application |
| `npm test` | Run the automated suite using an isolated PostgreSQL database |
| `npm run test:sqlite` | Run legacy SQLite compatibility tests |
| `npm run smoke` | Run the basic Electron UI smoke test |
| `npm run smoke:report-heads` | Check report menus and keyboard navigation |
| `npm run smoke:gst-entry` | Check GST slab selection and tax postings |
| `npm run smoke:reference-enter` | Check Enter-driven bill allocation |
| `npm run smoke:calculator` | Check calculator settings and keyboard behavior |
| `npm run dist:win` | Build the Windows x64 installer |
| `npm run` | List all available scripts |

UI smoke tests open desktop windows and use isolated temporary books. Run them in a desktop session. The test scripts are intended for development, not for entering real business data.

## Build a Windows installer

From a Windows checkout with dependencies installed:

```powershell
npm ci
npm run dist:win
```

The installer is generated under `dist/`:

```text
Speedo-One-Books-<version>-Setup-x64.exe
```

The installer includes Electron and PostgreSQL, so users do not need Node.js or PostgreSQL installed separately. The build does not upload a GitHub release. Builds are unsigned unless signing credentials are configured separately. The installer configuration is in `electron-builder.yml`.

Close the development app before launching an installed build: both use the same default books directory. Uninstalling is configured to preserve application data.

## Main features

- Multiple companies and financial years, with date and period selection.
- Masters for account groups, ledgers, items, categories, groups, units, GST slabs and HSN/SAC codes.
- Sales, purchases, returns, payments, receipts, contra and journal vouchers.
- Item GST defaults, selection from saved slabs, and interstate/intrastate tax treatment.
- Bill references, outstanding balances and credit controls.
- Configurable inventory features including batches, expiry, discounts and offers.
- Daybook, transaction registers, ledger accounts and stock registers.
- Categorized financial and inventory reports, with ledger drill-down and Excel/PDF export on supported reports.
- Dashboard charts, a user greeting, light/dark themes and an optional floating calculator.
- Local backup/restore and optional Speedo One synchronization.

Financial and statutory summaries are generated from the configured books. Review classifications, disclosures and report coverage before statutory use; this project does not claim that every report is filing-ready.

## Keyboard workflow

| Shortcut | Action |
| --- | --- |
| `Ctrl+K` | Find a screen |
| `Ctrl+H` | Return to dashboard |
| `Ctrl+B` | Focus the sidebar |
| `F2` | Edit the date where supported |
| `Alt+F2` | Edit the period where supported |
| `Alt+C` | Create the master for the currently focused selection field |
| `Ctrl+Enter` | Edit the selected master where supported |
| `Ctrl+S` | Save |
| `Alt+E` | Export a supported report |
| `Ctrl+Shift+L` | Switch light/dark appearance |
| `Ctrl+Shift+C` | Open/close the calculator, when enabled |
| `Escape` | Close the current dialog or return one navigation level |

Date fields accept digits and add separators automatically. Up Arrow moves a valid date back one day; Down Arrow moves it forward one day. Backspace on an empty field moves to the previous field.

Enable the calculator in **Settings > Forms & feature settings > Use calculator**, then save. It supports arithmetic, percentages, brackets, powers and square roots. Drag its header or use Alt+Arrow keys to reposition it.

Report headings and report lists have separate keyboard focus. Enter moves into a heading's reports; Escape returns to the headings. In the balance sheet, Enter expands a head or opens the selected ledger's entries.

## Data, backups and recovery

On Windows, the default application data location is:

```text
%APPDATA%\speedoone-pos
```

PostgreSQL listens on the loopback interface. The app manages its lifecycle and stores its cluster under `postgres/`. Keep `postgres.credentials` with the cluster; it contains connection information protected by the app's OS-backed storage.

Use **Settings > Backup & restore** to create `.speedobook` backups. Do not copy a running PostgreSQL cluster as a backup. Keep backups outside this source checkout and protect them as business data.

To use a separate data directory, set it before launch. For example, in PowerShell:

```powershell
$env:SPEEDOONE_DATA_DIR = Join-Path $env:LOCALAPPDATA 'SpeedoOne-Development'
npm start
```

This selects a different books directory; it does not move existing books. Remove that session override with `Remove-Item Env:SPEEDOONE_DATA_DIR` before returning to the default location.

### Common startup issues

- **Books already open:** close other Speedo One instances using the same data directory, then retry. Do not delete database files or credentials to bypass the message.
- **Missing Electron/PostgreSQL binaries:** run `npm ci` with dependency scripts enabled and verify that security software has not quarantined the downloaded binaries.
- **Old UI after editing source:** close and restart the app; the desktop renderer is not configured for automatic hot reload.
- **Packaged and development builds conflict:** run only one against a given books directory, or use a separate development directory as shown above.

## Optional cloud connection

Use **Settings > Sync with Speedo One** to connect to a compatible backend. Local work does not require pairing. Sync uses the backend's Tally agent endpoints and is not a substitute for backups; not every local master or inventory field is synchronized.

Never commit connection keys, credentials, real books, attachments or backup archives. The repository's `.gitignore` excludes these runtime artifacts, dependencies and generated installers.

## Project structure

```text
main.js                 Electron main process and application startup
preload.js              Controlled renderer-to-main API bridge
renderer/               Screens, styles and keyboard interactions
src/                    Accounting, inventory, database and business logic
scripts/                Startup, test database and packaging helpers
test/                   Automated tests and Electron UI smoke tests
build/                  Installer assets
electron-builder.yml    Windows installer configuration
```

## Further documentation

- [Companies and financial years](COMPANIES.md)
- [Inventory configuration](INVENTORY.md)
- [Bill references and outstanding management](BILL-REFERENCES.md)
- [Financial reporting](REPORTING.md)
- [Report coverage](REPORT-COVERAGE.md)
- [Feature coverage](FEATURE-PARITY.md)
- [Detailed implementation notes](docs/desktop-notes.md)
