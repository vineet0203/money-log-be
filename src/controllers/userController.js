const { pool } = require('../config/db');

exports.getProfile = async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, phone_number, name, email, profile_image_url, global_sms_enabled, global_email_enabled, global_push_enabled, timezone FROM users WHERE id = ?',
      [req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(rows[0]);
  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const { name, email, global_sms_enabled, global_email_enabled, global_push_enabled, timezone } = req.body;
    let profileImageUrl = req.file ? `/uploads/${req.file.filename}` : undefined;

    // Build dynamic update query
    const updates = [];
    const values = [];

    if (name !== undefined) {
      updates.push('name = ?');
      values.push(name.trim());
    }

    if (email !== undefined) {
      updates.push('email = ?');
      // If email is provided but empty, convert to null
      values.push(email && email.trim() !== '' ? email.trim() : null);
    }

    if (profileImageUrl !== undefined) {
      updates.push('profile_image_url = ?');
      values.push(profileImageUrl);
    }

    if (global_sms_enabled !== undefined) {
      updates.push('global_sms_enabled = ?');
      values.push(global_sms_enabled === 'true' || global_sms_enabled === true);
    }

    if (global_email_enabled !== undefined) {
      updates.push('global_email_enabled = ?');
      values.push(global_email_enabled === 'true' || global_email_enabled === true);
    }

    if (global_push_enabled !== undefined) {
      updates.push('global_push_enabled = ?');
      values.push(global_push_enabled === 'true' || global_push_enabled === true);
    }

    if (timezone !== undefined) {
      updates.push('timezone = ?');
      values.push(timezone);
    }

    if (updates.length > 0) {
      values.push(req.user.id);
      await pool.query(
        `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
        values
      );
    }

    // Fetch updated user
    const [rows] = await pool.query(
      'SELECT id, phone_number, name, email, profile_image_url, global_sms_enabled, global_email_enabled, global_push_enabled, timezone FROM users WHERE id = ?',
      [req.user.id]
    );

    res.json({ message: 'Profile updated successfully', user: rows[0] });
  } catch (error) {
    console.error('Error updating user profile:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Email is already in use by another account' });
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
