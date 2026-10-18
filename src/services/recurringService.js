const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const { pool } = require('../config/db');

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Normalizes any Date or string to 'YYYY-MM-DD'
 */
function toDateString(d) {
  if (!d) return null;
  if (d instanceof Date) {
    return d.toISOString().split('T')[0];
  }
  return String(d).split('T')[0];
}

/**
 * Calculates the next due date following `currentDateStr` according to rule recurrence rules.
 * Handles end-of-month clamping (e.g. 31st clamped to 28/29/30).
 *
 * @param {string} currentDateStr - 'YYYY-MM-DD'
 * @param {object} rule - { frequency, interval_count, by_month_day, by_weekday }
 * @returns {string} nextDateStr - 'YYYY-MM-DD'
 */
function computeNextDate(currentDateStr, rule) {
  const [y, m, d] = currentDateStr.split('-').map(Number);
  const interval = Math.max(1, parseInt(rule.interval_count, 10) || 1);
  const freq = (rule.frequency || 'monthly').toLowerCase();

  let targetYear = y;
  let targetMonth = m; // 1-12
  let targetDay = d;

  switch (freq) {
    case 'daily': {
      const dt = new Date(Date.UTC(y, m - 1, d));
      dt.setUTCDate(dt.getUTCDate() + interval);
      return dt.toISOString().split('T')[0];
    }

    case 'weekly': {
      const dt = new Date(Date.UTC(y, m - 1, d));
      dt.setUTCDate(dt.getUTCDate() + (7 * interval));
      return dt.toISOString().split('T')[0];
    }

    case 'biweekly': {
      const dt = new Date(Date.UTC(y, m - 1, d));
      dt.setUTCDate(dt.getUTCDate() + (14 * interval));
      return dt.toISOString().split('T')[0];
    }

    case 'monthly': {
      targetMonth += interval;
      while (targetMonth > 12) {
        targetMonth -= 12;
        targetYear += 1;
      }
      break;
    }

    case 'quarterly': {
      targetMonth += (3 * interval);
      while (targetMonth > 12) {
        targetMonth -= 12;
        targetYear += 1;
      }
      break;
    }

    case 'half_yearly': {
      targetMonth += (6 * interval);
      while (targetMonth > 12) {
        targetMonth -= 12;
        targetYear += 1;
      }
      break;
    }

    case 'yearly': {
      targetYear += interval;
      break;
    }

    case 'custom':
    default: {
      // Defaults to monthly stepping
      targetMonth += interval;
      while (targetMonth > 12) {
        targetMonth -= 12;
        targetYear += 1;
      }
      break;
    }
  }

  // Anchor day preference or original start day
  const anchorDay = rule.by_month_day !== undefined && rule.by_month_day !== null && rule.by_month_day > 0
    ? rule.by_month_day
    : d;

  // Clamp day to max days in target month
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  const clampedDay = Math.min(anchorDay, daysInTargetMonth);

  const mm = String(targetMonth).padStart(2, '0');
  const dd = String(clampedDay).padStart(2, '0');
  return `${targetYear}-${mm}-${dd}`;
}

/**
 * Preview the next N dates for a recurrence rule without saving to DB (§2.5)
 */
function previewNextDates(rule, count = 3, userTimezone = 'UTC') {
  const result = [];
  const maxCount = Math.min(24, Math.max(1, count));

  let startStr = toDateString(rule.start_date) || dayjs().tz(userTimezone).format('YYYY-MM-DD');
  let cur = startStr;

  let totalLimit = rule.end_mode === 'after_n' && rule.occurrences_total ? rule.occurrences_total : Infinity;
  let endDate = rule.end_mode === 'on_date' && rule.end_date ? toDateString(rule.end_date) : null;

  // The start date is occurrence #1 if it's in the future or today
  let occurrencesCount = 0;

  while (result.length < maxCount && occurrencesCount < totalLimit) {
    if (endDate && cur > endDate) {
      break;
    }

    result.push(cur);
    occurrencesCount++;

    if (occurrencesCount >= totalLimit) {
      break;
    }

    cur = computeNextDate(cur, rule);
  }

  return result;
}

/**
 * Generates and materializes occurrences for a single subscription up to horizon.
 * Horizon: max(90 days ahead, next 3 occurrences).
 *
 * @param {object} subscription - The subscription row
 * @param {number} horizonDays - default 90
 * @param {number} minOccurrences - default 3
 * @param {object} db - pool or active transaction connection
 */
async function materializeOccurrencesForSubscription(subscription, horizonDays = 90, minOccurrences = 3, db = pool) {
  if (subscription.status !== 'active') {
    return { created: 0, generatedThrough: subscription.generated_through };
  }

  const userId = subscription.user_id;
  const subId = subscription.id;

  // 1. Fetch existing occurrences count & last due_date
  const [existingRows] = await db.query(
    'SELECT due_date, status FROM recurring_occurrences WHERE recurring_id = ? ORDER BY due_date ASC',
    [subId]
  );

  const existingTotalCount = existingRows.length;
  const lastExistingDate = existingRows.length > 0 ? toDateString(existingRows[existingRows.length - 1].due_date) : null;

  // Horizon cutoff date (90 days from today)
  const today = new Date();
  const horizonDate = new Date(today.getTime() + (horizonDays * 24 * 60 * 60 * 1000)).toISOString().split('T')[0];

  const endMode = subscription.end_mode || 'never';
  const endDate = endMode === 'on_date' && subscription.end_date ? toDateString(subscription.end_date) : null;
  const totalAllowed = endMode === 'after_n' && subscription.occurrences_total ? subscription.occurrences_total : Infinity;

  // Count existing future pending occurrences (due_date >= today and status in ('due', 'missed'))
  const todayStr = today.toISOString().split('T')[0];
  const existingFuturePendingCount = existingRows.filter(
    r => toDateString(r.due_date) >= todayStr && (r.status === 'due' || r.status === 'missed')
  ).length;

  let currentDate = '';
  if (lastExistingDate) {
    currentDate = computeNextDate(lastExistingDate, subscription);
  } else {
    // Start with start_date or next_billing_date
    currentDate = toDateString(subscription.next_billing_date) || toDateString(subscription.start_date) || todayStr;
  }

  const toInsert = [];
  let currentTotalCount = existingTotalCount;

  while (
    (currentDate <= horizonDate || (existingFuturePendingCount + toInsert.length) < minOccurrences) &&
    currentTotalCount < totalAllowed
  ) {
    if (endDate && currentDate > endDate) {
      break;
    }

    toInsert.push(currentDate);
    currentTotalCount++;

    if (currentTotalCount >= totalAllowed) {
      break;
    }

    currentDate = computeNextDate(currentDate, subscription);
  }

  if (toInsert.length > 0) {
    const values = toInsert.map(due => [
      userId,
      subId,
      due,
      subscription.amount,
      'due'
    ]);

    await db.query(
      `INSERT IGNORE INTO recurring_occurrences (user_id, recurring_id, due_date, amount, status)
       VALUES ?`,
      [values]
    );
  }

  // Update generated_through and next_billing_date derived compatibility column
  const [allOccs] = await db.query(
    'SELECT due_date, status FROM recurring_occurrences WHERE recurring_id = ? ORDER BY due_date ASC',
    [subId]
  );

  const latestDate = allOccs.length > 0 ? toDateString(allOccs[allOccs.length - 1].due_date) : null;
  const earliestPending = allOccs.find(o => o.status === 'due' || o.status === 'missed');
  const nextBilling = earliestPending ? toDateString(earliestPending.due_date) : null;

  await db.query(
    'UPDATE subscriptions SET generated_through = ?, next_billing_date = ? WHERE id = ?',
    [latestDate, nextBilling, subId]
  );

  return {
    created: toInsert.length,
    generatedThrough: latestDate,
    nextBillingDate: nextBilling
  };
}

/**
 * Hourly Cron Worker for Recurring Transactions Engine (§2.2, §2.3)
 * 1. Materializes occurrences up to 90 days for all active subscriptions.
 * 2. Auto-posts transactions for auto_post=1 subscriptions whose occurrence is due.
 * 3. Marks past-due occurrences (due_date < today) as missed for catch-up.
 */
async function processRecurringJob() {
  console.log('[Recurring Engine] Running recurring engine worker cycle...');
  const connection = await pool.getConnection();

  try {
    // Fetch all active subscriptions with user timezone
    const [subscriptions] = await connection.query(`
      SELECT s.*, u.timezone, u.name as user_name
      FROM subscriptions s
      JOIN users u ON s.user_id = u.id
      WHERE s.status = 'active'
    `);

    console.log(`[Recurring Engine] Processing ${subscriptions.length} active recurring rules...`);

    for (const sub of subscriptions) {
      const userTz = sub.timezone || 'UTC';
      const userToday = dayjs().tz(userTz).format('YYYY-MM-DD');

      // 1. Materialize occurrences up to horizon
      try {
        await materializeOccurrencesForSubscription(sub, 90, 3, connection);
      } catch (err) {
        console.error(`[Recurring Engine] Error materializing for subscription ${sub.id}:`, err);
      }

      // 2. Auto-Post: If auto_post is enabled, post transactions for occurrences where due_date <= userToday
      if (sub.auto_post) {
        const [dueOccs] = await connection.query(
          `SELECT * FROM recurring_occurrences 
           WHERE recurring_id = ? AND status = 'due' AND due_date <= ?
           ORDER BY due_date ASC`,
          [sub.id, userToday]
        );

        for (const occ of dueOccs) {
          try {
            await connection.beginTransaction();

            // Insert transaction
            const [txResult] = await connection.query(
              `INSERT INTO transactions (user_id, subscription_id, title, subtitle, amount, type, date, category_id, description)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                sub.user_id,
                sub.id,
                sub.name,
                'Recurring auto-post',
                occ.amount,
                sub.type || 'expense',
                occ.due_date,
                sub.category_id,
                `Auto-posted occurrence for ${sub.name} on ${occ.due_date}`
              ]
            );

            // Update occurrence
            await connection.query(
              `UPDATE recurring_occurrences 
               SET status = 'paid', transaction_id = ?, paid_at = NOW() 
               WHERE id = ?`,
              [txResult.insertId, occ.id]
            );

            await connection.commit();
            console.log(`[Recurring Engine] Auto-posted tx ${txResult.insertId} for rule #${sub.id} on ${occ.due_date}`);
          } catch (txErr) {
            await connection.rollback();
            console.error(`[Recurring Engine] Failed to auto-post occurrence #${occ.id}:`, txErr);
          }
        }
      }

      // 3. Catch-Up: Mark any remaining occurrences with due_date < userToday as missed
      await connection.query(
        `UPDATE recurring_occurrences 
         SET status = 'missed' 
         WHERE recurring_id = ? AND status = 'due' AND due_date < ?`,
        [sub.id, userToday]
      );

      // 4. Keep next_billing_date in sync with earliest due/missed occurrence
      const [earliestRows] = await connection.query(
        `SELECT due_date FROM recurring_occurrences 
         WHERE recurring_id = ? AND status IN ('due', 'missed') 
         ORDER BY due_date ASC LIMIT 1`,
        [sub.id]
      );

      if (earliestRows.length > 0) {
        await connection.query(
          'UPDATE subscriptions SET next_billing_date = ? WHERE id = ?',
          [toDateString(earliestRows[0].due_date), sub.id]
        );
      }
    }

    console.log('[Recurring Engine] Worker cycle completed successfully.');
  } catch (error) {
    console.error('[Recurring Engine] Cycle error:', error);
  } finally {
    connection.release();
  }
}

module.exports = {
  computeNextDate,
  previewNextDates,
  materializeOccurrencesForSubscription,
  processRecurringJob,
  toDateString,
};
