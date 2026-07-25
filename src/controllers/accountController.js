const { pool } = require('../config/db');

exports.getAccounts = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;

    const [rows] = await pool.query(
      'SELECT * FROM accounts WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [req.user.id, limit, offset]
    );
    
    const nextOffset = rows.length === limit ? offset + limit : null;
    
    res.status(200).json({
      data: rows,
      nextOffset
    });
  } catch (error) {
    console.error('Error fetching accounts:', error);
    res.status(500).json({ error: 'Failed to fetch accounts' });
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

    res.status(200).json({ message: 'Account deleted successfully' });
  } catch (error) {
    console.error('Error deleting account:', error);
    res.status(500).json({ error: 'Failed to delete account' });
  }
};

exports.getAccountTransactions = async (req, res) => {
  const { id } = req.params;
  const limit = parseInt(req.query.limit) || 20;
  const offset = parseInt(req.query.offset) || 0;

  try {
    const [rows] = await pool.query(
      'SELECT * FROM account_transactions WHERE account_id = ? AND user_id = ? ORDER BY date DESC, created_at DESC LIMIT ? OFFSET ?',
      [id, req.user.id, limit, offset]
    );

    const nextOffset = rows.length === limit ? offset + limit : null;

    res.status(200).json({
      data: rows,
      nextOffset
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
