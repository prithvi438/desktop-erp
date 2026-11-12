'use strict';

module.exports = function chequeApi({ db, BooksError, tx, writeVoucher, postingLedger, isDate, today }) {
  const q = sql => db.prepare(sql);
  const fail = message => { throw new BooksError(message); };
  const get = id => q('SELECT * FROM cheques WHERE id=?').get(id) || fail('Cheque not found');
  function cheques() {
    return q(`SELECT c.*,c.number AS name,p.name AS party,b.name AS bank FROM cheques c
      JOIN ledgers p ON p.id=c.party_id JOIN ledgers b ON b.id=c.bank_id ORDER BY c.date DESC,c.id DESC`).all();
  }
  function post(c, date, type, debit, credit, note) {
    const voucher = writeVoucher({ type, date, narration: `${note}: cheque ${c.number}. ${c.narration}`, lines: [
      { ledgerId: debit, amount: c.amount }, { ledgerId: credit, amount: -c.amount },
    ] });
    q('INSERT INTO cheque_vouchers(cheque_id,voucher_id) VALUES(?,?)').run(c.id, voucher.id);
  }
  const holding = () => postingLedger('Cheques in Hand', 'Current Assets');
  function mature(c, date) {
    if (c.direction === 'IN') post(c, date, 'Receipt', holding(), c.party_id, 'Received');
    else post(c, date, 'Payment', c.party_id, c.bank_id, 'Issued');
  }
  function saveCheque({ number, direction, partyId, bankId, amount, date, entryDate = today(), narration = '' }) {
    number = String(number || '').trim();
    if (!number || number.length > 40) fail('Enter a cheque number (up to 40 characters)');
    if (!['IN', 'OUT'].includes(direction)) fail('Choose received (IN) or issued (OUT)');
    if (!isDate(date) || !isDate(entryDate) || entryDate > today()) fail('Enter valid dates; entry date cannot be in the future');
    if (!Number.isSafeInteger(amount) || amount <= 0) fail('Enter a positive cheque amount');
    const party = q('SELECT l.*,g.name AS group_name FROM ledgers l JOIN groups g ON g.id=l.group_id WHERE l.id=?').get(partyId);
    const bank = q('SELECT l.*,g.name AS group_name FROM ledgers l JOIN groups g ON g.id=l.group_id WHERE l.id=?').get(bankId);
    if (!party || ['Bank Accounts', 'Cash-in-Hand'].includes(party.group_name)) fail('Choose a party ledger');
    if (!bank || bank.group_name !== 'Bank Accounts') fail('Choose a bank account');
    if (q('SELECT id FROM cheques WHERE bank_id=? AND direction=? AND number=?').get(bankId, direction, number)) fail('This cheque number is already recorded for the bank');
    return tx(() => {
      const status = date > entryDate ? 'PDC' : 'PENDING';
      const id = Number(q(`INSERT INTO cheques(number,direction,party_id,bank_id,amount,date,entry_date,status,action_date,narration)
        VALUES(?,?,?,?,?,?,?,?,?,?)`).run(number,direction,partyId,bankId,amount,date,entryDate,status,entryDate,String(narration).slice(0,500)).lastInsertRowid);
      if (status === 'PENDING') mature(get(id), entryDate);
      return { id };
    });
  }
  function chequeAction({ id, action, date = today() }) {
    const c = get(id);
    if (!isDate(date) || date < c.action_date || date > today()) fail('Action date must follow the last action and cannot be in the future');
    let next;
    if (action === 'mature' && c.status === 'PDC') {
      if (date < c.date) fail('A post-dated cheque cannot mature before its cheque date');
      next = 'PENDING';
    } else if (action === 'deposit' && c.direction === 'IN' && c.status === 'PENDING') next = 'DEPOSITED';
    else if (action === 'clear' && (c.direction === 'IN' ? c.status === 'DEPOSITED' : c.status === 'PENDING')) next = 'CLEARED';
    else if (action === 'bounce' && ['PENDING', 'DEPOSITED'].includes(c.status)) next = 'BOUNCED';
    else if (action === 'cancel' && ['PDC', 'PENDING', 'DEPOSITED'].includes(c.status)) next = 'CANCELLED';
    else fail(`Cannot ${action} a ${c.status.toLowerCase()} cheque`);
    return tx(() => {
      if (action === 'mature') mature(c, date);
      if (action === 'clear' && c.direction === 'IN') post(c, date, 'Contra', c.bank_id, holding(), 'Cleared');
      if (['bounce', 'cancel'].includes(action) && c.status !== 'PDC') {
        if (c.direction === 'IN') post(c, date, 'Journal', c.party_id, holding(), next);
        else post(c, date, 'Journal', c.bank_id, c.party_id, next);
      }
      if (action === 'clear') {
        q(`INSERT OR REPLACE INTO cleared(voucher_id,ledger_id,date)
          SELECT cv.voucher_id,?,? FROM cheque_vouchers cv JOIN entries e ON e.voucher_id=cv.voucher_id
          WHERE cv.cheque_id=? AND e.ledger_id=?`).run(c.bank_id,date,id,c.bank_id);
      }
      q('UPDATE cheques SET status=?,action_date=? WHERE id=?').run(next,date,id);
      return { id, status: next };
    });
  }
  function deleteCheque({ id }) {
    const c = get(id);
    if (q('SELECT 1 FROM cheque_vouchers WHERE cheque_id=?').get(id)) fail('Posted cheques cannot be deleted; cancel or bounce the cheque instead');
    if (!['PDC','CANCELLED'].includes(c.status)) fail('Only unposted cheques can be deleted');
    q('DELETE FROM cheques WHERE id=?').run(id);
    return { id };
  }
  return { cheques, saveCheque, chequeAction, deleteCheque };
};
