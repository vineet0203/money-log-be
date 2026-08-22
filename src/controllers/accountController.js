const { pool } = require('../config/db');

exports.getAccounts = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const page  = parseInt(req.query.page)  || 1;
    const offset = (page - 1) * limit;

    const [[{ total }]] = await pool.query(
      'SELECT COUNT(*) as total FROM accounts WHERE user_id = ?',
      [req.user.id]
    );

    const [rows] = await pool.query(
      'SELECT * FROM accounts WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [req.user.id, limit, offset]
    );

    const totalPages = Math.max(1, Math.ceil(total / limit));

    res.status(200).json({
      data: rows,
      pagination: {
        currentPage: page,
        totalPages,
        totalItems: total,
        itemsPerPage: limit,
      }
    });
  } catch (error) {
    console.error('Error fetching accounts:', error);
    res.status(500).json({ error: 'Failed to fetch accounts' });
  }
};

exports.getAccountById = async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await pool.query(
      'SELECT * FROM accounts WHERE id = ? AND user_id = ?',
      [id, req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Account not found' });
    }

    res.status(200).json({ data: rows[0] });
  } catch (error) {
    console.error('Error fetching account:', error);
    res.status(500).json({ error: 'Failed to fetch account' });
  }
};

exports.addAccount = async (req, res) => {
  const { type, name, account_number, holder_name, expiry_date, provider, external_id } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Account name is required' });
  }

  const accountType = type || 'bank';

  try {
    const [result] = await pool.query(
      `INSERT INTO accounts 
      (user_id, type, name, account_number, holder_name, expiry_date, provider, external_id) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, accountType, name, account_number, holder_name, expiry_date, provider, external_id]
    );

    const [newAccount] = await pool.query('SELECT * FROM accounts WHERE id = ?', [result.insertId]);
    res.status(201).json(newAccount[0]);
  } catch (error) {
    console.error('Error adding account:', error);
    res.status(500).json({ error: 'Failed to add account' });
  }
};

exports.updateAccount = async (req, res) => {
  const { id } = req.params;
  const { type, name, account_number, holder_name, expiry_date, provider, external_id } = req.body;

  try {
    const [existing] = await pool.query('SELECT * FROM accounts WHERE id = ? AND user_id = ?', [id, req.user.id]);
    
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Account not found or unauthorized' });
    }

    await pool.query(
      `UPDATE accounts SET 
        type = COALESCE(?, type), 
        name = COALESCE(?, name), 
        account_number = COALESCE(?, account_number), 
        holder_name = COALESCE(?, holder_name),
        expiry_date = COALESCE(?, expiry_date),
        provider = COALESCE(?, provider),
        external_id = COALESCE(?, external_id)
      WHERE id = ?`,
      [type, name, account_number, holder_name, expiry_date, provider, external_id, id]
    );

    const [updated] = await pool.query('SELECT * FROM accounts WHERE id = ?', [id]);
    res.status(200).json(updated[0]);
  } catch (error) {
    console.error('Error updating account:', error);
    res.status(500).json({ error: 'Failed to update account' });
  }
};

exports.deleteAccount = async (req, res) => {
  const { id } = req.params;

  try {
    const [result] = await pool.query('DELETE FROM accounts WHERE id = ? AND user_id = ?', [id, req.user.id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Account not found or unauthorized' });
    }

    // Clean up orphaned Plaid items if all accounts for an institution are deleted
    await pool.query(`
      DELETE p FROM plaid_items p
      WHERE p.user_id = ? 
      AND NOT EXISTS (
        SELECT 1 FROM accounts a 
        WHERE a.user_id = p.user_id 
        AND a.provider = 'plaid' 
        AND a.item_id = p.item_id
      )
    `, [req.user.id]);

    res.status(200).json({ message: 'Account deleted successfully' });
  } catch (error) {
    console.error('Error deleting account:', error);
    res.status(500).json({ error: 'Failed to delete account' });
  }
};

exports.bulkDeleteAccounts = async (req, res) => {
  const { ids } = req.body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'Valid account IDs array is required' });
  }

  try {
    // Delete multiple accounts that belong to the user
    const placeholders = ids.map(() => '?').join(',');
    const [result] = await pool.query(
      `DELETE FROM accounts WHERE user_id = ? AND id IN (${placeholders})`,
      [req.user.id, ...ids]
    );

    // Clean up orphaned Plaid items if all accounts for an institution are deleted
    await pool.query(`
      DELETE p FROM plaid_items p
      WHERE p.user_id = ? 
      AND NOT EXISTS (
        SELECT 1 FROM accounts a 
        WHERE a.user_id = p.user_id 
        AND a.provider = 'plaid' 
        AND a.item_id = p.item_id
      )
    `, [req.user.id]);

    res.status(200).json({ 
      message: 'Accounts deleted successfully',
      deletedCount: result.affectedRows 
    });
  } catch (error) {
    console.error('Error bulk deleting accounts:', error);
    res.status(500).json({ error: 'Failed to bulk delete accounts' });
  }
};

exports.getAccountTransactions = async (req, res) => {
  const { id } = req.params;
  const limit  = parseInt(req.query.limit) || 10;
  const page   = parseInt(req.query.page)  || 1;
  const offset = (page - 1) * limit;

  try {
    // Verify account belongs to user
    const [account] = await pool.query(
      'SELECT id FROM accounts WHERE id = ? AND user_id = ?',
      [id, req.user.id]
    );
    if (account.length === 0) {
      return res.status(404).json({ error: 'Account not found or unauthorized' });
    }

    const [[{ total }]] = await pool.query(
      'SELECT COUNT(*) as total FROM account_transactions WHERE account_id = ? AND user_id = ?',
      [id, req.user.id]
    );

    const [rows] = await pool.query(
      'SELECT * FROM account_transactions WHERE account_id = ? AND user_id = ? ORDER BY date DESC, created_at DESC LIMIT ? OFFSET ?',
      [id, req.user.id, limit, offset]
    );

    const totalPages = Math.max(1, Math.ceil(total / limit));

    res.status(200).json({
      data: rows,
      pagination: {
        currentPage: page,
        totalPages,
        totalItems: total,
        itemsPerPage: limit,
      }
    });
  } catch (error) {
    console.error('Error fetching account transactions:', error);
    res.status(500).json({ error: 'Failed to fetch account transactions' });
  }
};

// Get a single account transaction by its local ID
exports.getAccountTransactionById = async (req, res) => {
  try {
    const { txnId } = req.params;
    const [transactions] = await pool.query(
      'SELECT * FROM account_transactions WHERE id = ? AND user_id = ?',
      [txnId, req.user.id]
    );

    if (transactions.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    res.json({ data: transactions[0] });
  } catch (error) {
    console.error('Error fetching account transaction details:', error);
    res.status(500).json({ error: 'Failed to fetch transaction details' });
  }
};
