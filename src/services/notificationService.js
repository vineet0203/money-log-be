const { pool } = require('../config/db');

/**
 * Creates an in-app system notification for a user.
 * System notifications are ALWAYS enabled and recorded into in_app_notifications.
 *
 * @param {object} params
 * @param {number} params.userId - Target user ID
 * @param {string} params.title - Notification title
 * @param {string} params.message - Body text
 * @param {'info'|'warning'|'alert'|'success'} [params.type='info'] - Severity/type
 * @param {string|null} [params.linkUrl=null] - Optional deep-link URL (e.g. '/subscriptions', '/transactions')
 * @returns {Promise<number>} - ID of the created notification
 */
async function createSystemNotification({
  userId,
  title,
  message,
  type = 'info',
  linkUrl = null,
}) {
  if (!userId || !title || !message) {
    throw new Error('userId, title, and message are required for system notification');
  }

  const validTypes = ['info', 'warning', 'alert', 'success'];
  const normalizedType = validTypes.includes(type) ? type : 'info';

  const [result] = await pool.query(
    `INSERT INTO in_app_notifications (user_id, title, message, type, link_url)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, title, message, normalizedType, linkUrl]
  );

  return result.insertId;
}

/**
 * Queues outbound external alert jobs (Push, Email, SMS) for a subscription event
 * based on user global preferences and subscription-level overrides.
 */
async function queueOutboundAlerts({
  subscriptionId,
  userId,
  userPrefs,
  subPrefs,
}) {
  let queuedCount = 0;

  // 1. Push notification
  if (userPrefs?.global_push_enabled) {
    await pool.query(
      `INSERT INTO notification_queue (subscription_id, user_id, type) VALUES (?, ?, 'push')`,
      [subscriptionId, userId]
    );
    queuedCount++;
  }

  // 2. Email notification
  if (userPrefs?.global_email_enabled && (subPrefs?.is_email_enabled ?? true)) {
    await pool.query(
      `INSERT INTO notification_queue (subscription_id, user_id, type) VALUES (?, ?, 'email')`,
      [subscriptionId, userId]
    );
    queuedCount++;
  }

  // 3. SMS notification (off by default, requires both global and subscription opt-in)
  if (userPrefs?.global_sms_enabled && subPrefs?.is_sms_enabled) {
    await pool.query(
      `INSERT INTO notification_queue (subscription_id, user_id, type) VALUES (?, ?, 'sms')`,
      [subscriptionId, userId]
    );
    queuedCount++;
  }

  return queuedCount;
}

module.exports = {
  createSystemNotification,
  queueOutboundAlerts,
};
