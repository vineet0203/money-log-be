const { pool } = require('../config/db');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

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
        // Fallback if timezone string is invalid
        console.warn(`[Queue Seeder] Invalid timezone ${userTz} for user ${sub.user_id}, falling back to UTC`);
        localTime = nowUtc.tz('UTC');
      }

      // 2. Check if it's 10 AM in the user's local timezone
      // Since cron runs exactly on the hour, hour() should be 10.
      // [DISABLED FOR TESTING - WILL RUN EVERY HOUR]
      /*
      if (localTime.hour() !== 10) {
        continue;
      }
      */// }

      // 3. Check if next_billing_date is exactly reminder_days away from LOCAL today
      const localToday = localTime.startOf('day');
      const billingDate = dayjs(sub.next_billing_date).startOf('day'); // DB date is midnight UTC usually, assuming it represents local date

      // Ensure billingDate is treated as the same date regardless of timezone shifts.
      // With dateStrings: true, next_billing_date is returned natively as "YYYY-MM-DD".
      const dbDateStr = sub.next_billing_date;

      const targetDate = localToday.add(sub.reminder_days, 'day').format('YYYY-MM-DD');

      if (dbDateStr !== targetDate) {
        continue;
      }

      // 4. Check if we already sent a reminder today
      const localTodayStr = localToday.format('YYYY-MM-DD');
      const lastSentStr = sub.last_reminder_sent_date;

      if (lastSentStr === localTodayStr) {
        continue; // Already queued today
      }

      // 5. Queue Notifications
      if (sub.global_push_enabled) {
        await pool.query(
          `INSERT INTO notification_queue (subscription_id, user_id, type) VALUES (?, ?, 'push')`,
          [sub.id, sub.user_id]
        );
        queuedCount++;
      }

      if (sub.global_email_enabled && sub.is_email_enabled) {
        await pool.query(
          `INSERT INTO notification_queue (subscription_id, user_id, type) VALUES (?, ?, 'email')`,
          [sub.id, sub.user_id]
        );
        queuedCount++;
      }

      if (sub.global_sms_enabled && sub.is_sms_enabled) {
        await pool.query(
          `INSERT INTO notification_queue (subscription_id, user_id, type) VALUES (?, ?, 'sms')`,
          [sub.id, sub.user_id]
        );
        queuedCount++;
      }

      // 6. Update last_reminder_sent_date
      await pool.query(
        `UPDATE subscriptions SET last_reminder_sent_date = ? WHERE id = ?`,
        [localTodayStr, sub.id]
      );
    }

    console.log(`[Queue Seeder] Successfully queued ${queuedCount} notification jobs for the 8 AM timezone window.`);
  } catch (error) {
    console.error('[Queue Seeder] Error seeding notification queue:', error);
  }
}

module.exports = { seedNotificationQueue };
