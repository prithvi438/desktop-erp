# Desktop Books parity audit

Audited on 9 November 2026 against the web Books navigation in
`../ERP-Frontend-Web/src/layouts/AppLayout.jsx` (the accounting section),
the pricebook and cheque pages, `pages/products/DocFormPage.jsx`,
`pages/products/ProductSettingsPage.jsx`, and the desktop accounting engine.
The web file `pages/BooksPage.jsx` is the library catalog, not accounting Books.

This desktop implementation is not yet a full replacement for web Books. Entries
are stored in local PostgreSQL. Cloud sync is explicitly linked to a business and can
be paused without interrupting local work.

| Web Books area | Desktop status | Remaining work |
| --- | --- | --- |
| Dashboard and navigation | Financial totals, daily actions, compact Create Vouchers / Create Masters / Entries / Reports / Settings sidebar, grouped right-panel directories, command palette | User-customizable dashboard and saved shortcuts |
| Items, categories, manufacturers, units, HSN | Item maintenance, SKU lookup, descriptions, custom fields, local images and derived master lists | Independent category/unit master management and complete web item fields |
| Pricebooks | Flat overrides, percentage markup/markdown, volume tiers, active/default books, billing selection | Customer-specific book assignment, currencies, complete metadata sync |
| Sales | Customers, quotations, sales orders, invoices, receipts, credit notes | Deals, complete proforma workflow, linked partial fulfilment/returns, e-way bills |
| Purchases | Suppliers, orders, bills, payments, expenses, debit notes; references, due dates, notes/terms, discounts, non-taxable ledger charges, round-off, custom values and attachments | Freight rate rules, taxable charge calculations, immediate-payment allocation, linked partial fulfilment/returns, tax-inclusive pricing |
| Form settings and additional fields | Local feature switches, credit/terms defaults, typed/required/ordered fields for documents/items/ledgers, deactivation preserving data | Web business field mapping, formula/lookup fields, document-type-specific settings |
| Images and files | Local PostgreSQL bytes, native file picker, thumbnails, remove/save-copy, atomic record linking | Cloud Drive transfer, storage maintenance, OCR/photo-to-purchase |
| Stock | On-hand, batches/expiry, stock ledger/journals and alerts | Godowns, transfers, serial units, gate entries, dispatch |
| Banking | Accounts, transactions, reconciliation | Statement import and web reconciliation automation |
| Cheques | Received/issued register, post-dated maturity, deposit, clear, bounce, cancel, protected voucher postings | Cheque printing/layouts/import, edit-before-posting, register metadata sync |
| Receivables/payables | Ledger statements and FIFO ageing | Explicit bill allocations, business partner identity, freight dues |
| Bad debts, suspense, commission | Purpose ledgers | Web-specific settlement flows, commission rules/accruals/payouts |
| GST | Local GST calculations, GSTR-1/3B summaries, purchase/sales registers | Full statutory schemas, filing and external integrations |
| Accountant | Vouchers, chart/groups/ledgers, budgets, financial-year reports | Cost centres, fixed asset lifecycle, unposted events, smart import, bulk utilities |
| Reports | Day book, trial balance, trading, P&L, balance sheet, cash flow, ratios | Full web report catalog, comparative periods, management packs, exports and print layouts |
| Security and administration | OS-encrypted connector key, isolated Electron renderer | Local users, roles/area privileges, audit trail, financial-year locking, backup/restore UI |
| Distribution | Development launch and automated tests | Versioned installers and update workflow |

## Keyboard workflow

- Voucher/master entry uses fixed-height pages. Extra charges, record details, custom fields, item descriptions and attachments open separate keyboard pages; Ctrl+Enter/Escape returns with draft values retained. Ctrl+S saves the owning record. Item/allocation/accounting rows and attachments use Page Up/Page Down; dropdowns page with arrow keys. Compact layouts are verified at 1100×640 and 1100×720 without clipped entry content.

- Ctrl+K searches all desktop screens and ledger statements.
- Ctrl+B focuses the sidebar; F10 also does so outside creation workspaces. Up/Down and Page Up/Down move between its five workspaces. Enter opens the selected workspace.
- Entries, Reports and Settings keep their screen lists on the right. F1–F4 selects an Entries category; Reports uses F1–F5. Tab/Shift+Tab or Up/Down cycles options and Enter opens a result. Ctrl+L searches the workspace. Shift+F2/F3 edits report dates. Escape returns to the directory, then the dashboard.
- Item vouchers use Enter/Tab through quantity, rate, discount and GST. Ctrl+Enter finishes a line, Alt+N adds one, Alt+D edits its description and Ctrl+Delete removes it. Quotations have validity and terms labels and hide batch columns. Master forms group identity, accounting, pricing and tax fields with a persistent Save & create next action.
- Ctrl+H returns to the dashboard; document screens can refuse unsaved changes.
- Existing voucher shortcuts remain in place. Alt+P selects a sales pricebook.
- Payment/Receipt use a cash/bank source and multiple non-cash/non-bank allocations, with balanced postings generated automatically. Custom cash/bank subgroups are supported. Legacy split-source and reversal vouchers keep their accounting editor.
- Sales/purchase parties are restricted to debtors, creditors, cash and bank groups and their subgroups. Empty-item Enter removes the blank item and opens ledger amounts; empty-ledger Enter moves to narration. Alt+L opens the ledger section. Ledger-only sales/purchases save, reopen and appear in registers; these amounts do not calculate GST or move stock.
- Alt+E opens rich record details; Alt+A attaches local images or PDFs.
- Pricebooks: Alt+C creates, Alt+E edits, Enter opens item prices, Alt+D deletes.
  Within item prices, Alt+C adds a base price or quantity tier.
- Cheques: Alt+C records, Alt+M matures, Alt+D deposits, Alt+L clears, Alt+B bounces,
  Alt+X cancels. Ctrl+Delete removes an unposted cheque only.

## Connector boundary

The desktop uses the existing Tally-agent API, not direct writes to cloud
collections. Pairing authenticates, verifies that the selected business belongs
to the account, switches business scope, and creates a connection. The agent key
is kept in OS-encrypted storage; the business ID is saved and displayed locally.

Manual sync requires an enabled link. Automatic sync is separately opt-in.
Pausing disables automatic sync and blocks subsequent manual/background rounds.
Changing the link is refused during an active round. No live business was linked
or modified during this work; connector tests use a local stand-in server.

Supported transfers are ledger/item masters and supported accounting/document
vouchers. Cheque accounting entries transfer as ordinary vouchers; cheque numbers,
lifecycle records, pricebook definitions, additional fields, document metadata
and file bytes do not have corresponding transfers. Discounts export net unit
rates and net amounts; their editable discount percentage remains local.
Quotations and stock journals remain outside the current upload contract. Batch
expiry is not supplied by the server. These limitations mean sync is not a full
backup or full Books feature replication.

Complete parity requires extending the connector contract and business-scoped
backend authorization for missing entities, with stable local IDs, revision and
deletion handling, retry/conflict behavior, schema/version negotiation, and tests
against the actual backend. The UI must not label unsupported entities as synced.

## Validation

`npm test` covers the local accounting engine and a stand-in connector server.
Cheque checks cover posting, maturity, reversal, reconciliation and duplicate
action protection. Pricing checks cover tiers, percentages, defaults, validation
and preserving saved invoices. `npm run smoke` drives a real Electron window
against a temporary PostgreSQL database migrated from SQLite fixtures and captures UI screenshots.
