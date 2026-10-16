const { pool } = require('../config/db');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const { createSystemNotification, queueOutboundAlerts } = require('../services/notificationService');

dayjs.extend(utc);
dayjs.extend(timezone);

async function seedNotificationQueue() {
  console.log('[Queue Seeder] Running hourly localized notification check...');
  try {
    // 1. Fetch active subscriptions where reminder is ON
    // and next_billing_date is exactly `reminder_days` away from the user's LOCAL today.
    const [subscriptions] = await pool.query(`
      SELECT s.*, u.global_push_enabled, u.global_email_enabled, u.global_sms_enabled, u.timezone
      FROM subscriptions s
      JOIN users u ON s.user_id = u.id
      WHERE s.status = 'active'
        AND s.is_reminder_on = TRUE
    `);

    if (subscriptions.length === 0) {
      console.log('[Queue Seeder] No active subscriptions with reminders found.');
      return;
    }

    let queuedCount = 0;
    const nowUtc = dayjs.utc();

    for (const sub of subscriptions) {
      const userTz = sub.timezone || 'UTC';
      
      let localTime;
      try {
        localTime = nowUtc.tz(userTz);
      } catch (e) {
        console.warn(`[Queue Seeder] Invalid timezone ${userTz} for user ${sub.user_id}, falling back to UTC`);
        localTime = nowUtc.tz('UTC');
      }

      // 2. Check if it's 10 AM in the user's local timezone (§4.1)
      if (localTime.hour() !== 10) {
        continue;
      }

      // 3. Check if next_billing_date is exactly reminder_days away from LOCAL today
      const localToday = localTime.startOf('day');
      const dbDateStr = sub.next_billing_date;
      const targetDate = localToday.add(sub.reminder_days, 'day').format('YYYY-MM-DD');

      if (dbDateStr !== targetDate) {
        continue;
      }

      // 4. Check if we already sent a reminder today
      const localTodayStr = localToday.format('YYYY-MM-DD');
      const lastSentStr = sub.last_reminder_sent_date;

      if (lastSentStr === localTodayStr) {
        continue; // Already processed today
      }

      // 5. ALWAYS create an in-app system notification (Always enabled, records to DB)
      const isIncome = sub.type === 'income';
      const formattedAmount = `$${parseFloat(sub.amount || 0).toFixed(2)}`;
      const title = isIncome ? 'Upcoming Income' : 'Upcoming Renewal Reminder';
      const message = isIncome
        ? `Expected income of ${formattedAmount} for ${sub.name} is due in ${sub.reminder_days} day${sub.reminder_days > 1 ? 's' : ''}.`
        : `Your ${sub.name} subscription payment of ${formattedAmount} is due in ${sub.reminder_days} day${sub.reminder_days > 1 ? 's' : ''}.`;

      await createSystemNotification({
        userId: sub.user_id,
        title,
        message,
        type: isIncome ? 'info' : 'warning',
        linkUrl: `/subscriptions/${sub.id}`,
      });

      // 6. Queue outbound external delivery alerts (Push, Email, SMS) if configured
      const outboundQueued = await queueOutboundAlerts({
        subscriptionId: sub.id,
        userId: sub.user_id,
        userPrefs: {
          global_push_enabled: sub.global_push_enabled,
          global_email_enabled: sub.global_email_enabled,
          global_sms_enabled: sub.global_sms_enabled,
        },
        subPrefs: {
          is_email_enabled: sub.is_email_enabled,
          is_sms_enabled: sub.is_sms_enabled,
        },
      });

      queuedCount += outboundQueued;

      // 7. Update last_reminder_sent_date
      await pool.query(
        `UPDATE subscriptions SET last_reminder_sent_date = ? WHERE id = ?`,
        [localTodayStr, sub.id]
      );
    }

    console.log(`[Queue Seeder] Successfully processed notification jobs (${queuedCount} external alerts queued) for the 10 AM window.`);
  } catch (error) {
    console.error('[Queue Seeder] Error seeding notification queue:', error);
  }
}

module.exports = { seedNotificationQueue };
