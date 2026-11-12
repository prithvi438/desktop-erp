'use strict';

module.exports = function pricebooksApi(db, BooksError) {
  const q = (sql) => db.prepare(sql);
  const fail = (message) => { throw new BooksError(message); };
  const get = (id) => q('SELECT * FROM pricebooks WHERE id = ?').get(id) || fail('Pricebook not found');
  const integer = (value, label) => {
    if (!Number.isSafeInteger(value) || value < 0) fail(`${label} must be a non-negative number`);
  };
  const transaction = (fn) => {
    db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); db.exec('COMMIT'); return value; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  function pricebooks() {
    return q(`SELECT p.*, (SELECT COUNT(DISTINCT item_id) FROM pricebook_entries WHERE book_id=p.id) AS entryCount
      FROM pricebooks p ORDER BY p.is_default DESC, p.name COLLATE NOCASE`).all();
  }
  function savePricebook({ id = null, name, mode = 'FLAT', pct = 0, active = true, isDefault = false }) {
    name = String(name || '').trim();
    if (!name || name.length > 100) fail('Enter a pricebook name (up to 100 characters)');
    if (!['FLAT', 'MARKUP', 'MARKDOWN'].includes(mode)) fail('Choose flat, markup or markdown');
    integer(pct, 'Percentage');
    if (pct > (mode === 'MARKDOWN' ? 10000 : 100000)) fail('Percentage is too large');
    if (isDefault && !active) fail('The default pricebook must be active');
    if (id) get(id);
    if (q('SELECT id FROM pricebooks WHERE name = ? AND id IS NOT ?').get(name, id)) fail('A pricebook with that name already exists');
    return transaction(() => {
      if (isDefault) q('UPDATE pricebooks SET is_default=0').run();
      const values = [name, mode, pct, active ? 1 : 0, isDefault ? 1 : 0];
      if (id) q('UPDATE pricebooks SET name=?,mode=?,pct=?,active=?,is_default=? WHERE id=?').run(...values, id);
      else id = Number(q('INSERT INTO pricebooks(name,mode,pct,active,is_default) VALUES(?,?,?,?,?)').run(...values).lastInsertRowid);
      return { id };
    });
  }
  function pricebookEntries({ bookId }) {
    get(bookId);
    return q(`SELECT e.item_id AS itemId,e.min_qty AS minQty,e.price,i.name,i.unit
      FROM pricebook_entries e JOIN items i ON i.id=e.item_id WHERE book_id=? ORDER BY i.name,e.min_qty`).all(bookId);
  }
  function setPricebookEntry({ bookId, itemId, minQty = 0, price }) {
    get(bookId);
    if (!q('SELECT id FROM items WHERE id=?').get(itemId)) fail('Choose an item');
    integer(minQty, 'Minimum quantity'); integer(price, 'Price');
    q(`INSERT INTO pricebook_entries(book_id,item_id,min_qty,price) VALUES(?,?,?,?)
      ON CONFLICT(book_id,item_id,min_qty) DO UPDATE SET price=excluded.price`).run(bookId, itemId, minQty, price);
    return { bookId, itemId, minQty };
  }
  function resolvePrice({ itemId, bookId = null, qty = 1000 }) {
    integer(qty, 'Quantity');
    const item = q('SELECT sale_rate FROM items WHERE id=?').get(itemId);
    if (!item) fail('Item not found');
    const book = bookId ? get(bookId) : q('SELECT * FROM pricebooks WHERE active=1 AND is_default=1').get();
    if (!book || !book.active) return { price: item.sale_rate, bookId: null };
    const entry = q(`SELECT price FROM pricebook_entries WHERE book_id=? AND item_id=? AND min_qty<=?
      ORDER BY min_qty DESC LIMIT 1`).get(book.id, itemId, qty);
    const factor = book.mode === 'MARKUP' ? 10000 + book.pct : book.mode === 'MARKDOWN' ? 10000 - book.pct : 10000;
    const price = entry ? entry.price : Math.round(item.sale_rate * factor / 10000);
    if (!Number.isSafeInteger(price)) fail('Calculated price is too large');
    return { price, bookId: book.id };
  }
  return {
    pricebooks, savePricebook, pricebookEntries, setPricebookEntry, resolvePrice,
    deletePricebook({ id }) { get(id); q('DELETE FROM pricebooks WHERE id=?').run(id); return { id }; },
    deletePricebookEntry({ bookId, itemId, minQty }) {
      get(bookId); q('DELETE FROM pricebook_entries WHERE book_id=? AND item_id=? AND min_qty=?').run(bookId, itemId, minQty);
      return { bookId, itemId, minQty };
    },
  };
};
