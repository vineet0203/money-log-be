const { pool } = require('../config/db');
const { PlaidApi, PlaidEnvironments, Configuration } = require('plaid');

require('dotenv').config();

const configuration = new Configuration({
  basePath: PlaidEnvironments[process.env.PLAID_ENV || 'sandbox'],
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET': process.env.PLAID_SECRET,
    },
  },
});

const plaidClient = new PlaidApi(configuration);

/**
 * Syncs transactions for a single Plaid item using the cursor-based sync loop.
 * Safe to call concurrently — upsert pattern handles duplicates.
 * @param {object} item - Must have: id, access_token, transaction_cursor, user_id
 */
async function syncTransactionsForItem(item) {
  let cursor = item.transaction_cursor;
  let hasMore = true;
  let totalAdded = 0, totalModified = 0, totalRemoved = 0;

  const [accounts] = await pool.query(
    'SELECT id, external_id FROM accounts WHERE user_id = ? AND provider = "plaid"',
    [item.user_id]
  );
  const accountMap = {};
  accounts.forEach((acc) => {
    if (acc.external_id) accountMap[acc.external_id] = acc.id;
  });

  while (hasMore) {
    try {
      const syncResponse = await plaidClient.transactionsSync({
        access_token: item.access_token,
        cursor: cursor || undefined,
      });
      const data = syncResponse.data;

      const upsertTransactions = [...data.added, ...data.modified];
      for (const txn of upsertTransactions) {
        const localAccountId = accountMap[txn.account_id];
        if (!localAccountId) continue;

        await pool.query(
          `INSERT INTO account_transactions (
            user_id, account_id, provider_transaction_id, amount, date, name, merchant_name,
            logo_url, currency, payment_channel, primary_category, detailed_category, pending,
            datetime, authorized_date, authorized_datetime, location, payment_meta
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            amount = VALUES(amount), date = VALUES(date), name = VALUES(name), merchant_name = VALUES(merchant_name),
            logo_url = VALUES(logo_url), currency = VALUES(currency), payment_channel = VALUES(payment_channel),
            primary_category = VALUES(primary_category), detailed_category = VALUES(detailed_category), pending = VALUES(pending),
            datetime = VALUES(datetime), authorized_date = VALUES(authorized_date), authorized_datetime = VALUES(authorized_datetime),
            location = VALUES(location), payment_meta = VALUES(payment_meta)`,
          [
            item.user_id, localAccountId, txn.transaction_id, txn.amount, txn.date, txn.name,
            txn.merchant_name || null, txn.logo_url || null, txn.iso_currency_code || 'USD',
            txn.payment_channel || null, txn.personal_finance_category?.primary || null,
            txn.personal_finance_category?.detailed || null, txn.pending ? 1 : 0,
            txn.datetime || null, txn.authorized_date || null, txn.authorized_datetime || null,
            txn.location ? JSON.stringify(txn.location) : null,
            txn.payment_meta ? JSON.stringify(txn.payment_meta) : null,
          ]
        );
      }
      totalAdded += data.added.length;
      totalModified += data.modified.length;

      for (const txn of data.removed) {
        await pool.query(
          'DELETE FROM account_transactions WHERE provider_transaction_id = ? AND user_id = ?',
          [txn.transaction_id, item.user_id]
        );
      }
      totalRemoved += data.removed.length;

      cursor = data.next_cursor;
      hasMore = data.has_more;
    } catch (syncError) {
      console.error(
        `Error syncing transactions for item ${item.id}:`,
        syncError.response?.data || syncError.message
      );
      break;
    }
  }

  if (cursor !== item.transaction_cursor) {
    await pool.query(
      'UPDATE plaid_items SET transaction_cursor = ? WHERE id = ?',
      [cursor, item.id]
    );
  }

  return { added: totalAdded, modified: totalModified, removed: totalRemoved };
}

/**
 * Syncs liabilities for a single Plaid item.
 * Safe to call concurrently — upsert pattern handles duplicates.
 * @param {object} item - Must have: id, access_token, user_id
 */
async function syncLiabilitiesForItem(item) {
  let totalSynced = 0;

  const liabilitiesResponse = await plaidClient.liabilitiesGet({
    access_token: item.access_token,
  });
  const data = liabilitiesResponse.data;

  const [accounts] = await pool.query(
    "SELECT id, external_id FROM accounts WHERE user_id = ? AND provider = 'plaid'",
    [item.user_id]
  );
  const accountMap = {};
  accounts.forEach((acc) => { accountMap[acc.external_id] = acc.id; });

  const upsertLiability = async (accountId, type, details) => {
    const localId = accountMap[accountId];
    if (!localId) return;

    let apr = null, rateType = null, minPayment = null, lastPayment = null, nextDate = null;
    let loanTerm = null, expectedPayoff = null, origPrincipal = null, ytdInterest = null;

    if (type === 'credit') {
      apr = details?.aprs?.[0]?.apr_percentage || null;
      rateType = details?.aprs?.[0]?.apr_type || null;
      minPayment = details?.minimum_payment_amount ?? null;
      lastPayment = details?.last_payment_amount ?? null;
      nextDate = details?.next_payment_due_date || null;
    } else if (type === 'student') {
      apr = details?.interest_rate_percentage ?? null;
      minPayment = details?.minimum_payment_amount ?? null;
      lastPayment = details?.last_payment_amount ?? null;
      nextDate = details?.next_payment_due_date || null;
      expectedPayoff = details?.expected_payoff_date || null;
      origPrincipal = details?.origination_principal_amount ?? null;
      ytdInterest = details?.ytd_interest_paid ?? null;
    } else if (type === 'mortgage') {
      apr = details?.interest_rate?.percentage ?? null;
      rateType = details?.interest_rate?.type || null;
      minPayment = details?.next_monthly_payment ?? null;
      lastPayment = details?.last_payment_amount ?? null;
      nextDate = details?.next_payment_due_date || null;
      loanTerm = details?.loan_term || null;
      expectedPayoff = details?.maturity_date || null;
      origPrincipal = details?.origination_principal_amount ?? null;
      ytdInterest = details?.ytd_interest_paid ?? null;
    }

    // id = LAST_INSERT_ID(id) trick ensures insertId is populated on duplicate key too
    const [result] = await pool.query(
      `INSERT INTO account_liabilities (
        account_id, type, apr, rate_type, minimum_payment, last_payment_amount, next_payment_date,
        loan_term, expected_payoff_date, origination_principal, ytd_interest_paid, raw_data
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        apr = VALUES(apr), rate_type = VALUES(rate_type), minimum_payment = VALUES(minimum_payment),
        last_payment_amount = VALUES(last_payment_amount), next_payment_date = VALUES(next_payment_date),
        loan_term = VALUES(loan_term), expected_payoff_date = VALUES(expected_payoff_date),
        origination_principal = VALUES(origination_principal), ytd_interest_paid = VALUES(ytd_interest_paid),
        raw_data = VALUES(raw_data),
        id = LAST_INSERT_ID(id)`,
      [localId, type, apr, rateType, minPayment, lastPayment, nextDate, loanTerm, expectedPayoff, origPrincipal, ytdInterest, JSON.stringify(details || {})]
    );

    const liabilityId = result.insertId;

    if (liabilityId && type === 'credit' && Array.isArray(details?.aprs)) {
      for (const aprItem of details.aprs) {
        await pool.query(
          `INSERT INTO liability_aprs (
            account_liability_id, apr_type, apr_percentage, balance_subject_to_apr, interest_charge_amount
          ) VALUES (?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            apr_percentage = VALUES(apr_percentage),
            balance_subject_to_apr = VALUES(balance_subject_to_apr),
            interest_charge_amount = VALUES(interest_charge_amount)`,
          [liabilityId, aprItem.apr_type, aprItem.apr_percentage, aprItem.balance_subject_to_apr, aprItem.interest_charge_amount]
        );
      }
    }
    totalSynced++;
  };

  const detailedLiabilities = {};
  if (data.liabilities.credit) data.liabilities.credit.forEach(c => detailedLiabilities[c.account_id] = c);
  if (data.liabilities.student) data.liabilities.student.forEach(s => detailedLiabilities[s.account_id] = s);
  if (data.liabilities.mortgage) data.liabilities.mortgage.forEach(m => detailedLiabilities[m.account_id] = m);

  if (data.accounts) {
    for (const account of data.accounts) {
      if (account.type === 'credit' || account.type === 'loan') {
        const details = detailedLiabilities[account.account_id] || {};
        let type = 'credit';
        if (account.subtype === 'student') type = 'student';
        else if (account.subtype === 'mortgage') type = 'mortgage';
        else if (account.type === 'loan') type = 'loan';
        await upsertLiability(account.account_id, type, details);
      }
    }
  }

  return totalSynced;
}

module.exports = { syncTransactionsForItem, syncLiabilitiesForItem };
