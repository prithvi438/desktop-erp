# Companies, financial years and periods

Open **Companies & years** from the dashboard right panel, or press **F3** on the dashboard. Type to find a company, use Up/Down and Enter to switch. Alt+C creates a company and opens it. Company details can be edited in Settings → Company. The header identifies the selected company and year.

In this screen, **Alt+Y** opens Financial years for the current company. **Alt+C** adds a financial year by From/To dates; Enter selects a year. Years cannot overlap and must contain at most 366 days. The initial list includes the current Indian financial year and financial years found in existing vouchers. Changing a year reloads the UI to discard stale lists after the normal unsaved-form checks.

Each company has a separate PostgreSQL schema, masters, transactions, attachments, settings and encrypted sync key. Existing books remain in their original schema and become the first company. Additional company schema identities derive from generated paths under `companies/<UUID>/books.db`; this path is an identity, not a new SQLite database. The `companies.json` index records selection and names, is replaced atomically, and contains no database credentials. A failed attempt to open a company leaves the previous company selected. Sync/file operations must finish before changing company or year.

Financial years are periods in continuous company books, not copies of transactions. Ledger and inventory opening balances come from preceding entries; there is no duplicated year-end opening voucher. New/edited vouchers must have dates inside the selected financial year. Select the appropriate year before entering a backdated transaction. Explicit report periods can span financial years without moving or duplicating records. Existing period locks still apply.

## Reports and export

In **Companies & years**, **Alt+F2** sets a company-wide reporting period. New reports and the dashboard use that range, including after a restart. It may span financial years and does not change the year used for voucher entry. Selecting a financial year again resets this override. Individual report date controls change only that report.

- **F2**: date or period-end date. Balance sheet and trial balance remain as-of-date reports.
- **Alt+F2**: period, starting with the From field. Tab moves between date fields; Enter/Apply applies the range. P&L and trading use actual transactions and inventory opening/closing values for the chosen period, with the corresponding prior-year comparison.
- Registers and ledger/stock statements initially use the selected year through the working date. The working date is today if within the year, otherwise its nearest boundary. All dates remains available where supported.
- **Alt+E**: export the displayed report to Excel/PDF, including the applied dates. This extracts a report, not a destructive split or move into a different company.
- Bank reconciliation totals are as of the selected period end; its entry list uses both bounds. Stock expiry and alerts support an as-of date. Purchase planning supports a demand period.

## Preservation and backup

No original books are moved or deleted. No schema migration or data contraction is needed. Backups cover the **selected company**, including all its years and attachments. Back up other companies separately. Restore replaces only the selected company's data after the existing confirmation/safety-backup flow; it does not replace the company index or other companies. Preserve the whole application data directory, including `companies.json`, PostgreSQL data/credentials and per-company sync-key files, for a complete installation backup.

Older application versions only open the original company. Rolling back application code does not delete the additional company schemas; retain the index and data directory so an updated version can find them again. Do not run two versions concurrently against the same profile.
