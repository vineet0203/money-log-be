const { pool } = require('../config/db');
const { getRelativeKey, deleteFile, buildPublicUrl } = require('../services/storageService');

exports.getProfile = async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, phone_number, name, email, profile_image_url, global_sms_enabled, global_email_enabled, global_push_enabled, timezone, created_at FROM users WHERE id = ?',
      [req.user.id]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Unauthorized: User not found' });
    }

    res.json({
      ...rows[0],
      profile_image_url: buildPublicUrl(req, rows[0].profile_image_url)
    });
  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const { name, email, global_sms_enabled, global_email_enabled, global_push_enabled, timezone, remove_profile_image } = req.body;
    let profileImageUrl = req.file ? getRelativeKey(req, req.file, 'profiles') : undefined;

    // Build dynamic update query
    const updates = [];
    const values = [];

    if (name !== undefined) {
      updates.push('name = ?');
      values.push(name.trim());
    }

    // Email is the verified primary identity and cannot be changed

    const incomingPhone = req.body.phone_number !== undefined ? req.body.phone_number : req.body.phone;
    if (incomingPhone !== undefined) {
      updates.push('phone_number = ?');
      values.push(incomingPhone && incomingPhone.trim() !== '' ? incomingPhone.trim() : null);
    }

    if (profileImageUrl !== undefined) {
      updates.push('profile_image_url = ?');
      values.push(profileImageUrl);
    } else if (remove_profile_image === 'true' || remove_profile_image === true) {
      updates.push('profile_image_url = NULL');
    }

    if (global_sms_enabled !== undefined) {
      updates.push('global_sms_enabled = ?');
      values.push(global_sms_enabled === 'true' || global_sms_enabled === true || global_sms_enabled === 1 || global_sms_enabled === '1');
    }

    if (global_email_enabled !== undefined) {
      updates.push('global_email_enabled = ?');
      values.push(global_email_enabled === 'true' || global_email_enabled === true || global_email_enabled === 1 || global_email_enabled === '1');
    }

    if (global_push_enabled !== undefined) {
      updates.push('global_push_enabled = ?');
      values.push(global_push_enabled === 'true' || global_push_enabled === true || global_push_enabled === 1 || global_push_enabled === '1');
    }

    if (timezone !== undefined) {
      updates.push('timezone = ?');
      values.push(timezone);
    }

    if (updates.length > 0) {
      if (profileImageUrl !== undefined || remove_profile_image === 'true' || remove_profile_image === true) {
        const [oldRows] = await pool.query('SELECT profile_image_url FROM users WHERE id = ?', [req.user.id]);
        if (oldRows.length > 0 && oldRows[0].profile_image_url) {
          deleteFile(oldRows[0].profile_image_url);
        }
      }

      values.push(req.user.id);
      await pool.query(
        `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
        values
      );
    }

    // Fetch updated user
    const [rows] = await pool.query(
      'SELECT id, phone_number, name, email, profile_image_url, global_sms_enabled, global_email_enabled, global_push_enabled, timezone, created_at FROM users WHERE id = ?',
      [req.user.id]
    );

    res.json({
      message: 'Profile updated successfully',
      user: {
        ...rows[0],
        profile_image_url: buildPublicUrl(req, rows[0].profile_image_url)
      }
    });
  } catch (error) {
    console.error('Error updating user profile:', error);
    if (error.code === 'ER_DUP_ENTRY' || error.errno === 1062) {
      const msg = (error.sqlMessage || error.message || '').toLowerCase();
      if (msg.includes('uniq_users_phone') || msg.includes('phone')) {
        return res.status(409).json({ error: 'This mobile number is already in use by another account.' });
      }
      return res.status(409).json({ error: 'Email or mobile number is already in use by another account.' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.updatePushToken = async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }

    await pool.query(
      'INSERT IGNORE INTO user_push_tokens (user_id, push_token) VALUES (?, ?)', 
      [req.user.id, token]
    );
    res.json({ message: 'Push token updated successfully' });
  } catch (error) {
    console.error('Error updating push token:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Permanently deletes user account and cascades deletion across all tables
 * Complies with Apple App Store Review Guideline 5.1.1(v)
 */
exports.deleteAccount = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { email } = req.body;
    const userId = req.user.id;

    const [userRows] = await connection.query(
      'SELECT id, email, profile_image_url FROM users WHERE id = ?',
      [userId]
    );

    if (userRows.length === 0) {
      connection.release();
      return res.status(404).json({ error: 'User not found' });
    }

    const currentUser = userRows[0];
    if (currentUser.email.trim().toLowerCase() !== email.trim().toLowerCase()) {
      connection.release();
      return res.status(400).json({
        error: 'Confirmation email does not match your registered email address'
      });
    }

    await connection.beginTransaction();

    // 1. POS child tables with RESTRICT or dependent references
    await connection.query('DELETE FROM pos_returns WHERE user_id = ?', [userId]);
    await connection.query('DELETE FROM pos_exchanges WHERE user_id = ?', [userId]);
    await connection.query('DELETE FROM pos_supplier_payments WHERE user_id = ?', [userId]);
    await connection.query('DELETE FROM pos_purchase_bills WHERE user_id = ?', [userId]);
    await connection.query('DELETE FROM pos_goods_receipts WHERE user_id = ?', [userId]);
    await connection.query(
      'DELETE item FROM pos_po_items item JOIN pos_purchase_orders po ON item.po_id = po.id WHERE po.user_id = ?',
      [userId]
    );
    await connection.query('DELETE FROM pos_purchase_orders WHERE user_id = ?', [userId]);
    await connection.query('DELETE FROM pos_suppliers WHERE user_id = ?', [userId]);

    await connection.query(
      'DELETE pay FROM pos_order_payments pay JOIN pos_orders ord ON pay.order_id = ord.id WHERE ord.user_id = ?',
      [userId]
    );
    await connection.query(
      'DELETE cfg FROM pos_order_receipt_configs cfg JOIN pos_orders ord ON cfg.order_id = ord.id WHERE ord.user_id = ?',
      [userId]
    );
    await connection.query(
      'DELETE item FROM pos_order_items item JOIN pos_orders ord ON item.order_id = ord.id WHERE ord.user_id = ?',
      [userId]
    );
    await connection.query('DELETE FROM pos_orders WHERE user_id = ?', [userId]);

    await connection.query('DELETE FROM pos_product_variants WHERE user_id = ?', [userId]);
    await connection.query('DELETE FROM pos_products WHERE user_id = ?', [userId]);
    await connection.query('DELETE FROM pos_brands WHERE user_id = ?', [userId]);
    await connection.query('DELETE FROM pos_categories WHERE user_id = ?', [userId]);
    await connection.query('DELETE FROM pos_settings WHERE user_id = ?', [userId]);
    await connection.query('DELETE FROM pos_shifts WHERE user_id = ?', [userId]);
    await connection.query('DELETE FROM pos_daily_aggregates WHERE user_id = ?', [userId]);

    // 2. Finance, Plaid, Transactions, Subscriptions & Liabilities
    await connection.query(
      'DELETE apr FROM liability_aprs apr JOIN account_liabilities al ON apr.account_liability_id = al.id JOIN accounts a ON al.account_id = a.id WHERE a.user_id = ?',
      [userId]
    );
    await connection.query(
      'DELETE al FROM account_liabilities al JOIN accounts a ON al.account_id = a.id WHERE a.user_id = ?',
      [userId]
    );
    await connection.query('DELETE FROM account_transactions WHERE user_id = ?', [userId]);
    await connection.query('DELETE FROM accounts WHERE user_id = ?', [userId]);
    await connection.query('DELETE FROM plaid_items WHERE user_id = ?', [userId]);
    await connection.query('DELETE FROM asset_reports WHERE user_id = ?', [userId]);

    await connection.query('DELETE FROM recurring_occurrences WHERE user_id = ?', [userId]);
    await connection.query('DELETE FROM transactions WHERE user_id = ?', [userId]);
    await connection.query('DELETE FROM subscriptions WHERE user_id = ?', [userId]);
    await connection.query('DELETE FROM categories WHERE user_id = ?', [userId]);

    // 3. In-App Notifications & Auth Tokens
    await connection.query('DELETE FROM in_app_notifications WHERE user_id = ?', [userId]);
    await connection.query('DELETE FROM notification_queue WHERE user_id = ?', [userId]);
    await connection.query('DELETE FROM refresh_tokens WHERE user_id = ?', [userId]);
    await connection.query('DELETE FROM password_reset_tokens WHERE user_id = ?', [userId]);
    await connection.query('DELETE FROM email_verification_otps WHERE user_id = ?', [userId]);
    await connection.query('DELETE FROM user_push_tokens WHERE user_id = ?', [userId]);

    // 4. Clean up user profile photo from disk/storage
    if (currentUser.profile_image_url) {
      deleteFile(currentUser.profile_image_url);
    }

    // 5. Permanently remove the user record
    await connection.query('DELETE FROM users WHERE id = ?', [userId]);

    await connection.commit();
    connection.release();

    return res.json({
      message: 'Account and all associated personal data have been permanently deleted.'
    });
  } catch (error) {
    await connection.rollback();
    connection.release();
    console.error('Error permanently deleting user account:', error);
    return res.status(500).json({ error: 'Internal server error while deleting account' });
  }
};
