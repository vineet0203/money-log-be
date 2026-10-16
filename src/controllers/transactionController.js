const { pool } = require('../config/db');
const { deleteFile, getRelativeKey, buildPublicUrl } = require('../services/storageService');

/**
 * Calculate next billing date with month-clamping
 */
const calculateNextBillingDate = (dateStr, cycle) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  let targetYear = y;
  let targetMonth = m;
  let targetDay = d;

  if (cycle === 'yearly') {
    targetYear += 1;
  } else {
    targetMonth += 1;
    if (targetMonth > 12) {
      targetMonth = 1;
      targetYear += 1;
    }
  }

  const daysInMonth = new Date(targetYear, targetMonth, 0).getDate();
  const clampedDay = Math.min(targetDay, daysInMonth);

  const mm = String(targetMonth).padStart(2, '0');
  const dd = String(clampedDay).padStart(2, '0');
  return `${targetYear}-${mm}-${dd}`;
};

/**
 * Build absolute receipt URL and normalize numeric values
 */
const formatTransactionRow = (req, tx) => {
  if (!tx) return null;
  return {
    ...tx,
    amount: parseFloat(tx.amount || 0),
    receipt_url: buildPublicUrl(req, tx.receipt_url),
  };
};

/**
 * Compute aggregate stats for a specific date window & filters
 */
const computeTransactionStatsForWindow = async (userId, winFrom, winTo, filterType, filterCategoryId, filterSearch, filterReceipt) => {
  let query = `SELECT 
      SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END) as income,
      SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END) as expense,
      MAX(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END) as highestExpense,
      COUNT(*) as count,
      SUM(CASE WHEN t.type = 'income' THEN 1 ELSE 0 END) as incomeCount,
      SUM(CASE WHEN t.type = 'expense' THEN 1 ELSE 0 END) as expenseCount,
      AVG(CASE WHEN t.type = 'income' THEN t.amount ELSE NULL END) as incomeAverage,
      AVG(CASE WHEN t.type = 'expense' THEN t.amount ELSE NULL END) as expenseAverage,
      AVG(t.amount) as overallAverage
     FROM transactions t
     WHERE t.user_id = ?`;
  const params = [userId];

  if (winFrom) {
    query += ' AND t.date >= ?';
    params.push(winFrom);
  }
  if (winTo) {
    query += ' AND t.date <= ?';
    params.push(winTo);
  }
  if (filterType && filterType !== 'all') {
    query += ' AND t.type = ?';
    params.push(filterType);
  }
  if (filterCategoryId) {
    query += ' AND t.category_id = ?';
    params.push(filterCategoryId);
  }
  if (filterSearch) {
    query += ' AND (t.title LIKE ? OR t.description LIKE ?)';
    params.push(`%${filterSearch}%`, `%${filterSearch}%`);
  }
  if (filterReceipt === 'true' || filterReceipt === true) {
    query += ' AND t.receipt_url IS NOT NULL AND t.receipt_url != ""';
  }

  const [rows] = await pool.query(query, params);
  const row = rows[0] || {};

  const income = parseFloat(row.income || 0);
  const expense = parseFloat(row.expense || 0);
  const highestExpense = parseFloat(row.highestExpense || 0);
  const count = parseInt(row.count || 0, 10);
  const incomeCount = parseInt(row.incomeCount || 0, 10);
  const expenseCount = parseInt(row.expenseCount || 0, 10);
  const incomeAverage = parseFloat(row.incomeAverage || 0);
  const expenseAverage = parseFloat(row.expenseAverage || 0);
  const overallAverage = parseFloat(row.overallAverage || 0);
  const balance = income - expense;

  let average = overallAverage;
  if (filterType === 'income') average = incomeAverage;
  else if (filterType === 'expense') average = expenseAverage;

  let largest = null;
  let smallest = null;

  if (count > 0) {
    let orderQuery = `SELECT t.id, t.title, t.amount, t.type, t.date, c.name as category_name
                      FROM transactions t
                      LEFT JOIN categories c ON t.category_id = c.id
                      WHERE t.user_id = ?`;
    const orderParams = [userId];
    if (winFrom) {
      orderQuery += ' AND t.date >= ?';
      orderParams.push(winFrom);
    }
    if (winTo) {
      orderQuery += ' AND t.date <= ?';
      orderParams.push(winTo);
    }
    if (filterType && filterType !== 'all') {
      orderQuery += ' AND t.type = ?';
      orderParams.push(filterType);
    }
    if (filterCategoryId) {
      orderQuery += ' AND t.category_id = ?';
      orderParams.push(filterCategoryId);
    }
    if (filterSearch) {
      orderQuery += ' AND (t.title LIKE ? OR t.description LIKE ?)';
      orderParams.push(`%${filterSearch}%`, `%${filterSearch}%`);
    }
    if (filterReceipt === 'true' || filterReceipt === true) {
      orderQuery += ' AND t.receipt_url IS NOT NULL AND t.receipt_url != ""';
    }

    const [maxRows] = await pool.query(`${orderQuery} ORDER BY t.amount DESC, t.id DESC LIMIT 1`, orderParams);
    const [minRows] = await pool.query(`${orderQuery} ORDER BY t.amount ASC, t.id ASC LIMIT 1`, orderParams);

    if (maxRows.length > 0) {
      largest = {
        id: maxRows[0].id,
        title: maxRows[0].title,
        amount: parseFloat(maxRows[0].amount || 0),
        type: maxRows[0].type,
        date: maxRows[0].date,
        category_name: maxRows[0].category_name || 'Uncategorized',
      };
    }
    if (minRows.length > 0) {
      smallest = {
        id: minRows[0].id,
        title: minRows[0].title,
        amount: parseFloat(minRows[0].amount || 0),
        type: minRows[0].type,
        date: minRows[0].date,
        category_name: minRows[0].category_name || 'Uncategorized',
      };
    }
  }

  return {
    income,
    expense,
    balance,
    highestExpense,
    count,
    incomeCount,
    expenseCount,
    average,
    incomeAverage,
    expenseAverage,
    largest,
    smallest,
  };
};

exports.getStats = async (req, res) => {
  try {
    const { fromDate, toDate, from, to, type, category_id, search, has_receipt, compare } = req.query;
    const effectiveFrom = fromDate || from;
    const effectiveTo = toDate || to;

    const current = await computeTransactionStatsForWindow(
      req.user.id,
      effectiveFrom,
      effectiveTo,
      type,
      category_id,
      search,
      has_receipt
    );

    let previous = null;
    let delta = null;

    if (compare === 'previous' && effectiveFrom && effectiveTo) {
      const fromD = new Date(effectiveFrom);
      const toD = new Date(effectiveTo);
      const diffTime = Math.max(0, toD.getTime() - fromD.getTime());
      const diffDays = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1);

      const prevToD = new Date(fromD.getTime() - 24 * 60 * 60 * 1000);
      const prevFromD = new Date(prevToD.getTime() - (diffDays - 1) * 24 * 60 * 60 * 1000);

      const prevFrom = prevFromD.toISOString().split('T')[0];
      const prevTo = prevToD.toISOString().split('T')[0];

      const prevStats = await computeTransactionStatsForWindow(
        req.user.id,
        prevFrom,
        prevTo,
        type,
        category_id,
        search,
        has_receipt
      );

      // §3A.1 & §3A.4: If no preceding data, return null rather than zeros
      if (prevStats.count > 0 || prevStats.income > 0 || prevStats.expense > 0) {
        previous = prevStats;

        const calcDelta = (cur, prev) => {
          if (prev === null || prev === undefined || prev === 0) return null;
          return parseFloat((((cur - prev) / Math.abs(prev)) * 100).toFixed(2));
        };

        delta = {
          income: calcDelta(current.income, prevStats.income),
          expense: calcDelta(current.expense, prevStats.expense),
          balance: calcDelta(current.balance, prevStats.balance),
          count: calcDelta(current.count, prevStats.count),
          average: calcDelta(current.average, prevStats.average),
        };
      }
    }

    res.status(200).json({
      ...current,
      current,
      previous,
      delta,
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
};

exports.getTransactions = async (req, res) => {
  try {
    const requestedLimit = parseInt(req.query.limit, 10) || 20;
    const limit = Math.min(Math.max(1, requestedLimit), 100);
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const { type, fromDate, toDate, category_id, search, has_receipt } = req.query;

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
    if (category_id) {
      query += ' AND t.category_id = ?';
      countQuery += ' AND t.category_id = ?';
      params.push(category_id);
      countParams.push(category_id);
    }
    if (search) {
      query += ' AND (t.title LIKE ? OR t.description LIKE ?)';
      countQuery += ' AND (t.title LIKE ? OR t.description LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
      countParams.push(`%${search}%`, `%${search}%`);
    }
    if (has_receipt === 'true' || has_receipt === true) {
      query += ' AND t.receipt_url IS NOT NULL AND t.receipt_url != ""';
      countQuery += ' AND t.receipt_url IS NOT NULL AND t.receipt_url != ""';
    }

    query += ' ORDER BY t.date DESC, t.id DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const [transactions] = await pool.query(query, params);
    const [countRows] = await pool.query(countQuery, countParams);
    
    const nextOffset = transactions.length === limit ? offset + limit : null;
    const transactionsWithUrls = transactions.map(tx => formatTransactionRow(req, tx));
    
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
  const receipt_url = req.file ? getRelativeKey(req, req.file, 'receipts') : null;

  if (!title || !amount || !type || !date) {
    return res.status(400).json({ error: 'Title, amount, type, and date are required' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

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

      const dateStr = subToUpdate.next_billing_date instanceof Date
        ? subToUpdate.next_billing_date.toISOString().split('T')[0]
        : String(subToUpdate.next_billing_date).split('T')[0];

      newNextBillingDate = calculateNextBillingDate(dateStr, subToUpdate.billing_cycle);
    }

    // Insert Transaction
    const [result] = await connection.query(
      `INSERT INTO transactions 
      (user_id, title, amount, type, date, category_id, description, receipt_url, subscription_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, title, amount, type, date, category_id || null, description || null, receipt_url, subscription_id || null]
    );

    const transactionId = result.insertId;

    // Advance the billing date if linked to subscription
    if (subToUpdate && newNextBillingDate) {
      await connection.query(
        'UPDATE subscriptions SET next_billing_date = ? WHERE id = ?',
        [newNextBillingDate, subscription_id]
      );
    }

    // Fetch the inserted transaction with category details
    const [insertedRows] = await connection.query(
      `SELECT t.*, c.name as category_name, c.icon_name as category_icon, c.color as category_color 
       FROM transactions t 
       LEFT JOIN categories c ON t.category_id = c.id 
       WHERE t.id = ? AND t.user_id = ?`,
      [transactionId, req.user.id]
    );

    await connection.commit();

    const formattedTx = formatTransactionRow(req, insertedRows[0]);
    res.status(201).json({
      success: true,
      id: transactionId,
      message: 'Transaction created successfully',
      receipt_url: formattedTx?.receipt_url,
      data: formattedTx
    });
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

    const transaction = formatTransactionRow(req, rows[0]);
    res.status(200).json(transaction);
  } catch (error) {
    console.error('Error fetching transaction details:', error);
    res.status(500).json({ error: 'Failed to fetch transaction details' });
  }
};

/**
 * Update transaction with Section 1.1 subscription guard
 */
exports.updateTransaction = async (req, res) => {
  const transactionId = req.params.id;
  const userId = req.user.id;
  const { 
    title, 
    subtitle, 
    amount, 
    type, 
    date, 
    category_id, 
    description, 
    icon_name, 
    icon_bg_color,
    remove_receipt 
  } = req.body;

  const connection = await pool.getConnection();
  let oldReceiptToDelete = null;

  try {
    await connection.beginTransaction();

    // 1. Ownership & existence check
    const [existing] = await connection.query(
      'SELECT * FROM transactions WHERE id = ? AND user_id = ?',
      [transactionId, userId]
    );

    if (existing.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const tx = existing[0];

    // 2. Locked-field guard for subscription-linked transactions (§1.1)
    if (tx.subscription_id != null) {
      const dateStr = tx.date instanceof Date 
        ? tx.date.toISOString().split('T')[0] 
        : String(tx.date).split('T')[0];

      const isAmountChanged = amount !== undefined && parseFloat(amount) !== parseFloat(tx.amount);
      const isDateChanged = date !== undefined && String(date).split('T')[0] !== dateStr;
      const isTypeChanged = type !== undefined && type !== tx.type;

      if (isAmountChanged || isDateChanged || isTypeChanged) {
        await connection.rollback();
        return res.status(409).json({
          error: 'This transaction is linked to a recurring subscription. Amount, date, and type are locked. To reverse this payment, use the subscription undo-payment action.'
        });
      }
    }

    // 3. Category ownership validation
    if (category_id !== undefined && category_id !== null && category_id !== '') {
      const [cat] = await connection.query(
        'SELECT id FROM categories WHERE id = ? AND user_id = ?',
        [category_id, userId]
      );
      if (cat.length === 0) {
        await connection.rollback();
        return res.status(400).json({ error: 'Selected category does not exist or does not belong to you' });
      }
    }

    // 4. Receipt lifecycle
    let newReceiptUrl = tx.receipt_url;
    if (req.file) {
      newReceiptUrl = getRelativeKey(req, req.file, 'receipts');
      if (tx.receipt_url) {
        oldReceiptToDelete = tx.receipt_url;
      }
    } else if (remove_receipt === 'true' || remove_receipt === true) {
      newReceiptUrl = null;
      if (tx.receipt_url) {
        oldReceiptToDelete = tx.receipt_url;
      }
    }

    // 5. Update transaction fields (locked fields remain as tx value for subscription-linked)
    const updatedTitle = title !== undefined ? title : tx.title;
    const updatedSubtitle = subtitle !== undefined ? subtitle : tx.subtitle;
    const updatedAmount = tx.subscription_id != null ? tx.amount : (amount !== undefined ? parseFloat(amount) : tx.amount);
    const updatedType = tx.subscription_id != null ? tx.type : (type !== undefined ? type : tx.type);
    const updatedDate = tx.subscription_id != null ? tx.date : (date !== undefined ? date : tx.date);
    const updatedCategoryId = category_id !== undefined ? (category_id === '' || category_id === null ? null : category_id) : tx.category_id;
    const updatedDescription = description !== undefined ? description : tx.description;
    const updatedIconName = icon_name !== undefined ? icon_name : tx.icon_name;
    const updatedIconBg = icon_bg_color !== undefined ? icon_bg_color : tx.icon_bg_color;

    await connection.query(
      `UPDATE transactions SET
        title = ?,
        subtitle = ?,
        amount = ?,
        type = ?,
        date = ?,
        category_id = ?,
        description = ?,
        icon_name = ?,
        icon_bg_color = ?,
        receipt_url = ?,
        updated_at = NOW()
       WHERE id = ? AND user_id = ?`,
      [
        updatedTitle,
        updatedSubtitle,
        updatedAmount,
        updatedType,
        updatedDate,
        updatedCategoryId,
        updatedDescription,
        updatedIconName,
        updatedIconBg,
        newReceiptUrl,
        transactionId,
        userId
      ]
    );

    // Fetch the updated row with category join
    const [updatedRows] = await connection.query(
      `SELECT t.*, c.name as category_name, c.icon_name as category_icon, c.color as category_color
       FROM transactions t
       LEFT JOIN categories c ON t.category_id = c.id
       WHERE t.id = ? AND t.user_id = ?`,
      [transactionId, userId]
    );

    await connection.commit();

    // Delete old receipt file from disk after commit succeeds
    if (oldReceiptToDelete) {
      deleteFile(oldReceiptToDelete);
    }

    const responseTx = formatTransactionRow(req, updatedRows[0]);
    return res.status(200).json({
      success: true,
      message: 'Transaction updated successfully',
      data: responseTx
    });
  } catch (error) {
    await connection.rollback();
    console.error('Error updating transaction:', error);
    return res.status(500).json({ error: 'Failed to update transaction' });
  } finally {
    connection.release();
  }
};

/**
 * Delete transaction with Section 1.1 subscription guard
 */
exports.deleteTransaction = async (req, res) => {
  const transactionId = req.params.id;
  const userId = req.user.id;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Ownership & existence check
    const [existing] = await connection.query(
      'SELECT * FROM transactions WHERE id = ? AND user_id = ?',
      [transactionId, userId]
    );

    if (existing.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const tx = existing[0];

    // 2. Locked-field guard for subscription-linked transactions (§1.1)
    if (tx.subscription_id != null) {
      await connection.rollback();
      return res.status(409).json({
        error: 'This transaction is linked to a recurring subscription. To remove this payment and roll back the schedule, undo the payment from the subscription screen.'
      });
    }

    // 3. Delete transaction row
    await connection.query(
      'DELETE FROM transactions WHERE id = ? AND user_id = ?',
      [transactionId, userId]
    );

    await connection.commit();

    // 4. Delete file from disk after commit
    if (tx.receipt_url) {
      deleteFile(tx.receipt_url);
    }

    return res.status(200).json({
      success: true,
      message: 'Transaction deleted successfully'
    });
  } catch (error) {
    await connection.rollback();
    console.error('Error deleting transaction:', error);
    return res.status(500).json({ error: 'Failed to delete transaction' });
  } finally {
    connection.release();
  }
};
