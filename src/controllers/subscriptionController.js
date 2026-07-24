const { pool } = require('../config/db');

// Helper to calculate next billing date
const calculateNextBillingDate = (startDate, cycle) => {
  const d = new Date(startDate);
  if (cycle === 'yearly') {
    d.setFullYear(d.getFullYear() + 1);
  } else {
    d.setMonth(d.getMonth() + 1);
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
        COUNT(*) as total_count
      FROM (
        SELECT CASE 
                  WHEN status = 'cancelled' THEN 'Inactive'
                  WHEN DATEDIFF(next_billing_date, CURDATE()) <= 7 THEN 'Upcoming'
                  ELSE 'Ongoing'
               END as computed_status
        FROM subscriptions
        WHERE user_id = ?
      ) as sub
    `;
    const [rows] = await pool.query(query, [req.user.id]);
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

    let selectQuery = `
      SELECT s.*, 
             c.name as category_name, 
             c.icon_name as category_icon, 
             c.color as category_color,
             DATEDIFF(s.next_billing_date, CURDATE()) as days_left,
             CASE 
                WHEN s.status = 'cancelled' THEN 'Inactive'
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
  const { name, amount, billing_cycle, start_date, status, source, category_id } = req.body;

  if (!name || !amount || !start_date) {
    return res.status(400).json({ error: 'Name, amount, and start_date are required' });
  }

  const trimmedName = name.trim();

  const cycle = billing_cycle || 'monthly';
  const subStatus = status || 'active';
  const subSource = source || 'Manual Added';
  const next_billing_date = calculateNextBillingDate(start_date, cycle);

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
      (user_id, name, amount, billing_cycle, start_date, next_billing_date, status, source, category_id) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, trimmedName, amount, cycle, start_date, next_billing_date, subStatus, subSource, category_id || null]
    );

    const subscriptionId = result.insertId;

    await connection.commit();

    const [newSubscription] = await pool.query('SELECT * FROM subscriptions WHERE id = ?', [subscriptionId]);
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
    name, amount, billing_cycle, start_date, status, source, category_id,
    is_reminder_on, reminder_days, is_sms_enabled, is_email_enabled
  } = req.body;

  try {
    const [existing] = await pool.query('SELECT * FROM subscriptions WHERE id = ? AND user_id = ?', [id, req.user.id]);
    
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Subscription not found or unauthorized' });
    }

    const currentSub = existing[0];
    const newStartDate = start_date || currentSub.start_date;
    const newCycle = billing_cycle || currentSub.billing_cycle;
    const newNextBillingDate = calculateNextBillingDate(newStartDate, newCycle);

    // If category_id is explicitly passed as null, we should update it to null
    let updateQuery = `UPDATE subscriptions SET 
        name = COALESCE(?, name), 
        amount = COALESCE(?, amount), 
        billing_cycle = COALESCE(?, billing_cycle), 
        start_date = COALESCE(?, start_date),
        next_billing_date = ?, 
        status = COALESCE(?, status),
        source = COALESCE(?, source),
        is_reminder_on = COALESCE(?, is_reminder_on),
        reminder_days = COALESCE(?, reminder_days),
        is_sms_enabled = COALESCE(?, is_sms_enabled),
        is_email_enabled = COALESCE(?, is_email_enabled)`;
    let updateParams = [
        name, amount, billing_cycle, start_date, newNextBillingDate, status, source,
        is_reminder_on, reminder_days, is_sms_enabled, is_email_enabled
    ];

    if (category_id !== undefined) {
      updateQuery += `, category_id = ?`;
      updateParams.push(category_id);
    }

    updateQuery += ` WHERE id = ?`;
    updateParams.push(id);

    await pool.query(updateQuery, updateParams);

    const [updated] = await pool.query('SELECT * FROM subscriptions WHERE id = ?', [id]);
    res.status(200).json(updated[0]);
  } catch (error) {
    console.error('Error updating subscription:', error);
    res.status(500).json({ error: 'Failed to update subscription' });
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
             c.color as category_color 
      FROM subscriptions s
      LEFT JOIN categories c ON s.category_id = c.id
      WHERE s.id = ? AND s.user_id = ?
    `, [id, req.user.id]);
    
    if (subscriptions.length === 0) {
      return res.status(404).json({ error: 'Subscription not found or unauthorized' });
    }

    const [transactions] = await pool.query('SELECT * FROM transactions WHERE subscription_id = ? ORDER BY date DESC', [id]);

    res.status(200).json({
      subscription: subscriptions[0],
      transactions: transactions
    });
  } catch (error) {
    console.error('Error fetching subscription details:', error);
    res.status(500).json({ error: 'Failed to fetch subscription details' });
  }
};

exports.paySubscription = async (req, res) => {
  const { id } = req.params;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Fetch the subscription
    const [existing] = await connection.query(
      'SELECT * FROM subscriptions WHERE id = ? AND user_id = ?', 
      [id, req.user.id]
    );

    if (existing.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Subscription not found or unauthorized' });
    }

    const sub = existing[0];

    // 2. Insert into transactions
    await connection.query(
      `INSERT INTO transactions (user_id, title, amount, type, date, subscription_id, category_id)
       VALUES (?, ?, ?, 'expense', CURDATE(), ?, ?)`,
      [req.user.id, sub.name, sub.amount, id, sub.category_id]
    );

    // 3. Calculate and update next billing date
    const newNextBillingDate = calculateNextBillingDate(sub.next_billing_date, sub.billing_cycle);
    await connection.query(
      'UPDATE subscriptions SET next_billing_date = ? WHERE id = ?',
      [newNextBillingDate, id]
    );

    await connection.commit();

    // Return the updated subscription
    const [updated] = await pool.query('SELECT * FROM subscriptions WHERE id = ?', [id]);
    res.status(200).json(updated[0]);
  } catch (error) {
    await connection.rollback();
    console.error('Error processing payment:', error);
    res.status(500).json({ error: 'Failed to process payment' });
  } finally {
    connection.release();
  }
};
