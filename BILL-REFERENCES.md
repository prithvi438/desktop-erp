# Outstanding and credit management

## Reference workflow

Open **Reports > Statements of accounts > Outstanding bills**, select a customer/supplier and press Enter. The party screen includes pending references, all references (including settled bills), against-reference history and all posted vouchers. It shows dues, credits/advances, net balance, overdue amount, credit limit and available credit. F2 changes the as-of date; Alt+F2 selects voucher-date filters. Alt+E exports the displayed list.

In a payment, receipt, journal, sales/purchase invoice or return, **Alt+B** opens bill references inside the voucher. The dialog supports multiple rows:

- **New Ref** creates a named bill, optionally with its own due date. Split an invoice across several references for instalments.
- **Against Ref** selects an opposite-side pending reference belonging to the same party. Enter a partial or full amount; several rows can settle several bills.
- **Advance** creates a named credit that can later be adjusted by a sales/purchase invoice using Against Ref.
- **On Account** leaves an unallocated balance visible for later matching.

Alt+N adds a row; Tab moves through fields; Ctrl+S accepts the dialog. Accepting does not write an entry: the voucher and references commit together when the voucher is saved. Escape cancels the dialog. The rows must exactly total the party posting. Changes in the voucher amount require adjusting its explicit references before saving.

Without explicit bill details, existing sales/purchase-side postings appear as a New Ref using the voucher number or supplied bill reference. Opposite-side postings remain On Account. Existing bill allocations are displayed and preserved; switching a voucher to the new editor converts its party's legacy matches transactionally. Opening balances appear as an automatically settleable opening reference.

## Settle from the outstanding report

Use **Alt+S** to mark due bills and **Alt+B** to settle them. Choose the cash/bank account, date and total payment/receipt amount. The amount can be less than the selected pending total. Review the distribution in the reference dialog and confirm. The application creates one payment/receipt and its allocations atomically. **Alt+A** edits the references of an existing voucher; Enter opens the original voucher editor.

The pending list excludes fully settled references. All references and adjustment history retain them. As-of reports only apply matches whose two sides exist at that date. A payment matched to a future invoice remains an unapplied credit until the invoice date. Due/credit totals reconcile to the party ledger; invoice matching does not post the money twice.

## Credit controls and integrity

Ledger billing controls retain credit days, credit limit and Stop sales, and now include **Stop sales when bills are overdue**. When enabled for a customer, overdue unpaid references block new sales and sales orders. Credit limits take credits/advances into account through the ledger balance. Receivable/payable ageing uses actual reference settlements and due dates rather than assuming FIFO payment matching.

Over-allocation, another party's reference, same-side allocation, mismatched totals, and alterations that invalidate a settlement are rejected. Referenced bills cannot be deleted until their allocations are removed. Existing accounting period locks and selected-financial-year voucher-date rules apply. References, due dates and matching survive per-company backup/restore and remain isolated by company. Like the previous local bill-allocation feature, reference metadata is local; current cloud sync does not export it. Incoming edits that invalidate local references are rejected.

## Reference evidence

The requested REA skill was used to select the observation approach. Its native UI provider is macOS-only. Windows desktop control found TallyPrime, but the existing window was minimised and the opened window's screenshot failed because the foreground process could not be identified. No usable installed Tally bill-allocation screens or proprietary implementation were extracted, and no Tally company records were changed.

Behavioural references are official TallyHelp pages:

- [Bill allocation for payments and receipts](https://help.tallysolutions.com/allocate-bills-for-payments-or-receipts/)
- [Settle outstanding dues](https://help.tallysolutions.com/manage-outstanding-payables-tally/)
- [Adjust a sale against an advance](https://help.tallysolutions.com/sales-against-advance/)
- [Set up receivables and payables tracking](https://help.tallysolutions.com/set-up-receivables-and-payables-tracking-in-tallyprime/)

This implements bill references and credit controls in Speedo One's own accounting engine. It does not calculate GST liability on advances, statutory advance returns, interest, collection reminders or promised-payment workflows.

## Adjust, clear and done

- **Adjust / Against Ref** matches an existing bill or advance. It does not create a second monetary posting.
- **Clear reference (Alt+B)** settles selected pending bills by creating a payment (supplier) or receipt (customer). Partial clearing leaves the unpaid amount pending.
- **Done / cleared bills** lists references whose remaining amount is zero. Status is calculated from allocations: Pending, Partly adjusted, or Done. Marking a dialog Done accepts its rows; it is not a write-off.
- **Undo adjustment (Alt+U)** is a separate action with confirmation. It removes a match, reopens that amount on the bill and leaves the original payment/receipt amount On Account. Ledger postings and net balance remain unchanged. The undone-adjustments view records this operation.

Official Marg documentation lists New reference, Adj Ref and Clear in its bill-adjustment window: https://care.margcompusoft.com/margerp/gst-outward/37084/1/gst-outward . It does not establish every label's exact semantics. Speedo One's Clear action follows the user's explicit choice to settle a pending bill.
