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
    const { fromDate, toDate } = req.query;
    
    let query = `SELECT 
        SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) as income,
        SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) as expense,
        MAX(CASE WHEN type = 'expense' THEN amount ELSE 0 END) as highestExpense
       FROM transactions WHERE user_id = ?`;
    const params = [req.user.id];

    if (fromDate) {
      query += ' AND date >= ?';
      params.push(fromDate);
    }
    if (toDate) {
      query += ' AND date <= ?';
      params.push(toDate);
    }

    const [rows] = await pool.query(query, params);
    
    const income = rows[0].income || 0;
    const expense = rows[0].expense || 0;
    const highestExpense = rows[0].highestExpense || 0;
    const balance = income - expense;

    res.status(200).json({ income, expense, balance, highestExpense });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
};

exports.getTransactions = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;
    const type = req.query.type;
    const fromDate = req.query.fromDate;
    const toDate = req.query.toDate;

    let query = `SELECT t.*, c.name as category_name 
                 FROM transactions t
                 LEFT JOIN categories c ON t.category_id = c.id
                 WHERE t.user_id = ?`;
    let countQuery = `SELECT COUNT(*) as total FROM transactions t WHERE t.user_id = ?`;
    const params = [req.user.id];
    const countParams = [req.user.id];

    if (type && type !== 'all') {
      query += ' AND t.type = ?';
      countQuery += ' AND t.type = ?';
      params.push(type);
      countParams.push(type);
    }
    
    if (fromDate) {
      query += ' AND t.date >= ?';
      countQuery += ' AND t.date >= ?';
      params.push(fromDate);
      countParams.push(fromDate);
    }
    if (toDate) {
      query += ' AND t.date <= ?';
      countQuery += ' AND t.date <= ?';
      params.push(toDate);
      countParams.push(toDate);
    }

    query += ' ORDER BY t.date DESC, t.id DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const [transactions] = await pool.query(query, params);
    const [countRows] = await pool.query(countQuery, countParams);
    
    const nextOffset = transactions.length === limit ? offset + limit : null;
    
    const transactionsWithUrls = transactions.map(tx => ({
      ...tx,
      receipt_url: tx.receipt_url ? (tx.receipt_url.startsWith('http') ? tx.receipt_url : `${req.protocol}://${req.get('host')}${tx.receipt_url}`) : null
    }));
    
    res.status(200).json({
      data: transactionsWithUrls,
      total: countRows[0].total,
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

    // 1. If it's a subscription payment, validate date and calculate new billing date first
    let newNextBillingDate = null;
    let subToUpdate = null;

    if (subscription_id) {
      const [existingSubs] = await connection.query(
        'SELECT * FROM subscriptions WHERE id = ? AND user_id = ?',
        [subscription_id, req.user.id]
      );

      if (existingSubs.length === 0) {
        await connection.rollback();
        return res.status(404).json({ error: 'Subscription not found' });
      }

      subToUpdate = existingSubs[0];
      
      // Calculate days difference
      const today = new Date();
      const nextBillingDate = new Date(subToUpdate.next_billing_date);
      const diffTime = nextBillingDate.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      const maxDays = subToUpdate.billing_cycle === 'yearly' ? 30 : 15;
      
      if (diffDays > maxDays) {
        await connection.rollback();
        const actionText = subToUpdate.type === 'income' ? 'accept payment' : 'pay';
        return res.status(400).json({ error: `Too early! You can only ${actionText} up to ${maxDays} days before the due date.` });
      }
      
      

      newNextBillingDate = calculateNextBillingDate(subToUpdate.next_billing_date, subToUpdate.billing_cycle);
    }

    // 2. Insert Transaction
    const [result] = await connection.query(
      `INSERT INTO transactions 
      (user_id, title, amount, type, date, category_id, description, receipt_url, subscription_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, title, amount, type, date, category_id || null, description || null, receipt_url, subscription_id || null]
    );

    const transactionId = result.insertId;

    // 3. Bump the billing date if valid
    if (subToUpdate && newNextBillingDate) {
      await connection.query(
        'UPDATE subscriptions SET next_billing_date = ? WHERE id = ?',
        [newNextBillingDate, subscription_id]
      );
    }

    await connection.commit();
    const absolute_receipt_url = receipt_url ? `${req.protocol}://${req.get('host')}${receipt_url}` : null;
    res.status(201).json({ id: transactionId, message: 'Transaction created successfully', receipt_url: absolute_receipt_url });
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

    const transaction = rows[0];
    if (transaction.receipt_url && !transaction.receipt_url.startsWith('http')) {
      transaction.receipt_url = `${req.protocol}://${req.get('host')}${transaction.receipt_url}`;
    }

    res.status(200).json(transaction);
  } catch (error) {
    console.error('Error fetching transaction details:', error);
    res.status(500).json({ error: 'Failed to fetch transaction details' });
  }
};
