# Report reference and coverage

The installed TallyPrime window was identified on 12 November 2026, but desktop access timed out. No installed report screens or proprietary files were extracted. The implementation uses Speedo One's own data and the following official documentation as behavioural references:

- [Accounting and financial reports](https://help.tallysolutions.com/accounting-financial-reports-tally/)
- [Cash flow and projection](https://help.tallysolutions.com/tally-prime/accounting-financial-reports/cash-flow-and-projection-report-tally/)
- [Funds flow](https://help.tallysolutions.com/funds-flow-report-tally/)
- [Stock ageing](https://help.tallysolutions.com/tally-prime/inventory-reports/stock-ageing-analysis-report-tally/)

## Available in Reports

| Section | Reports |
| --- | --- |
| Financial statements | Day book, trial balance, trading, P&L, balance sheet, monthly cash flow, activity cash summary, monthly funds flow with sources/applications, changes in working capital, ratios |
| Account books | Cash/bank balances with ledger drill-down, ledger statement, group summary with ledger drill-down, sales, purchase, journal, contra, payment, receipt, sales return and purchase return registers |
| Statements of accounts | Party ledgers, receivables/payables ageing, outstanding bills, budgets, existing bad debt/suspense/commission ledger views |
| Inventory books | Stock on hand, stock ledger, item monthly summary, stock journals, category value summary, batches/expiry |
| Statements of inventory | Movement analysis, receipt-age analysis, sales analysis, stock alerts, purchase planning, sales and purchase order lists |
| Statutory summaries | Existing book-derived GST summaries and tax/HSN master listing; neither is a complete filing system |
| Banking and setup | Reconciliation, cheques, chart of accounts, financial years |

Report lists support keyboard selection and the existing Alt+E Excel/PDF export. Period reports use From/To controls (Alt+F2 for period, F2 for date); balance/ageing reports use an as-of date. Cash flow opens month-wise and Enter opens cash-moving vouchers for that month. Enter opens a voucher in its appropriate editor. Funds flow opens month-wise and Enter opens sources/applications. Esc returns to the preceding report.

## Calculation boundaries

- Cash includes Cash-in-Hand and Bank Accounts and descendant groups. Cash-to-bank transfers net to zero per voucher. Gross inflows/outflows are positive/negative **net cash per voucher**, not gross entry sides. Opening balances include all earlier entries. Partial first/last months and empty months are retained.
- Working capital uses Current Assets less Current Liabilities, including inventory at the engine's existing average cost. Sources/applications show net changes in non-current account balances and retained profit. These are book-derived movements, not an automatically adjusted statutory cash-flow statement. Check classifications and non-cash changes. Incomplete openings are not plugged.
- Inventory movement uses base units, includes returns and stock journals, and excludes non-posting orders. Category totals add monetary values rather than incompatible quantities.
- Stock ageing consumes oldest receipts within each item/batch/expiry combination. Returns count as new receipts; shortages are separate negative quantities. This is an explicitly labelled receipt-age estimate, not a valuation-method change or historical batch attribution guarantee.
- Financial statement profiles and statutory limitations remain documented in REPORTING.md.

## Not implemented / not extracted

This is not the entire TallyPrime report suite. Cash projections, full cost-centre/profit-centre reports, godown/location reports, manufacturing/BOM/job-work reports, payroll statements, TDS/TCS returns, GST portal reconciliation and filing, e-invoice/e-way-bill status, detailed statutory schedules, and audit/verification reports need additional source modules and data. They are not displayed as fabricated zero reports. Order lists are not a complete order fulfilment/outstanding analysis. Installed-version visual parity remains unverified because desktop access was unavailable.
