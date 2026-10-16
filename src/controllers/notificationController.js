const { pool } = require('../config/db');

exports.getUnreadCount = async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT COUNT(*) as count FROM in_app_notifications WHERE user_id = ? AND is_read = FALSE',
      [req.user.id]
    );
    res.status(200).json({ unreadCount: Number(rows[0].count) || 0 });
  } catch (error) {
    console.error('Error fetching unread count:', error);
    res.status(500).json({ error: 'Failed to fetch unread count' });
  }
};

exports.getNotifications = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    const unreadOnly = req.query.unread_only === true ||
      req.query.unread_only === 'true' ||
      req.query.unread_only === '1' ||
      req.query.unread_only === 1;

    let whereClause = 'WHERE user_id = ?';
    const params = [req.user.id];

    if (unreadOnly) {
      whereClause += ' AND is_read = FALSE';
    }

    // 1. Fetch paginated rows
    const dataQuery = `
      SELECT id, user_id, title, message, type, link_url, is_read, created_at
      FROM in_app_notifications
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `;
    const [rows] = await pool.query(dataQuery, [...params, limit, offset]);

    // 2. Fetch total count matching filter
    const countQuery = `
      SELECT COUNT(*) as total
      FROM in_app_notifications
      ${whereClause}
    `;
    const [countRows] = await pool.query(countQuery, params);
    const totalItems = Number(countRows[0]?.total) || 0;
    const totalPages = Math.ceil(totalItems / limit) || 1;

    // 3. Fetch total unread count for user badge
    const [unreadRows] = await pool.query(
      'SELECT COUNT(*) as count FROM in_app_notifications WHERE user_id = ? AND is_read = FALSE',
      [req.user.id]
    );
    const unreadCount = Number(unreadRows[0]?.count) || 0;

    res.status(200).json({
      data: rows,
      page,
      limit,
      totalItems,
      totalPages,
      unreadCount,
    });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
};

exports.markAsRead = async (req, res) => {
  try {
    const notificationId = req.params.id;

    const [result] = await pool.query(
      'UPDATE in_app_notifications SET is_read = TRUE WHERE id = ? AND user_id = ?',
      [notificationId, req.user.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.status(200).json({ message: 'Notification marked as read', id: Number(notificationId) });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({ error: 'Failed to update notification' });
  }
};

exports.markAllAsRead = async (req, res) => {
  try {
    const [result] = await pool.query(
      'UPDATE in_app_notifications SET is_read = TRUE WHERE user_id = ? AND is_read = FALSE',
      [req.user.id]
    );

    res.status(200).json({
      message: 'All notifications marked as read',
      affectedCount: result.affectedRows,
    });
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    res.status(500).json({ error: 'Failed to update notifications' });
  }
};

exports.deleteNotification = async (req, res) => {
  try {
    const notificationId = req.params.id;

    const [result] = await pool.query(
      'DELETE FROM in_app_notifications WHERE id = ? AND user_id = ?',
      [notificationId, req.user.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.status(200).json({ message: 'Notification deleted successfully', id: Number(notificationId) });
  } catch (error) {
    console.error('Error deleting notification:', error);
    res.status(500).json({ error: 'Failed to delete notification' });
  }
};
