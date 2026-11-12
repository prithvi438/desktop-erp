# Speedo One Books (desktop)

Keyboard-first accounting, billing and inventory for Windows and macOS, modelled on the Books module of Speedo One. Books are stored in a local PostgreSQL server that the desktop app starts and stops automatically. It listens only on 127.0.0.1; no internet connection is required.

## Run

```bash
npm install
npm start        # open the app
npm test         # accounting, migration and recovery tests on real PostgreSQL
npm run test:sqlite # legacy SQLite compatibility tests for migration
npm run smoke    # drives the real app with key presses on a throwaway books file
npm run smoke:create # checks creation workspaces and function-key switching
npm run smoke:details # checks settings, fields, purchase adjustments and attachment import/export
npm run smoke:manage # checks record maintenance, deletion guards and layouts with keyboard input
npm run smoke:retail # checks pricing, bill matching, planning, backup/restore and sync pages
```

Use Node.js 22.12 or newer to install dependencies. The app and tests run on the Node.js bundled inside Electron. The pinned embedded-postgres package supplies PostgreSQL 18.6 binaries for the host platform; no separate PostgreSQL installation is needed. Dependency install scripts must be enabled.

## Windows installer

Run `npm run dist:win` on Windows after installing dependencies. The x64 installer is written to `dist/Speedo-One-Books-0.1.0-Setup-x64.exe`. It includes Electron and PostgreSQL; the destination computer does not need Node.js. The assisted installer offers an installation directory and creates desktop and Start menu shortcuts. It does not publish a release or launch the app automatically.

Installed builds use the same `%APPDATA%\speedoone-pos` data folder as development builds. Close the running development app before opening the installed app. Uninstalling preserves the books data. PostgreSQL binaries and application files are packaged without ASAR so executable and worker paths remain directly accessible. This local test installer is unsigned unless signing credentials are configured in the build environment.

Data lives in Electron's user-data folder (`%APPDATA%\speedoone-pos` on Windows, `~/Library/Application Support/speedoone-pos` on macOS). Set `SPEEDOONE_DATA_DIR` before starting to use a different folder. PostgreSQL stores its cluster in `postgres/`; the random database password and selected loopback port are kept in `postgres.credentials`, encrypted by the OS in the desktop app. Preserve that credentials file with the cluster. Never copy a running cluster as a backup; use Settings → Backup & restore.

On first launch, an existing `books.db` is read through a consistent SQLite snapshot, upgraded in a temporary copy, and imported into PostgreSQL in one transaction. Every inserted record and every table count is verified, including embedded file bytes. IDs, balances, custom groups and existing cloud pairing are retained. The original SQLite file remains unchanged; a `sqlite-migration-<timestamp>.speedobook` archive is also kept. Later launches use PostgreSQL and do not re-import SQLite. A failed migration opens no working window and leaves the SQLite source intact.

Backups now use `.speedobook`: a versioned, checksummed, streamed data archive including attachments. Restore verifies the archive before replacing data, verifies inserted values and counts, and rolls back on any constraint or checksum failure. It also writes a safety backup and unlinks cloud sync. Backup schema versions must match the app. The retained SQLite file is a pre-migration rollback point only: returning to it after new PostgreSQL entries would omit those entries. Keep PostgreSQL backups for ongoing recovery.

`SPEEDOONE_PG_URL` is an optional developer/test connection override; the desktop normally manages its local service. The synchronous accounting API is retained through a PostgreSQL worker connection, with bound parameters, 64-bit integer storage and checked JavaScript integer conversion. One process owns each books dataset at a time; this change does not enable concurrent terminals or redesign list/report pagination.

## What it does

- **Sales:** quotations, sales orders, invoices, customers, payments received, credit notes and sales returns. Alt+V turns a quotation or order into an invoice.
- **Purchases:** purchase orders, bills, suppliers, payments made, expenses, debit notes and purchase returns.
- **Items and stock:** items with category, brand, unit, HSN, GST rate and reorder level; stock on hand by batch and expiry; stock ledger; stock journals (stock in and out); expiry and low-stock alerts.
- **Banking:** bank and cash accounts, bank transactions, bank reconciliation, and cheques. Received cheques post to Cheques in Hand, then to the bank on clearance. Issued cheques credit the bank when posted. Post-dated cheques post on maturity. Bounce and cancellation create reversing entries; posted cheques cannot be deleted or altered through voucher entry.
- **Pricebooks:** local price lists, flat item overrides, markup/markdown on base sale rate, quantity tiers, one active default, and active/inactive lists. Alt+P selects a pricebook while billing. Saved invoice rates stay unchanged when a pricebook changes or is deleted. Manually entered rates override automatic pricing.
- **Navigation:** compact Create Vouchers, Create Masters, Entries, Reports, Manage Records and Settings workspaces. Function keys select directory categories; Tab and Shift+Tab cycle their options, and Enter opens a list. The dashboard offers daily actions and financial totals.
- **Manage Records:** a central, keyboard-paged list to find, edit and delete ledgers (including customers, suppliers, bank and cash accounts), items, account groups, pricebooks and vouchers. Search, type filters and voucher dates narrow the list. Returning from an editor preserves the search and selected record.
- **Receivables and payables:** party ledgers, debtors and creditors by age of bill, bad debts, suspense and commission accounts.
- **GST:** CGST and SGST for a party in the company's state, IGST for another state; the GSTR-3B and GSTR-1 figures; sales and purchase registers.
- **Accountant:** double-entry vouchers (Contra, Payment, Receipt, Journal, Sales, Purchase), chart of accounts with groups, ledgers, budgets against actual, financial years.
- **Reports:** dashboard, day book, trial balance, trading account, profit and loss, balance sheet, cash flow, ratios. Reports are for the financial year (1 April) to the chosen date, and each figure opens down to the ledger and the voucher behind it.

A sale takes the batch that expires first unless another is chosen, and is refused when the batch does not hold enough. Stock is valued at the item's average purchase cost.

## Sync with Speedo One

Books are offline until they are linked under Settings, Sync with Speedo One. Linking signs in once, picks a business, and stores a key for this computer; the password is not kept. New connections default to **Local to Speedo One**. Select **Two-way** before linking only when incoming web changes are also wanted. The key is encrypted by the operating system and held in `sync.key` beside the books file.

Sync uses the server's Tally agent API (`/api/tally-agent/*` in Speedoone-Backend), so the books appear on the web as a Tally connection under Accounting, Tally sync. Two-way rounds take permitted server changes first; upload-only rounds leave incoming jobs untouched. Both upload ledgers, items and complete changed voucher windows when server settings permit. F5 runs a round; with automatic sync on, one runs every minute. Rejected uploads remain pending, and interrupted voucher ranges recover after restart. Backdated entries outside the connection period and disabled import types are reported instead of silently acknowledged. Status distinguishes the last attempt from the last fully successful round and pages through long errors with PgUp/PgDn.

- A voucher changed in both places is not merged. The server lists it as a conflict to settle on the web.
- Quotations and stock journals are not uploaded: the connector takes no vouchers of those types. Pricebook definitions and cheque register metadata also stay local; cheque accounting vouchers are included in normal voucher sync. Sync is not a complete backup.
- The sync screen shows the linked business ID. Alt+E pauses or enables sync while preserving the link. Pausing disables automatic sync and prevents manual upload; local work continues. Unlink before changing businesses. Settings cannot unlink a business during a running sync.
- A sale or purchase made on the web arrives with its accounting entries and item quantities as the server recorded them; batch expiry is not sent by the server.

`test/sync.test.js` runs the sync against a stand-in server written from the backend code. It has not been run against the live server.

## Retail/distribution extensions

The first Marg-reference retail batch keeps the current design. See
[coverage and remaining work](docs/marg-coverage.json); this is not complete Marg ERP parity.

- **Ledger billing controls:** page to the third section of a ledger/customer master.
  Set a credit amount limit (0 = unlimited), stop sales, or assign a customer
  pricebook. Limits check current posted balance plus the proposed sale; editing
  removes the old bill's contribution first. Pending orders do not reserve credit.
  Customer pricing applies to new lines; existing invoice rates are retained.
- **Item billing controls:** maximum discount, total item quantity per bill,
  stop-billing flag and rack/shelf. Splitting an item across lines cannot bypass
  its quantity limit.
- **Settings → Retail controls:** optionally block expired-batch sales and lock
  transactions through a date. Locked records also reject incoming sync changes.
- **Reports → Receivables & payables → Outstanding bills:** Alt+P chooses a party,
  Alt+T switches bills/payments, and Enter on a payment opens bill allocation.
  Alt+A allocates oldest first; Alt+C clears; Ctrl+S saves. Unmatched credits and
  opening balances are shown separately. Allocations do not create new postings.
  A voucher cannot be reduced below its allocations or deleted until they are
  cleared. This explicit matching screen is separate from the existing FIFO ageing reports.
- **Reports → Inventory → Purchase planning:** compare stock with the higher of
  reorder level and recent net demand. Enter drafts the selected item; Alt+O drafts
  all shortages after choosing a supplier. Review existing pending orders before
  saving; they are not automatically deducted from the suggestion.
- **Reports → Sales, purchases & GST → Sales analysis:** group item sales by item,
  party, month, category or brand. Returns and discounts are included; values exclude
  GST, extra ledger charges and ledger-only invoices. Alt+E exports report/list
  data to Excel or PDF, including the whole filtered list rather than just the visible page.
- **Settings → Backup & restore:** Alt+B saves consistent local books including
  embedded attachments. Alt+R validates and restores a selected backup after a
  native confirmation. Current books are copied to `before-restore-<timestamp>.speedobook`
  in the data folder first. Restoration disconnects sync and returns to the dashboard;
  relink deliberately before transferring restored data to the cloud.

Retail policy fields and bill allocations remain local: the existing Tally
connector does not carry these fields. Master matching is by name; master renames
and deletions are not fully mirrored by the current server contract.

## Keys

| Key | Does |
|---|---|
| Typing on the dashboard, or `Ctrl+K` anywhere | Find any screen or ledger |
| `Up` / `Down`, `PgUp` / `PgDn`, `Enter` on the dashboard | Move through the menu and open |
| `Enter` | Next field; saves on the last one |
| `Esc` | Back |
| `F2` in voucher entry | Document date |
| Arrow keys / Tab in Registers | Switch voucher register; Enter focuses its entries |
| `F2` / `Alt+F2` in Registers or Daybook | Single date / date range; Apply with Enter |
| `Alt+M` / `Alt+L` in Registers | Focus register types / transaction entries |
| `Tab` / `Shift+Tab` in directory options | Next / previous option; Enter opens it |
| `F2`, `Alt+F2` in an open financial report | Date; start of the period on reports with a period |
| `F4`–`F9` | Voucher type; `F8` / `F9` switch the document type |
| `Alt+C` / `Ctrl+Enter` | Create / edit the master in the focused selection field |
| `Alt+D` in master lists | Delete the selected row |
| `Alt+D`, `Alt+N`, `Ctrl+Delete` in item vouchers | Description, add item, remove item line |
| `Ctrl+S` | Save |
| `Ctrl+B`, `Ctrl+H` | Focus the sidebar; return home with an unsaved-document check |
| `Alt+P` in sales entry | Select and apply a pricebook |
| `Alt+R` in sales, purchase or return entry | Focus the bill / original-invoice reference |

On macOS `Cmd` works wherever `Ctrl` is listed.

## Create workspaces

The left sidebar contains **Masters**, **Create Vouchers**, **Daybook**, **Registers**,
**Reports** and **Settings**. Registers lists
all twelve voucher types plus **Ledger Register** and **Stock Register** on the left.
Select a ledger or item and press Enter for its full-width statement; Escape returns
to the same register and search. Voucher registers show ruled transaction lists.
Use arrows or Tab to switch registers, Enter to focus entries, and Enter again to
open the original voucher editor. Each register retains its search and date range.
The selected financial year is shown initially; F2 selects a single day and Alt+F2 selects a period.
Ledger/stock statements, cheques, voucher management, outstanding lists, and period
reports also offer date modes. Balance and ageing reports retain an as-of date.
Reports opens a central list of financial, tax, inventory and party reports.
**Up / Down** selects a report; **Enter** opens it full-width. **Ctrl+L** searches
the report directory. Open reports keep their own date shortcuts and controls. Escape
returns from a list to its directory, then to the dashboard. **Ctrl+K** still jumps
directly to any screen. Individual
new-invoice, new-bill, credit-note, debit-note and voucher-entry shortcuts no longer
occupy sidebar rows; their command-palette aliases still work.

### Manage Records

Open **Manage Records** through Ctrl+K; it is no longer in the sidebar. F1 selects Ledgers,
F2 Items, F3 Account groups, F4 Pricebooks and F5 Vouchers. F6 refreshes the list.
Use Ctrl+L to search, Up/Down to select, PgUp/PgDn to page, Enter or Alt+E to edit,
Alt+C to create and Alt+D to delete. Tab reaches the type filter and voucher date
fields; arrow keys change the native filter. Alt+P opens a pricebook's item prices.
Each list fits the window without scrolling, including at 1100×640.

Deletion asks for confirmation. Used ledgers/items and groups with children stay
protected. Built-in account groups are read-only; custom groups can be renamed
or moved without creating a group cycle. Changes to a group's nature also apply
to its subgroups. Voucher edits and deletions that would leave a batch with
negative stock are rejected atomically. Cheque-managed vouchers must be changed
through the cheque register. Pricebook deletion leaves saved invoice amounts intact.
Category, brand and unit values are edited inside each item master.

### Voucher creation

Create Vouchers opens a sales invoice. Its right sidebar switches between forms:

| Key | Action |
| --- | --- |
| F1 | Sales order |
| F2 | Change document date |
| F3 | Quotation |
| F4 | Contra |
| F5 | Payment |
| F6 | Receipt |
| F7 | Journal |
| F8 | Sales invoice |
| F9 | Purchase bill |
| F10 | Credit note |
| F11 | Debit note |
| F12 | Purchase order |
| Alt+F7 / Alt+F8 | Stock in / stock out |

Create Masters opens ledger creation. Its right sidebar offers F1 Ledger,
F2 Account group, F3 Bank account, F4 Cash account, F5 Supplier, F6 Item,
F7 Customer and F8 Pricebook. Saving a master opens a fresh form of the same type
for repeated entry. Customer, supplier, bank and cash forms start in the correct
account group. Only supported master types have shortcuts.

Both rails support mouse clicks as well as keys. Switching types or leaving a
workspace asks before discarding unsaved entries. **Ctrl+B** focuses the left
sidebar within either workspace; F10 is reserved for credit notes in voucher
creation. Existing F10 sidebar navigation remains available on other screens.
Ctrl+S saves, Ctrl+H returns home, and Esc goes back. Nested create-master dialogs
opened from billing retain their existing behavior.

## Rich local forms

Settings → **Forms & feature settings** controls document details, line discounts
and descriptions, attachments, additional fields, default credit days, default
terms, and rounding new document totals to the nearest rupee.

Settings → **Additional fields** creates fields for documents, items, or ledgers
(including customers and suppliers). Supported types are text, number, date,
choice and Yes/No. Fields can be required, reordered or deactivated. Deactivation
retains saved values; changing a field's scope or type requires a new definition.
Required fields remain visible even when the optional field section is disabled.

- Purchases, invoices, orders and returns retain supplier bill number, order
  number, reference, due/expected date, notes, terms, custom values and files.
- Lines support descriptions and percentage discounts. Discount reduces taxable
  value, GST and purchase stock cost. Extra ledger charges are non-taxable signed
  adjustments; they post to their chosen ledger, not to stock valuation. A manual
  round-off is limited to ±1 rupee. Returns reverse these ledger postings.
- Payment and Receipt start with **Pay from / Receive into**, restricted to cash
  and bank ledgers (including custom subgroups). The other panel accepts one or
  more non-cash/non-bank ledger allocations. The source total and debit/credit
  postings are derived automatically. Enter on an empty allocation continues to
  narration; Alt+N adds another allocation. References, notes, custom fields and
  attachments remain available. Journal and Contra retain the accounting editor;
  saved payments with multiple source accounts or reversal lines also retain it
  so editing does not discard their entries.
- Sales/purchase party selectors accept only Sundry Debtors, Sundry Creditors,
  Cash-in-Hand and Bank Accounts, including custom subgroups. Tax and expense
  ledgers are excluded, and the engine enforces the same party restriction.
- Items support SKU/barcode, description, additional fields and images. Billing
  type-ahead matches the SKU as well as the item name. SKU values are unique.
- Customer/supplier/ledger forms support email, billing address, custom values
  and attachments. Existing ageing remains based on the bill date; recording a
  due date does not change that report's bucket definitions.

**Alt+E** opens a separate record-details page; **Alt+A** chooses files through a
native file picker and opens the attachments page. Enter walks through quantity, rate, discount (when enabled) and GST,
then adds the next item line. Tab also walks the line and Shift+Tab moves backward.
Ctrl+Enter edits the selected master when an item or ledger selection field is focused; on numeric fields it finishes the line. Alt+N adds an item, Alt+D edits
its description and Ctrl+Delete removes the active line with confirmation when
filled. Enter on an empty item removes that blank row and opens **Ledger / expense
entries** on a separate page (also Alt+L). Select a ledger, enter a signed amount,
then Enter adds the next ledger row. Enter on an empty ledger returns to the voucher's narration. Sales, purchases
and their returns can contain ledger amounts only; these save and reopen through
the document editor and appear in the registers without moving stock. These ledger
amounts use the existing non-taxable charge rules; no GST is inferred from a ledger.
Stock journals still require items, and quotations/orders require at least one item.
Quotations hide batch
columns and expose validity, customer reference and terms. Ctrl+S saves the record and all its details in
one PostgreSQL transaction. Validation failure rolls back the accounting change.

Voucher and master entry use fixed pages at the supported 1100×640 minimum window
size. Item rows, accounting rows, payment allocations, ledger charges and attachment
cards use Page Up/Page Down instead of extending a scrolling form. Focus follows
new lines automatically. Master sections also page as Enter/Tab moves between them.
Details/custom fields use pages of four fields; item descriptions open with Alt+D.
Ctrl+Enter or Escape returns from a detail page and retains changes in the draft.
Ctrl+S from a detail page returns and saves the owning record. Going Home still checks
for unsaved changes. Dropdowns and command-palette results page with arrow keys.

Images (PNG/JPEG/WebP) and PDFs are held as bytes inside PostgreSQL, not as links
to the original file. Up to ten files, ten MB each, can be attached per record.
Image thumbnails, removing attachments, and saving a copy work offline. Removing
a saved attachment takes effect on saving the record. Discarding an unsaved form
cleans up its newly selected files. Files staged when the application crashes may
remain unbound in the database; there is not yet a storage-maintenance screen.

These local details, field definitions and files are **not transferred by the
current Tally connector**. Financial postings transfer through its existing
contract; discounted lines export net unit rates and exact net line amounts.
Complete attachment/custom-field cloud replication requires a separate backend
contract and Drive integration. No live cloud data was changed by these tests.

## Item and tax masters

While altering a saved ledger, **F1** (or **Account entries**) opens its dedicated, full-width account statement without an account picker. The ruled table shows particulars, debit, credit and running balance, with period controls and entry search. Enter opens a voucher; Esc returns to the ledger form with any unsaved edits preserved. Viewing the statement does not save the ledger draft.

Searchable lists support **type to search**: when focus is on the list or its navigation controls, start typing to focus its search box and begin a new query. This applies to every Masters category, shared searchable registers, retail lists, account/stock selection and workspace menus. Existing text, date, amount and other form inputs keep their normal typing behavior.

The Masters menu is grouped into **Accounting**, **Inventory**, and **GST & Taxes**. Optional item Dropdowns appear under Inventory. Arrow/Page Up/Page Down navigation follows the displayed groups; existing function-key shortcuts remain unchanged.

In Masters, **F11** opens GST slabs and **F12** opens HSN / SAC directly. **F9** continues to refresh the current list.

**Registers → Ledger Register / Stock Register** lists all ledgers or stock items. Type to search and press Enter to open a full-width statement. Ledger entries show debit, credit and running balance; stock entries show party, voucher, traded quantity/rate, stock in/out and running stock. Statements initially use the selected financial year. Alt+F2 focuses date filters; Ctrl+R applies them. Enter opens the selected voucher and Alt+E exports entries to Excel or PDF. Escape returns to the register with the search retained. Masters and existing statement report shortcuts remain available.

Units have a name, symbol and description. For example, create **Gram / g** as independent, then **Kilogram / kg**, inheriting from Gram with equivalent quantity **1000**. Chains and decimal factors are supported, such as Centimetre → Metre → Kilometre. Each item has one stock unit; related units appear next to quantity in voucher entry. Quantities convert exactly into the stock unit, while the entered unit, quantity and unit price are retained when reopening a voucher. Stock on hand shows equivalent balances rather than separate inventories. Stock precision is 0.001 of the item's stock unit; choose a sufficiently small stock unit for your business. Conversions and item stock units cannot be changed after their unit family/items have documents. Referenced units cannot be deleted.

The compact item form shows item details beside pricing/GST, with visible Save/Cancel controls. **Alt+B** expands pricebooks, billing limits and location; **Alt+E** opens additional/custom fields. Existing plain-text units remain usable and can be linked to a unit master with the same symbol without changing stock quantities. Unit relationships and saved voucher units are included in existing backups; this update uses the existing master/detail storage and does not rebuild stock history.

While focused on a master selection field, press **Alt+C** to create the related master without leaving your draft. Save with **Ctrl+S** to return with the new master selected; Escape cancels and restores the original field. Nested creation is supported, including item → HSN → GST slab. Available for item category/group/unit/HSN/slab/pricebook, ledger account group/pricebook, account-group parent, and the item selector in pricebook entries. Fixed choices such as Yes/No and pricing mode remain fixed lists. Ctrl+Enter edits the selected or highlighted master and returns with its updated value selected. Sales/purchase items, parties, additional charges, journal ledgers, payment/receipt accounts and cheque accounts use these same shortcuts. Editing an item from a voucher retains the draft quantity and price. The right-side list shows the available shortcuts; F2 remains the voucher date shortcut.

Masters includes item categories, item groups, units, company GST registrations, GST slabs and HSN / SAC codes. Create a slab, map it to an HSN, then select that HSN in the item form to fill the tax rate. Item creation also maps category, group, unit and an optional base price in a pricebook. Quantity tiers remain under Pricebooks → Item prices. Rates and classifications are user configured; no statutory rates are seeded.

Enable **Settings → Forms & features → Show Dropdowns in Masters** to manage custom item choices such as Colour and Size. Fill these through the item's **Alt+E Details** panel. Masters supports typing to search, arrows and Page Up/Down, Alt+C create, Enter edit, Alt+D delete and Ctrl+S save. Referenced masters cannot be deleted. Changes to mapped names/rates update item defaults while saved vouchers retain their posted amounts. The default company GST registration supplies billing GSTIN, state and address.

Catalog records and mappings are included in PostgreSQL backups. Backups from the preceding schema version remain restorable. These masters are local desktop data; connector metadata sync is not extended by this feature.

## Layout

- `src/books.js` is the engine. Money is integer paise, quantities are integer thousandths, GST rates are hundredths of a percent, and entry amounts are signed (debit positive). `MIGRATIONS` holds one entry per schema version.
- `src/sync.js` is the sync with the server and `src/xml.js` the small XML reader it uses.
- `src/postgres.js` and `src/postgres-worker.js` adapt the engine to PostgreSQL. `src/local-postgres.js` manages the loopback service; `src/desktop-books.js` migrates existing SQLite books; `src/postgres-backup.js` supplies transactional backups and restores. SQLite remains only for legacy migration and compatibility tests.
- `src/details.js` validates form settings and additional fields and stores record details and attachment bytes inside PostgreSQL. `renderer/details.js` supplies the reusable record-details panel; `renderer/settings.js` manages local form settings and field definitions.
- `main.js` and `preload.js` expose the engine to the window over one IPC channel.
- `renderer/` is the interface, in plain ES modules with no build step: `app.js` is the shell (menu, dashboard, palette), `router.js` the screen stack, `ui.js` the shared widgets, and `reports.js` every register and report.

## Not built yet

Full web Books parity is not complete. Remaining areas include godowns and transfers, serial inventory, fixed assets, commission rules and accruals, deals, freight, cost centres, import utilities, expanded report packs, e-invoice/e-way bill integrations, printing/export, permissions and installers. Pricebooks and cheques now have local workflows, but their full web capabilities and metadata sync are not implemented. See [FEATURE-PARITY.md](FEATURE-PARITY.md) for the audited scope and connector boundaries.

## Multiple companies and financial years

Open **Companies & years** from the dashboard right panel, or press **F3** on the dashboard. Alt+C creates a company; Enter switches to it. Alt+Y opens the selected company?s financial years; Alt+C adds a year and Enter selects it. Reports default to that year, while custom periods may span years. F2 changes a date, Alt+F2 changes a period, and Alt+E exports the displayed report. See [COMPANIES.md](COMPANIES.md) for isolation, carry-forward and per-company backup details.
## Outstanding references and credit control

Open **Outstandings** to review customer/supplier dues, advances, overdue bills and credit utilisation. In vouchers, **Alt+B** opens New Ref, Against Ref, Advance and On Account allocations. In the party outstanding screen, **Alt+S** selects bills, **Alt+B** creates a full or partial settlement, and **Alt+A** adjusts an existing voucher's references. See [BILL-REFERENCES.md](BILL-REFERENCES.md) for keyboard usage, preservation behaviour and scope.

Date entry uses DD-MM-YYYY throughout vouchers, reports, periods, due dates and date dialogs. Type just digits (for example, `12112026`) and the separators appear automatically. Existing formatted dates can still be pasted; invalid calendar dates are rejected. The sidebar displays the active company name, wrapping long names in smaller text. Companies & years remains available from the simplified dashboard panel with F3.

Financial statements support **Alt+P** for keyboard presentation selection and **Alt+O** for reviewing opening balances. Ledger entry previews the opening mismatch and asks before saving an opening change that leaves debits and credits unequal. New liability/income ledgers default to Cr; users can deliberately change the side. Openings can be entered progressively; the difference disappears only when real corresponding opening balances agree. No capital, suspense or other balancing entry is invented. This follows Tally's documented distinction between balanced vouchers and incomplete opening balances: https://help.tallysolutions.com/trial-balance-tally/ . Existing company balances are not altered by this UI change.

The dashboard includes monthly net sales/purchases, cash inflow/outflow, expense composition and cash/bank closing-balance charts for the selected reporting period. Figures come from ledger/report APIs; no sample values are shown in live books. Expand **View figures** with Enter/Space or open the related report. **Alt+D** focuses dashboard charts, where arrows and Page Up/Down scroll the dashboard. F3 still opens Companies & years from the Masters-style workspace menu. The application uses a lighter neutral/teal palette and local Segoe UI typography without changing screen routes or data-entry structure.

Appearance: **Ctrl+Shift+L** switches light/dark mode everywhere, including open dialogs, without changing focus or draft data. The header also has a keyboard-focusable theme button. The preference is stored locally for the desktop profile and restored before the UI loads; the first launch follows the system preference. Glass surfaces, subtle entrance fades and lighter typography preserve the existing keyboard layout. System reduced-motion and reduced-transparency preferences are respected. Theme styling does not alter generated PDF/Excel report formats. Run `npm run smoke:theme` to check switching, persistence, modal focus and report/master surfaces.

The appearance now follows the supplied visual references: pastel lavender/peach/ice-blue pearl glass in light mode, and warm smoked graphite glass in dark mode. Translucent cards use fine reflective borders, inset highlights and soft depth; typography and chart accents follow the same palette. This is a styling-only update: screen structure, options, accounting behavior, tab order and shortcuts remain unchanged.

Dashboard voucher actions now live under **Company workspace > Voucher creation** instead of above the KPI cards. Their keys are shared with Create Vouchers: **F8 Sales**, **F9 Purchase**, **F6 Receipt**, **F5 Payment**. Masters and voucher-type menus share the glossy workspace-card treatment; Masters has a wider menu. Active menu choices use filled selection colors without outside outlines. Register widths are contained, and page/content changes use a brief reduced-motion-aware reveal animation.
