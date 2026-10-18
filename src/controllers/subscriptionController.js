const { pool } = require('../config/db');
const { deleteFile, buildPublicUrl } = require('../services/storageService');
const {
  previewNextDates,
  materializeOccurrencesForSubscription,
  computeNextDate,
  toDateString
} = require('../services/recurringService');

// Helper to calculate next billing date for simple cycles
const calculateNextBillingDate = (startDate, cycle) => {
  let d = new Date(startDate);
  const today = new Date();
  today.setHours(0,0,0,0);

  // Initial bump
  if (cycle === 'yearly') {
    d.setFullYear(d.getFullYear() + 1);
  } else {
    d.setMonth(d.getMonth() + 1);
  }

  // Roll forward if still in the past
  while (d < today) {
    if (cycle === 'yearly') {
      d.setFullYear(d.getFullYear() + 1);
    } else {
      d.setMonth(d.getMonth() + 1);
    }
  }

  return d.toISOString().split('T')[0];
};

exports.getSubscriptionStats = async (req, res) => {
  try {
    const query = `
      SELECT 
        COALESCE(SUM(CASE WHEN computed_status = 'Ongoing' THEN 1 ELSE 0 END), 0) as ongoing_count,
        COALESCE(SUM(CASE WHEN computed_status = 'Upcoming' THEN 1 ELSE 0 END), 0) as upcoming_count,
        COALESCE(SUM(CASE WHEN computed_status = 'Inactive' THEN 1 ELSE 0 END), 0) as inactive_count,
        COUNT(*) as total_count,
        COALESCE(SUM(CASE WHEN billing_cycle = 'monthly' THEN 1 ELSE 0 END), 0) as total_monthly_count,
        COALESCE(SUM(CASE WHEN billing_cycle = 'yearly' THEN 1 ELSE 0 END), 0) as total_yearly_count,
        COALESCE(SUM(CASE WHEN days_left < 0 AND status != 'cancelled' THEN 1 ELSE 0 END), 0) as overdue_count,
        COALESCE(SUM(CASE WHEN days_left >= 0 AND days_left <= 7 AND status != 'cancelled' THEN 1 ELSE 0 END), 0) as within_7_days_count,
        COALESCE(SUM(CASE WHEN days_left >= 8 AND days_left <= 30 AND status != 'cancelled' THEN 1 ELSE 0 END), 0) as within_8_30_days_count,
        COALESCE(SUM(CASE WHEN days_left >= 30 AND days_left <= 45 AND billing_cycle = 'yearly' AND status != 'cancelled' THEN 1 ELSE 0 END), 0) as yearly_30_45_days_count,
        (SELECT COUNT(*) FROM recurring_occurrences ro WHERE ro.user_id = ? AND ro.status = 'missed') as total_missed_count
      FROM (
        SELECT 
          status,
          billing_cycle,
          DATEDIFF(next_billing_date, CURDATE()) as days_left,
          CASE 
            WHEN status = 'cancelled' OR status = 'paused' THEN 'Inactive'
            WHEN DATEDIFF(next_billing_date, CURDATE()) <= 7 THEN 'Upcoming'
            ELSE 'Ongoing'
          END as computed_status
        FROM subscriptions
        WHERE user_id = ?
      ) as sub
    `;
    const [rows] = await pool.query(query, [req.user.id, req.user.id]);
    res.status(200).json(rows[0]);
  } catch (error) {
    console.error('Error fetching subscription stats:', error);
    res.status(500).json({ error: 'Failed to fetch subscription stats' });
  }
};

exports.getSubscriptions = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 8;
    const page = parseInt(req.query.page) || 1;
    const offset = (page - 1) * limit;
    const status = req.query.status;
    const category_id = req.query.category_id;
    const search = req.query.search;

    let selectQuery = `
      SELECT s.*, 
             c.name as category_name, 
             c.icon_name as category_icon, 
             c.color as category_color,
             DATEDIFF(s.next_billing_date, CURDATE()) as days_left,
             (SELECT COUNT(*) FROM recurring_occurrences ro WHERE ro.recurring_id = s.id AND ro.status = 'missed') as missed_count,
             (SELECT MAX(t.date) FROM transactions t WHERE t.subscription_id = s.id) as last_paid_date,
             CASE 
                WHEN s.status = 'cancelled' OR s.status = 'paused' THEN 'Inactive'
                WHEN DATEDIFF(s.next_billing_date, CURDATE()) <= 7 THEN 'Upcoming'
                ELSE 'Ongoing'
             END as computed_status
      FROM subscriptions s
      LEFT JOIN categories c ON s.category_id = c.id
      WHERE s.user_id = ?
    `;
    let params = [req.user.id];

    if (category_id && category_id !== 'all') {
      selectQuery += ` AND s.category_id = ?`;
      params.push(category_id);
    }

    if (search && search.trim()) {
      selectQuery += ` AND s.name LIKE ?`;
      params.push(`%${search.trim()}%`);
    }

    if (status && status !== 'All') {
      selectQuery += ` HAVING computed_status = ?`;
      params.push(status);
    }

    // Wrap for count
    let countQuery = `SELECT COUNT(*) as total FROM (${selectQuery}) as derived_table`;
    let countParams = [...params];

    selectQuery += ' ORDER BY next_billing_date ASC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const [rows] = await pool.query(selectQuery, params);
    const [countRows] = await pool.query(countQuery, countParams);
    const totalItems = countRows[0].total;
    const totalPages = Math.max(1, Math.ceil(totalItems / limit));
    
    res.status(200).json({
      data: rows,
      pagination: {
        currentPage: page,
        totalPages,
        totalItems,
        itemsPerPage: limit
      }
    });
  } catch (error) {
    console.error('Error fetching subscriptions:', error);
    res.status(500).json({ error: 'Failed to fetch subscriptions' });
  }
};

exports.addSubscription = async (req, res) => {
  const {
    name, amount, type, billing_cycle,
    frequency, interval_count, by_month_day, by_weekday,
    end_mode, end_date, occurrences_total, auto_post,
    start_date, status, source, category_id,
    is_reminder_on, reminder_days, is_sms_enabled, is_email_enabled, is_push_enabled
  } = req.body;

  if (!name || !amount || !start_date) {
    return res.status(400).json({ error: 'Name, amount, and start_date are required' });
  }

  const trimmedName = name.trim();
  const subFrequency = frequency || billing_cycle || 'monthly';
  const subCycle = subFrequency === 'yearly' ? 'yearly' : 'monthly';
  const subIntervalCount = parseInt(interval_count, 10) || 1;
  const subByMonthDay = by_month_day !== undefined && by_month_day !== null
    ? parseInt(by_month_day, 10)
    : new Date(start_date).getDate();
  const subEndMode = end_mode || 'never';
  const subAutoPost = auto_post ? 1 : 0;
  const subStatus = status || 'active';
  const subSource = source || 'Manual Added';

  // Compute next billing date initially
  const next_billing_date = computeNextDate(start_date, {
    frequency: subFrequency,
    interval_count: subIntervalCount,
    by_month_day: subByMonthDay,
    by_weekday
  });

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Check for duplicate name
    const [existing] = await connection.query(
      'SELECT id FROM subscriptions WHERE user_id = ? AND LOWER(name) = ?',
      [req.user.id, trimmedName.toLowerCase()]
    );

    if (existing.length > 0) {
      await connection.rollback();
      return res.status(409).json({ error: 'A subscription with this name already exists' });
    }

    const [result] = await connection.query(
      `INSERT INTO subscriptions 
      (user_id, name, amount, type, billing_cycle, frequency, interval_count, by_month_day, by_weekday,
       end_mode, end_date, occurrences_total, auto_post, start_date, next_billing_date, status, source, category_id,
       is_reminder_on, reminder_days, is_sms_enabled, is_email_enabled, is_push_enabled) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.id, trimmedName, amount, type || 'expense', subCycle, subFrequency, subIntervalCount,
        subByMonthDay, by_weekday || null, subEndMode, end_date || null, occurrences_total || null,
        subAutoPost, start_date, next_billing_date, subStatus, subSource, category_id || null,
        is_reminder_on ? 1 : 0, reminder_days || 3, is_sms_enabled ? 1 : 0, is_email_enabled ? 1 : 0, is_push_enabled ? 1 : 0
      ]
    );

    const subscriptionId = result.insertId;

    // Materialize occurrences forward immediately
    const createdSub = {
      id: subscriptionId,
      user_id: req.user.id,
      name: trimmedName,
      amount,
      frequency: subFrequency,
      interval_count: subIntervalCount,
      by_month_day: subByMonthDay,
      by_weekday,
      end_mode: subEndMode,
      end_date,
      occurrences_total,
      auto_post: subAutoPost,
      start_date,
      next_billing_date,
      status: subStatus
    };

    await materializeOccurrencesForSubscription(createdSub, 90, 3, connection);

    await connection.commit();

    const [newSubscription] = await pool.query('SELECT * FROM subscriptions WHERE id = ? AND user_id = ?', [subscriptionId, req.user.id]);
    res.status(201).json(newSubscription[0]);
  } catch (error) {
    await connection.rollback();
    console.error('Error adding subscription:', error);
    res.status(500).json({ error: 'Failed to add subscription' });
  } finally {
    connection.release();
  }
};

exports.updateSubscription = async (req, res) => {
  const { id } = req.params;
  const { 
    name, amount, type, billing_cycle,
    frequency, interval_count, by_month_day, by_weekday,
    end_mode, end_date, occurrences_total, auto_post,
    start_date, status, source, category_id,
    is_reminder_on, reminder_days, is_sms_enabled, is_email_enabled, is_push_enabled
  } = req.body;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [existing] = await connection.query('SELECT * FROM subscriptions WHERE id = ? AND user_id = ?', [id, req.user.id]);
    
    if (existing.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Subscription not found or unauthorized' });
    }

    const currentSub = existing[0];
    const newStartDate = start_date || currentSub.start_date;
    const newFrequency = frequency || currentSub.frequency || billing_cycle || currentSub.billing_cycle || 'monthly';
    const newCycle = newFrequency === 'yearly' ? 'yearly' : 'monthly';
    const newIntervalCount = interval_count !== undefined ? parseInt(interval_count, 10) : currentSub.interval_count;
    const newByMonthDay = by_month_day !== undefined ? by_month_day : currentSub.by_month_day;
    const newStatus = status || currentSub.status;

    // Check if schedule parameters changed
    const scheduleChanged = (
      (frequency !== undefined && frequency !== currentSub.frequency) ||
      (interval_count !== undefined && interval_count !== currentSub.interval_count) ||
      (by_month_day !== undefined && by_month_day !== currentSub.by_month_day) ||
      (by_weekday !== undefined && by_weekday !== currentSub.by_weekday) ||
      (start_date !== undefined && start_date !== toDateString(currentSub.start_date))
    );

    // Validate reminder_days
    if (reminder_days !== undefined) {
      const maxReminderDays = newCycle === 'yearly' ? 30 : 15;
      if (reminder_days > maxReminderDays) {
        await connection.rollback();
        return res.status(400).json({ error: `Reminder days cannot exceed ${maxReminderDays} days for a ${newCycle} subscription.` });
      }
    }

    let updateQuery = `UPDATE subscriptions SET 
        name = COALESCE(?, name), 
        amount = COALESCE(?, amount),
        type = COALESCE(?, type), 
        billing_cycle = COALESCE(?, billing_cycle), 
        frequency = COALESCE(?, frequency),
        interval_count = COALESCE(?, interval_count),
        by_month_day = COALESCE(?, by_month_day),
        by_weekday = COALESCE(?, by_weekday),
        end_mode = COALESCE(?, end_mode),
        end_date = COALESCE(?, end_date),
        occurrences_total = COALESCE(?, occurrences_total),
        auto_post = COALESCE(?, auto_post),
        start_date = COALESCE(?, start_date),
        status = COALESCE(?, status),
        source = COALESCE(?, source),
        is_reminder_on = COALESCE(?, is_reminder_on),
        reminder_days = COALESCE(?, reminder_days),
        is_sms_enabled = COALESCE(?, is_sms_enabled),
        is_email_enabled = COALESCE(?, is_email_enabled),
        is_push_enabled = COALESCE(?, is_push_enabled)`;

    let updateParams = [
      name, amount, type, newCycle, newFrequency, newIntervalCount,
      newByMonthDay, by_weekday !== undefined ? by_weekday : currentSub.by_weekday,
      end_mode, end_date, occurrences_total, auto_post !== undefined ? (auto_post ? 1 : 0) : null,
      start_date, status, source,
      is_reminder_on !== undefined ? (is_reminder_on ? 1 : 0) : null,
      reminder_days,
      is_sms_enabled !== undefined ? (is_sms_enabled ? 1 : 0) : null,
      is_email_enabled !== undefined ? (is_email_enabled ? 1 : 0) : null,
      is_push_enabled !== undefined ? (is_push_enabled ? 1 : 0) : null
    ];

    if (category_id !== undefined) {
      updateQuery += `, category_id = ?`;
      updateParams.push(category_id);
    }

    updateQuery += ` WHERE id = ? AND user_id = ?`;
    updateParams.push(id, req.user.id);

    await connection.query(updateQuery, updateParams);

    // Edit Semantics (§2.4):
    // 1. Amount changed -> update future due occurrences
    if (amount !== undefined && parseFloat(amount) !== parseFloat(currentSub.amount)) {
      await connection.query(
        `UPDATE recurring_occurrences 
         SET amount = ? 
         WHERE recurring_id = ? AND user_id = ? AND status = 'due' AND due_date >= CURDATE()`,
        [amount, id, req.user.id]
      );
    }

    // 2. Schedule changed -> delete future due occurrences and regenerate
    if (scheduleChanged) {
      await connection.query(
        `DELETE FROM recurring_occurrences 
         WHERE recurring_id = ? AND user_id = ? AND status = 'due' AND due_date >= CURDATE()`,
        [id, req.user.id]
      );
    }

    // 3. Status handling: Paused vs Cancelled vs Resumed
    if (newStatus === 'paused' || newStatus === 'cancelled') {
      await connection.query(
        `UPDATE recurring_occurrences 
         SET status = 'cancelled' 
         WHERE recurring_id = ? AND user_id = ? AND status = 'due' AND due_date >= CURDATE()`,
        [id, req.user.id]
      );
    }

    // Regenerate occurrences if active
    if (newStatus === 'active') {
      const [refetched] = await connection.query('SELECT * FROM subscriptions WHERE id = ? AND user_id = ?', [id, req.user.id]);
      await materializeOccurrencesForSubscription(refetched[0], 90, 3, connection);
    }

    await connection.commit();

    const [updated] = await pool.query('SELECT * FROM subscriptions WHERE id = ? AND user_id = ?', [id, req.user.id]);
    res.status(200).json(updated[0]);
  } catch (error) {
    await connection.rollback();
    console.error('Error updating subscription:', error);
    res.status(500).json({ error: 'Failed to update subscription' });
  } finally {
    connection.release();
  }
};

exports.deleteSubscription = async (req, res) => {
  const { id } = req.params;

  try {
    const [result] = await pool.query('DELETE FROM subscriptions WHERE id = ? AND user_id = ?', [id, req.user.id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Subscription not found or unauthorized' });
    }

    res.status(200).json({ message: 'Subscription deleted successfully' });
  } catch (error) {
    console.error('Error deleting subscription:', error);
    res.status(500).json({ error: 'Failed to delete subscription' });
  }
};

exports.getSubscriptionDetails = async (req, res) => {
  const { id } = req.params;

  try {
    const [subscriptions] = await pool.query(`
      SELECT s.*, 
             c.name as category_name, 
             c.icon_name as category_icon, 
             c.color as category_color,
             (SELECT COUNT(*) FROM recurring_occurrences ro WHERE ro.recurring_id = s.id AND ro.status = 'missed') as missed_count,
             (SELECT MAX(t.date) FROM transactions t WHERE t.subscription_id = s.id) as last_paid_date
      FROM subscriptions s
      LEFT JOIN categories c ON s.category_id = c.id
      WHERE s.id = ? AND s.user_id = ?
    `, [id, req.user.id]);
    
    if (subscriptions.length === 0) {
      return res.status(404).json({ error: 'Subscription not found or unauthorized' });
    }

    const [transactions] = await pool.query('SELECT * FROM transactions WHERE subscription_id = ? AND user_id = ? ORDER BY date DESC', [id, req.user.id]);

    const transactionsWithUrls = transactions.map(tx => ({
      ...tx,
      receipt_url: buildPublicUrl(req, tx.receipt_url)
    }));

    res.status(200).json({
      subscription: subscriptions[0],
      transactions: transactionsWithUrls
    });
  } catch (error) {
    console.error('Error fetching subscription details:', error);
    res.status(500).json({ error: 'Failed to fetch subscription details' });
  }
};

/**
 * Live Recurrence Preview API (§2.5)
 * GET /api/subscriptions/preview?start_date=&frequency=&interval_count=&by_month_day=&count=
 */
exports.previewRecurrence = async (req, res) => {
  try {
    const dates = previewNextDates(req.query, parseInt(req.query.count, 10) || 3, req.user?.timezone || 'UTC');
    res.status(200).json({ dates });
  } catch (error) {
    console.error('Error previewing recurrence:', error);
    res.status(500).json({ error: 'Failed to preview recurrence dates' });
  }
};

/**
 * Occurrences Timeline API (§2.5)
 * GET /api/subscriptions/:id/occurrences?status=all|due|paid|skipped|missed&from=&to=&page=&limit=
 */
exports.getOccurrences = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const status = req.query.status;
  const from = req.query.from;
  const to = req.query.to;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const offset = (page - 1) * limit;

  try {
    const [subs] = await pool.query('SELECT id FROM subscriptions WHERE id = ? AND user_id = ?', [id, userId]);
    if (subs.length === 0) {
      return res.status(404).json({ error: 'Subscription not found or unauthorized' });
    }

    let where = 'ro.recurring_id = ? AND ro.user_id = ?';
    const params = [id, userId];

    if (status && status !== 'all') {
      where += ' AND ro.status = ?';
      params.push(status);
    }
    if (from) {
      where += ' AND ro.due_date >= ?';
      params.push(from);
    }
    if (to) {
      where += ' AND ro.due_date <= ?';
      params.push(to);
    }

    const [countRows] = await pool.query(`SELECT COUNT(*) as total FROM recurring_occurrences ro WHERE ${where}`, params);
    const total = countRows[0]?.total || 0;

    const sortDirection = req.query.sort?.toLowerCase() === 'desc' ? 'DESC' : 'ASC';

    const [rows] = await pool.query(`
      SELECT ro.*, 
             t.title as transaction_title,
             t.description as transaction_description,
             t.date as transaction_date,
             t.receipt_url as transaction_receipt_url
      FROM recurring_occurrences ro
      LEFT JOIN transactions t ON ro.transaction_id = t.id
      WHERE ${where}
      ORDER BY ro.due_date ${sortDirection}, ro.id ${sortDirection}
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    res.status(200).json({
      data: rows.map(r => ({
        ...r,
        transaction_receipt_url: buildPublicUrl(req, r.transaction_receipt_url)
      })),
      pagination: {
        currentPage: page,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        totalItems: total,
        itemsPerPage: limit
      }
    });
  } catch (error) {
    console.error('Error fetching occurrences:', error);
    res.status(500).json({ error: 'Failed to fetch occurrences' });
  }
};

/**
 * Pay Occurrence API (§2.5)
 * POST /api/subscriptions/:id/occurrences/:occId/pay
 */
exports.payOccurrence = async (req, res) => {
  const { id, occId } = req.params;
  const userId = req.user.id;
  const { amount, date, category_id, notes } = req.body || {};

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [subs] = await connection.query('SELECT * FROM subscriptions WHERE id = ? AND user_id = ?', [id, userId]);
    if (subs.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Subscription not found or unauthorized' });
    }
    const sub = subs[0];

    const [occs] = await connection.query(
      'SELECT * FROM recurring_occurrences WHERE id = ? AND recurring_id = ? AND user_id = ?',
      [occId, id, userId]
    );
    if (occs.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Occurrence not found or unauthorized' });
    }

    const occ = occs[0];
    if (occ.status === 'paid') {
      await connection.rollback();
      return res.status(400).json({ error: 'This occurrence has already been paid' });
    }

    const payAmount = amount !== undefined && !isNaN(parseFloat(amount)) ? parseFloat(amount) : parseFloat(occ.amount);
    const payDate = date || toDateString(new Date());
    const payCatId = (category_id !== undefined && category_id !== null) ? category_id : sub.category_id;

    // Build intelligent description showing previous skip history and late days
    const wasSkipped = occ.status === 'skipped' || Boolean(occ.skipped_at);

    const formatDatePretty = (dVal) => {
      if (!dVal) return '';
      try {
        const dStr = toDateString(dVal);
        const [y, m, d] = dStr.split('-').map(Number);
        return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      } catch {
        return String(dVal);
      }
    };

    const formattedDueDate = formatDatePretty(occ.due_date);
    const formattedPayDate = formatDatePretty(payDate);

    // Calculate difference between payDate and due_date in days
    const dueTime = new Date(toDateString(occ.due_date)).getTime();
    const payTime = new Date(toDateString(payDate)).getTime();
    const diffDays = Math.round((payTime - dueTime) / (1000 * 60 * 60 * 24));

    let defaultDescription = '';
    if (wasSkipped) {
      const skippedDate = occ.skipped_at || occ.updated_at || new Date();
      const formattedSkippedDate = formatDatePretty(skippedDate);

      let lateText = '';
      if (diffDays > 0) {
        lateText = ` (${diffDays} day${diffDays > 1 ? 's' : ''} late)`;
      } else if (diffDays === 0) {
        lateText = ` (on scheduled due date)`;
      } else {
        const earlyDays = Math.abs(diffDays);
        lateText = ` (${earlyDays} day${earlyDays > 1 ? 's' : ''} early)`;
      }

      defaultDescription = `Originally skipped on ${formattedSkippedDate} • Paid on ${formattedPayDate}${lateText} for scheduled due date ${formattedDueDate}`;
    } else {
      let lateText = '';
      if (diffDays > 0) {
        lateText = ` (${diffDays} day${diffDays > 1 ? 's' : ''} late)`;
      }
      defaultDescription = `Payment for recurring occurrence on ${formattedDueDate}${lateText}`;
    }

    const txDescription = notes || defaultDescription;

    // Create linked transaction
    const [txResult] = await connection.query(`
      INSERT INTO transactions (user_id, subscription_id, title, subtitle, amount, type, date, category_id, description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      userId,
      sub.id,
      sub.name,
      'Recurring payment',
      payAmount,
      sub.type || 'expense',
      payDate,
      payCatId,
      txDescription
    ]);

    const txId = txResult.insertId;

    // Update occurrence
    await connection.query(`
      UPDATE recurring_occurrences
      SET status = 'paid', amount = ?, transaction_id = ?, paid_at = NOW()
      WHERE id = ? AND user_id = ?
    `, [payAmount, txId, occ.id, userId]);

    // Resync next_billing_date
    const [earliestRows] = await connection.query(`
      SELECT due_date FROM recurring_occurrences
      WHERE recurring_id = ? AND status IN ('due', 'missed')
      ORDER BY due_date ASC LIMIT 1
    `, [sub.id]);

    if (earliestRows.length > 0) {
      await connection.query('UPDATE subscriptions SET next_billing_date = ? WHERE id = ? AND user_id = ?', [
        toDateString(earliestRows[0].due_date),
        sub.id,
        userId
      ]);
    } else {
      await materializeOccurrencesForSubscription(sub, 90, 3, connection);
      const [newEarliest] = await connection.query(`
        SELECT due_date FROM recurring_occurrences
        WHERE recurring_id = ? AND status IN ('due', 'missed')
        ORDER BY due_date ASC LIMIT 1
      `, [sub.id]);
      if (newEarliest.length > 0) {
        await connection.query('UPDATE subscriptions SET next_billing_date = ? WHERE id = ? AND user_id = ?', [
          toDateString(newEarliest[0].due_date),
          sub.id,
          userId
        ]);
      }
    }

    await connection.commit();

    const [updatedOcc] = await pool.query('SELECT * FROM recurring_occurrences WHERE id = ?', [occ.id]);
    const [createdTx] = await pool.query('SELECT * FROM transactions WHERE id = ?', [txId]);

    res.status(200).json({
      success: true,
      message: 'Occurrence marked as paid',
      occurrence: updatedOcc[0],
      transaction: createdTx[0]
    });
  } catch (error) {
    await connection.rollback();
    console.error('Error paying occurrence:', error);
    res.status(500).json({ error: 'Failed to record occurrence payment' });
  } finally {
    connection.release();
  }
};

/**
 * Skip Occurrence API (§2.5)
 * POST /api/subscriptions/:id/occurrences/:occId/skip
 */
exports.skipOccurrence = async (req, res) => {
  const { id, occId } = req.params;
  const userId = req.user.id;

  try {
    const [result] = await pool.query(`
      UPDATE recurring_occurrences
      SET status = 'skipped', skipped_at = NOW()
      WHERE id = ? AND recurring_id = ? AND user_id = ? AND status IN ('due', 'missed')
    `, [occId, id, userId]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Occurrence not found, unauthorized, or already paid/skipped' });
    }

    // Update next_billing_date
    const [earliestRows] = await pool.query(`
      SELECT due_date FROM recurring_occurrences
      WHERE recurring_id = ? AND status IN ('due', 'missed')
      ORDER BY due_date ASC LIMIT 1
    `, [id]);

    if (earliestRows.length > 0) {
      await pool.query('UPDATE subscriptions SET next_billing_date = ? WHERE id = ? AND user_id = ?', [
        toDateString(earliestRows[0].due_date),
        id,
        userId
      ]);
    } else {
      const [subRows] = await pool.query('SELECT * FROM subscriptions WHERE id = ? AND user_id = ?', [id, userId]);
      if (subRows.length > 0) {
        await materializeOccurrencesForSubscription(subRows[0], 90, 3, pool);
        const [newEarliest] = await pool.query(`
          SELECT due_date FROM recurring_occurrences
          WHERE recurring_id = ? AND status IN ('due', 'missed')
          ORDER BY due_date ASC LIMIT 1
        `, [id]);
        if (newEarliest.length > 0) {
          await pool.query('UPDATE subscriptions SET next_billing_date = ? WHERE id = ? AND user_id = ?', [
            toDateString(newEarliest[0].due_date),
            id,
            userId
          ]);
        }
      }
    }

    // Dismiss unread in-app reminder notifications for this subscription
    await pool.query(`
      DELETE FROM in_app_notifications 
      WHERE user_id = ? AND link_url = ? AND is_read = FALSE
    `, [userId, `/subscriptions/${id}`]);

    // Cancel pending outbound notification alerts (Push, Email, SMS) for this subscription
    await pool.query(`
      UPDATE notification_queue 
      SET status = 'failed' 
      WHERE subscription_id = ? AND user_id = ? AND status = 'pending'
    `, [id, userId]);

    res.status(200).json({ success: true, message: 'Occurrence skipped' });
  } catch (error) {
    console.error('Error skipping occurrence:', error);
    res.status(500).json({ error: 'Failed to skip occurrence' });
  }
};

/**
 * Unskip Occurrence API
 * POST /api/subscriptions/:id/occurrences/:occId/unskip
 */
exports.unskipOccurrence = async (req, res) => {
  const { id, occId } = req.params;
  const userId = req.user.id;

  try {
    const [result] = await pool.query(`
      UPDATE recurring_occurrences
      SET status = 'due', skipped_at = NULL
      WHERE id = ? AND recurring_id = ? AND user_id = ? AND status = 'skipped'
    `, [occId, id, userId]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Occurrence not found, unauthorized, or not currently skipped' });
    }

    // Resync next_billing_date to earliest due/missed
    const [earliestRows] = await pool.query(`
      SELECT due_date FROM recurring_occurrences
      WHERE recurring_id = ? AND status IN ('due', 'missed')
      ORDER BY due_date ASC LIMIT 1
    `, [id]);

    if (earliestRows.length > 0) {
      await pool.query('UPDATE subscriptions SET next_billing_date = ? WHERE id = ? AND user_id = ?', [
        toDateString(earliestRows[0].due_date),
        id,
        userId
      ]);
    }

    res.status(200).json({ success: true, message: 'Occurrence unskipped successfully' });
  } catch (error) {
    console.error('Error unskipping occurrence:', error);
    res.status(500).json({ error: 'Failed to unskip occurrence' });
  }
};

/**
 * Catch-Up Panel API (§2.3, §2.5)
 * GET /api/subscriptions/catch-up
 */
exports.getCatchUpOccurrences = async (req, res) => {
  const userId = req.user.id;
  try {
    const [rows] = await pool.query(`
      SELECT 
        ro.id,
        ro.recurring_id,
        ro.due_date,
        ro.amount,
        ro.status,
        s.name as subscription_name,
        s.frequency,
        s.type,
        s.category_id,
        c.name as category_name,
        c.icon_name as category_icon,
        c.color as category_color
      FROM recurring_occurrences ro
      JOIN subscriptions s ON ro.recurring_id = s.id
      LEFT JOIN categories c ON s.category_id = c.id
      WHERE ro.user_id = ? AND ro.status = 'missed'
      ORDER BY ro.due_date ASC
    `, [userId]);

    res.status(200).json({
      data: rows,
      totalMissed: rows.length
    });
  } catch (error) {
    console.error('Error fetching catch-up occurrences:', error);
    res.status(500).json({ error: 'Failed to fetch missed occurrences' });
  }
};

/**
 * Bulk Catch-Up API (§2.5)
 * POST /api/subscriptions/catch-up/bulk
 * Body: { action: 'pay' | 'skip', occurrence_ids: number[] }
 */
exports.bulkProcessCatchUp = async (req, res) => {
  const userId = req.user.id;
  const { action, occurrence_ids } = req.body;

  if (!action || !['pay', 'skip'].includes(action)) {
    return res.status(400).json({ error: 'Valid action (pay or skip) is required' });
  }

  if (!Array.isArray(occurrence_ids) || occurrence_ids.length === 0) {
    return res.status(400).json({ error: 'Array of occurrence IDs is required' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const placeholders = occurrence_ids.map(() => '?').join(',');
    const [occurrences] = await connection.query(`
      SELECT ro.*, s.name as subscription_name, s.type, s.category_id
      FROM recurring_occurrences ro
      JOIN subscriptions s ON ro.recurring_id = s.id
      WHERE ro.id IN (${placeholders}) AND ro.user_id = ? AND ro.status = 'missed'
    `, [...occurrence_ids, userId]);

    if (occurrences.length === 0) {
      await connection.rollback();
      return res.status(400).json({ error: 'No eligible missed occurrences found to process' });
    }

    const affectedSubIds = new Set();

    if (action === 'pay') {
      for (const occ of occurrences) {
        const [txResult] = await connection.query(`
          INSERT INTO transactions (user_id, subscription_id, title, subtitle, amount, type, date, category_id, description)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          userId,
          occ.recurring_id,
          occ.subscription_name,
          'Catch-up payment',
          occ.amount,
          occ.type || 'expense',
          occ.due_date,
          occ.category_id,
          `Catch-up payment for occurrence on ${occ.due_date}`
        ]);

        await connection.query(`
          UPDATE recurring_occurrences
          SET status = 'paid', transaction_id = ?, paid_at = NOW()
          WHERE id = ?
        `, [txResult.insertId, occ.id]);

        affectedSubIds.add(occ.recurring_id);
      }
    } else {
      // skip
      await connection.query(`
        UPDATE recurring_occurrences
        SET status = 'skipped'
        WHERE id IN (${placeholders}) AND user_id = ?
      `, [...occurrence_ids, userId]);

      occurrences.forEach(occ => affectedSubIds.add(occ.recurring_id));
    }

    // Resync next_billing_date on affected subscriptions
    for (const subId of affectedSubIds) {
      const [earliestRows] = await connection.query(`
        SELECT due_date FROM recurring_occurrences
        WHERE recurring_id = ? AND status IN ('due', 'missed')
        ORDER BY due_date ASC LIMIT 1
      `, [subId]);

      if (earliestRows.length > 0) {
        await connection.query(
          'UPDATE subscriptions SET next_billing_date = ? WHERE id = ? AND user_id = ?',
          [toDateString(earliestRows[0].due_date), subId, userId]
        );
      }
    }

    await connection.commit();

    res.status(200).json({
      success: true,
      action,
      processedCount: occurrences.length,
      message: action === 'pay' 
        ? `Successfully paid ${occurrences.length} missed occurrence(s)`
        : `Successfully skipped ${occurrences.length} missed occurrence(s)`
    });
  } catch (error) {
    await connection.rollback();
    console.error('Error in bulk catch-up:', error);
    res.status(500).json({ error: 'Failed to process bulk catch-up' });
  } finally {
    connection.release();
  }
};

/**
 * Section 1.1 / Section 2.5: Undo a recurring payment and restore occurrence to due
 */
exports.undoPayment = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Fetch subscription
    const [existing] = await connection.query(
      'SELECT * FROM subscriptions WHERE id = ? AND user_id = ?',
      [id, userId]
    );

    if (existing.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Subscription not found or unauthorized' });
    }

    const sub = existing[0];

    // 2. Find most recent paid occurrence (or most recent linked transaction)
    const [paidOccs] = await connection.query(`
      SELECT * FROM recurring_occurrences 
      WHERE recurring_id = ? AND user_id = ? AND status = 'paid'
      ORDER BY due_date DESC, id DESC LIMIT 1
    `, [id, userId]);

    let linkedTxId = null;
    let occToRevert = null;

    if (paidOccs.length > 0) {
      occToRevert = paidOccs[0];
      linkedTxId = occToRevert.transaction_id;
    }

    if (!linkedTxId) {
      const [txRows] = await connection.query(
        'SELECT id, receipt_url FROM transactions WHERE subscription_id = ? AND user_id = ? ORDER BY date DESC, id DESC LIMIT 1',
        [id, userId]
      );
      if (txRows.length === 0) {
        await connection.rollback();
        return res.status(400).json({ error: 'No recorded payments found to undo for this subscription' });
      }
      linkedTxId = txRows[0].id;
    }

    // Fetch transaction to get receipt_url before deletion
    const [txToDelete] = await connection.query(
      'SELECT id, receipt_url FROM transactions WHERE id = ? AND user_id = ?',
      [linkedTxId, userId]
    );

    // Delete the transaction
    await connection.query('DELETE FROM transactions WHERE id = ? AND user_id = ?', [linkedTxId, userId]);

    // Revert occurrence if found
    if (occToRevert) {
      await connection.query(`
        UPDATE recurring_occurrences 
        SET status = 'due', transaction_id = NULL, paid_at = NULL 
        WHERE id = ? AND user_id = ?
      `, [occToRevert.id, userId]);
    }

    // Recompute next_billing_date to earliest due/missed
    const [earliestRows] = await connection.query(`
      SELECT due_date FROM recurring_occurrences
      WHERE recurring_id = ? AND status IN ('due', 'missed')
      ORDER BY due_date ASC LIMIT 1
    `, [id]);

    let newNextBilling = earliestRows.length > 0 ? toDateString(earliestRows[0].due_date) : sub.next_billing_date;
    await connection.query('UPDATE subscriptions SET next_billing_date = ? WHERE id = ? AND user_id = ?', [newNextBilling, id, userId]);

    await connection.commit();

    if (txToDelete[0]?.receipt_url) {
      deleteFile(txToDelete[0].receipt_url);
    }

    const [updated] = await pool.query('SELECT * FROM subscriptions WHERE id = ? AND user_id = ?', [id, userId]);

    return res.status(200).json({
      success: true,
      message: 'Payment undone successfully and billing schedule restored',
      data: {
        subscription: updated[0],
        undoneTransactionId: linkedTxId,
        rolledBackNextBillingDate: newNextBilling
      }
    });
  } catch (error) {
    await connection.rollback();
    console.error('Error undoing subscription payment:', error);
    return res.status(500).json({ error: 'Failed to undo payment' });
  } finally {
    connection.release();
  }
};

/**
 * Backward compatibility: Pay next due occurrence
 */
exports.paySubscription = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    const [occs] = await pool.query(`
      SELECT id FROM recurring_occurrences
      WHERE recurring_id = ? AND user_id = ? AND status IN ('due', 'missed')
      ORDER BY due_date ASC LIMIT 1
    `, [id, userId]);

    if (occs.length > 0) {
      req.params.occId = occs[0].id;
      return exports.payOccurrence(req, res);
    }

    // Materialize if empty and retry
    const [subs] = await pool.query('SELECT * FROM subscriptions WHERE id = ? AND user_id = ?', [id, userId]);
    if (subs.length === 0) {
      return res.status(404).json({ error: 'Subscription not found or unauthorized' });
    }
    await materializeOccurrencesForSubscription(subs[0], 90, 3);
    const [retryOccs] = await pool.query(`
      SELECT id FROM recurring_occurrences
      WHERE recurring_id = ? AND user_id = ? AND status IN ('due', 'missed')
      ORDER BY due_date ASC LIMIT 1
    `, [id, userId]);

    if (retryOccs.length > 0) {
      req.params.occId = retryOccs[0].id;
      return exports.payOccurrence(req, res);
    }

    return res.status(400).json({ error: 'No pending occurrences available to pay' });
  } catch (error) {
    console.error('Error in paySubscription:', error);
    res.status(500).json({ error: 'Failed to process payment' });
  }
};
