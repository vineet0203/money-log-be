const { pool } = require('../config/db');

// Helper to calculate next billing date (copied from subscriptions.routes.js)
const calculateNextBillingDate = (startDate, cycle) => {
  const d = new Date(startDate);
  if (cycle === 'yearly') {
    d.setFullYear(d.getFullYear() + 1);
  } else {
    d.setMonth(d.getMonth() + 1);
  }
  return d.toISOString().split('T')[0];
};

exports.getStats = async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT 
        SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) as income,
        SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) as expense
       FROM transactions WHERE user_id = ?`,
      [req.user.id]
    );
    
    const income = rows[0].income || 0;
    const expense = rows[0].expense || 0;
    const balance = 0; // Keeping balance 0 as requested

    res.status(200).json({ income, expense, balance });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
};

exports.getTransactions = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;
    const type = req.query.type; // 'all', 'income', 'expense'

    let query = 'SELECT * FROM transactions WHERE user_id = ?';
    const params = [req.user.id];

    if (type && type !== 'all') {
      query += ' AND type = ?';
      params.push(type);
    }

    query += ' ORDER BY date DESC, id DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const [transactions] = await pool.query(query, params);
    
    const nextOffset = transactions.length === limit ? offset + limit : null;
    
    res.status(200).json({
      data: transactions,
      nextOffset
    });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
};

exports.createTransaction = async (req, res) => {
  const { title, amount, type, date, category_id, description, subscription_id } = req.body;
  const receipt_url = req.file ? `/uploads/${req.file.filename}` : null;

  if (!title || !amount || !type || !date) {
    return res.status(400).json({ error: 'Title, amount, type, and date are required' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Insert Transaction
    const [result] = await connection.query(
      `INSERT INTO transactions 
      (user_id, title, amount, type, date, category_id, description, receipt_url, subscription_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, title, amount, type, date, category_id || null, description || null, receipt_url, subscription_id || null]
    );

    const transactionId = result.insertId;

    // 2. If it's a subscription payment, bump the billing date
    if (subscription_id) {
      const [existingSubs] = await connection.query(
        'SELECT * FROM subscriptions WHERE id = ? AND user_id = ?',
        [subscription_id, req.user.id]
      );

      if (existingSubs.length > 0) {
        const sub = existingSubs[0];
        const newNextBillingDate = calculateNextBillingDate(sub.next_billing_date, sub.billing_cycle);
        await connection.query(
          'UPDATE subscriptions SET next_billing_date = ? WHERE id = ?',
          [newNextBillingDate, subscription_id]
        );
      }
    }

    await connection.commit();
    res.status(201).json({ id: transactionId, message: 'Transaction created successfully', receipt_url });
  } catch (error) {
    await connection.rollback();
    console.error('Error creating transaction:', error);
    res.status(500).json({ error: 'Failed to create transaction' });
  } finally {
    connection.release();
  }
};

exports.getTransactionById = async (req, res) => {
  try {
    const transactionId = req.params.id;
    const [rows] = await pool.query(
      `SELECT t.*, c.name as category_name, c.icon_name as category_icon, c.color as category_color 
       FROM transactions t 
       LEFT JOIN categories c ON t.category_id = c.id 
       WHERE t.id = ? AND t.user_id = ?`,
      [transactionId, req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    res.status(200).json(rows[0]);
  } catch (error) {
    console.error('Error fetching transaction details:', error);
    res.status(500).json({ error: 'Failed to fetch transaction details' });
  }
};
