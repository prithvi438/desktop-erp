# Financial reporting and exports

## Configuration

Open **Settings → Financial reporting**. Choose the presentation used by these books:

- Non-company (proprietorship / partnership): ICAI-style presentation.
- LLP: ICAI-style presentation.
- Company following Accounting Standards: Schedule III Division I presentation.
- Company following Ind AS: Schedule III Division II presentation.

Select INR, thousands, lakhs or millions. Enter accounting policies and supporting disclosure notes. **Alt+M** opens ledger classifications; search, press Enter, choose a heading, return and **Ctrl+S** to save. Changing a presentation or mapping never changes posted vouchers.

Automatic classifications use the group hierarchy and account balance. They are suggestions: review current/non-current maturity, MSME payables, investments, finance costs, depreciation, income tax, OCI and other specialised headings. A later change between a balance-sheet and profit-and-loss account group requires reviewing an incompatible saved mapping.

## Reports

- Balance sheet: equity/capital, non-current/current liabilities and assets, note references, ledger detail and genuine reconciliation differences. Its comparative date is the preceding financial year-end, including when the current report is interim.
- Statement of profit and loss: revenue, expense categories, inventory movement, exceptional items, tax, discontinued operations and profit/loss. Division II also exposes mapped OCI and total comprehensive income. Comparatives cover the corresponding prior-year period.
- Trial balance: actual debit/credit totals with a separate difference, never an artificial balancing entry. It reflects unclosed ledger balances in the books; it does not post year-end closing or adjustment entries.
- Trading account: supporting revenue/cost-of-goods-sold schedule with comparative figures.
- Cash flow: operating/investing/financing grouping of book-derived cash movements. This remains a management summary requiring classification and non-cash adjustment review before AS 3 / Ind AS 7 use.
- Registers, tax, inventory, ageing and management reports retain their operational columns. They are not represented as statutory financial statements.

Use **F2** to focus a financial statement's date, choose the framework for viewing, and Apply. Enter on a ledger detail opens its dedicated account statement. Configuration applies to exports as well as the screen.

## Alt+E exports

On reports, registers and ledger/stock statements, **Alt+E** opens a keyboard-selectable **Excel (.xlsx) / PDF (.pdf)** menu. Choose a format, press Enter and select a save location. Escape cancels. The whole filtered dataset is exported, not only the visible page. The output includes the company, report title, applied dates, units, headings, totals and relevant notes. Excel monetary cells are numeric; labels remain literal text. PDFs use A4, repeated table headers and page numbers. Wider reports use landscape pages. Existing Alt+X CSV shortcuts remain available on shared lists.

Exports are snapshots, not a formula-driven financial model or statutory filing payload. Changing an unsaved date control does not relabel previously loaded data. Financial reports carry a draft status in their heading/notes. General disclosure notes are saved with the books, not versioned by financial year: review them before exporting another period.

## What still requires accounting information

These are configurable draft presentations, **not automatic certification of compliance** with all Accounting Standards, Ind AS or statutory disclosure requirements. The existing books do not contain enough structured information for EPS, share-capital reconciliations, a complete statement of changes in equity, deferred-tax calculations, detailed statutory receivable/payable ageing, commitments/contingencies, related parties, NRV adjustments or all sector-specific disclosures. EPS is left unprovided rather than fabricated. OCI only appears when explicitly mapped. Division III/NBFC, banking, insurance, consolidation and sector-specific formats are not implemented.

Inventory valuation continues to use the existing stock engine. If ledger stock balances coexist with derived inventory, review the warning to avoid duplicate recognition. Posting year-end adjustments, validating opening balances and completing required notes remain necessary.

## Reference basis checked 12 November 2026

- [ICAI, 31 March 2026 applicability announcement](https://www.icai.org/post/23950): non-corporate and LLP guidance applies in phases, covering all such entities for accounting periods beginning on or after 1 April 2026.
- [MCA Schedule III amendment notification, 24 March 2021](https://www.mca.gov.in/Ministry/pdf/ScheduleIIIAmendmentNotification_24032021.pdf).
- [Schedule III, Income Tax Department reproduction](https://wm.incometaxindia.gov.in/w/schedule-iii).
- [ICAI guidance publication: Division II, Ind AS Schedule III](https://publication.icai.org/publication/81).

Validation: `npm test`, `npm run smoke:reports` and `npm run smoke:report-exports` use temporary books. Export tests open the generated workbook, verify numeric cells and styling, generate a multipage PDF, and check keyboard export paths through financial, stock, daybook and ledger reports.
