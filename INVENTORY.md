# Inventory features

Open **Settings** in the sidebar. Type to search, use Up/Down and Enter to open a setting, and Escape to return to the directory.

## Enable features

**Inventory features** enables item discount rules, buy/get offers, batches and expiry entry independently. Use **Y/N** or **Left/Right** for Yes/No, **Tab/Enter** to move, and **Ctrl+S** to save. Discount rules and offers are off until enabled; existing batch/expiry behavior is retained until changed.

## Item discounts and offers

**Item discount & offer rules** lists all items. Enter opens sales and purchase minimum/default/maximum percentages and a dated same-item buy/get offer. Existing item forms also open these rules with **Alt+O**.

Offer quantities use the item's stock unit, including when vouchers use related units. Buy 1 / free 1 gives an additional free item for each billed item. Each complete buy quantity on a line earns the free quantity; split lines are evaluated separately. Sales and purchase applicability are independently selectable.

Free quantity appears beside billed quantity. Stock includes both; pricing, percentage discounts and GST calculations use the billed value. Returns let you enter the free quantity actually returned alongside the billed return quantity. Offers that cannot be represented exactly in the selected voucher unit require a smaller related unit.

The books engine enforces discount limits. Existing sales maximum-discount and stop-billing controls also apply. Unchanged historical lines retain their saved discounts and free quantities after settings or rules change.

## Batch and expiry controls

- Disabling batches hides batch entry fields. Named batches must have zero stock before batch tracking can be disabled. History remains intact.
- Disabling expiry entry hides the expiry field on new vouchers; stored expiry remains available for existing stock and historical vouchers.
- Batch suggestions support earliest expiry, oldest received batch and batch-name order.
- **Retail controls → Block sales of expired batches** checks persisted expiry as well as entered expiry.
- The near-expiry day window controls warnings and the existing **Batches & expiry / Stock alerts** reports. Expiry is recorded by month, with that month treated as in date.

## Scope and data retention

Rules and paid/free snapshots are local desktop features and are included in books backups. The current sync connector exports physical quantity and an effective net price; it does not transfer offer definitions or the paid/free split.

This implements same-item buy/get offers and percentage discount rules, rather than all of Marg's inventory product. Cross-item schemes, party/company discount matrices, manufacturing-date tracking and multi-warehouse allocation are not included.

## Verification

- `npm test`: PostgreSQL inventory rules and accounting/stock regression tests.
- `npm run smoke:inventory`: Settings directory, keyboard switches, item rule saving and sales entry in temporary books.
- `npm run smoke:trading-ui`: sales, purchases and both return screens, including save/reopen.
