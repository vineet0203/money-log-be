require('dotenv').config();
const { pool } = require('../src/config/db');
const { Expo } = require('expo-server-sdk');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const { sendEmail } = require('../src/utils/sendgrid');
const { sendSMS } = require('../src/utils/twilio');
const { createSystemNotification } = require('../src/services/notificationService');

dayjs.extend(utc);
dayjs.extend(timezone);

const expo = new Expo();

/**
 * Parse CLI arguments.
 * Supports:
 *   node scripts/test_notification.js [userId]
 *   node scripts/test_notification.js --real
 *   node scripts/test_notification.js 1 --real
 *   node scripts/test_notification.js --real --force
 */
function parseCliArgs() {
  const args = process.argv.slice(2);
  let userId = null;
  let isReal = false;
  let isForce = false;
  let isAll = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--real') {
      isReal = true;
    } else if (arg === '--force' || arg === '-f') {
      isForce = true;
    } else if (arg === '--all' || arg === '-a') {
      isAll = true;
    } else if (arg.startsWith('--userId=')) {
      userId = parseInt(arg.split('=')[1], 10);
    } else if ((arg === '--userId' || arg === '--user' || arg === '-u' || arg === '--id') && args[i + 1]) {
      userId = parseInt(args[i + 1], 10);
      i++;
    } else if (/^\d+$/.test(arg)) {
      userId = parseInt(arg, 10);
    }
  }

  return { userId, isReal, isForce, isAll };
}

/**
 * 1. Default Mode: Channel Verification Test Notification
 */
async function notifyUserTest(user) {
  const now = new Date();
  const timestampStr = now.toLocaleString('en-US', {
    timeZone: user.timezone || 'UTC',
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  console.log(`\n------------------------------------------------------------------------`);
  console.log(`[TEST MODE] User #${user.id}: ${user.name || 'Unnamed'} (Phone: ${user.phone_number || 'N/A'}, Email: ${user.email || 'N/A'})`);
  console.log(`Timezone: ${user.timezone || 'UTC'} | Local Time: ${timestampStr}`);
  console.log(`Settings -> Push: ${user.global_push_enabled ? 'ON' : 'OFF'} | Email: ${user.global_email_enabled ? 'ON' : 'OFF'} | SMS: ${user.global_sms_enabled ? 'ON' : 'OFF'}`);
  console.log(`------------------------------------------------------------------------`);

  const results = {
    inApp: false,
    email: 'skipped',
    sms: 'skipped',
    push: 'skipped',
  };

  // 1. System In-App Notification (ALWAYS recorded to database)
  try {
    const notifId = await createSystemNotification({
      userId: user.id,
      title: '🔔 System Test Notification',
      message: `Manual test notification sent on ${timestampStr}. This confirms your in-app notifications and delivery channels are active.`,
      type: 'info',
      linkUrl: '/notifications',
    });
    console.log(`  ✓ [IN-APP]  System notification created (ID: ${notifId})`);
    results.inApp = true;
  } catch (err) {
    console.error(`  ✗ [IN-APP]  Failed to create system notification:`, err.message);
  }

  const notificationBody = `MoneyLog Test: Manual notification sent at ${timestampStr} to verify your alert channels.`;

  // 2. Email Channel
  if (user.global_email_enabled) {
    if (user.email) {
      try {
        console.log(`  ... [EMAIL]  Sending test email to ${user.email}...`);
        const html = `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px; background: #ffffff;">
            <div style="display: flex; align-items: center; margin-bottom: 16px;">
              <h2 style="margin: 0; color: #159A1D; font-size: 20px;">MoneyLog Alert Test</h2>
            </div>
            <p style="font-size: 15px; color: #374151; line-height: 1.5;">Hi ${user.name || 'there'},</p>
            <p style="font-size: 15px; color: #374151; line-height: 1.5;">This is a test notification generated from the admin console to verify that your email delivery channel is functioning correctly.</p>
            <div style="background: #f9fafb; border-left: 4px solid #159A1D; padding: 12px 16px; margin: 20px 0; border-radius: 4px;">
              <p style="margin: 0; font-size: 14px; color: #1f2937;"><strong>Timestamp:</strong> ${timestampStr}</p>
              <p style="margin: 4px 0 0 0; font-size: 14px; color: #1f2937;"><strong>Target:</strong> ${user.email}</p>
            </div>
            <p style="font-size: 13px; color: #6b7280; margin-top: 24px;">If you did not request this test, you can adjust your preferences under Settings &gt; Notification Settings.</p>
          </div>
        `;
        await sendEmail(user.email, '🔔 MoneyLog Test Notification', notificationBody, html);
        console.log(`  ✓ [EMAIL]   Test email sent successfully to ${user.email}`);
        results.email = 'sent';
      } catch (err) {
        console.error(`  ✗ [EMAIL]   Failed to send email to ${user.email}:`, err.message);
        results.email = 'failed';
      }
    } else {
      console.log(`  - [EMAIL]   Skipped (User has email enabled, but no email address is set on profile)`);
      results.email = 'no_email';
    }
  } else {
    console.log(`  - [EMAIL]   Skipped (Disabled in user notification settings)`);
    results.email = 'disabled';
  }

  // 3. SMS Channel
  if (user.global_sms_enabled) {
    if (user.phone_number) {
      try {
        console.log(`  ... [SMS]    Sending test SMS to ${user.phone_number}...`);
        await sendSMS(user.phone_number, `[MoneyLog Test] ${notificationBody}`);
        console.log(`  ✓ [SMS]     Test SMS sent successfully to ${user.phone_number}`);
        results.sms = 'sent';
      } catch (err) {
        console.error(`  ✗ [SMS]     Failed to send SMS to ${user.phone_number}:`, err.message);
        results.sms = 'failed';
      }
    } else {
      console.log(`  - [SMS]     Skipped (User has SMS enabled, but no phone number on profile)`);
      results.sms = 'no_phone';
    }
  } else {
    console.log(`  - [SMS]     Skipped (Disabled in user notification settings)`);
    results.sms = 'disabled';
  }

  // 4. Push Channel
  if (user.global_push_enabled) {
    try {
      const [tokens] = await pool.query(
        'SELECT push_token FROM user_push_tokens WHERE user_id = ?',
        [user.id]
      );

      const validTokens = tokens
        .map((t) => t.push_token)
        .filter((token) => Expo.isExpoPushToken(token));

      if (validTokens.length > 0) {
        console.log(`  ... [PUSH]   Sending push notification to ${validTokens.length} device(s)...`);
        const messages = validTokens.map((to) => ({
          to,
          sound: 'default',
          title: '🔔 MoneyLog Test Notification',
          body: notificationBody,
          data: { type: 'test', userId: user.id },
        }));

        const chunks = expo.chunkPushNotifications(messages);
        for (const chunk of chunks) {
          await expo.sendPushNotificationsAsync(chunk);
        }
        console.log(`  ✓ [PUSH]    Push notification dispatched to ${validTokens.length} device(s)`);
        results.push = 'sent';
      } else {
        console.log(`  - [PUSH]    Skipped (Push is enabled, but user has no active Expo push tokens registered)`);
        results.push = 'no_tokens';
      }
    } catch (err) {
      console.error(`  ✗ [PUSH]    Failed to send push notification:`, err.message);
      results.push = 'failed';
    }
  } else {
    console.log(`  - [PUSH]    Skipped (Disabled in user notification settings)`);
    results.push = 'disabled';
  }

  return results;
}

/**
 * 2. Real Data Mode (--real):
 * Dispatches real subscription reminders without the 10 AM time guard.
 * Allows manual re-triggering if a scheduled alert was missed or failed.
 */
async function notifyUserReal(user, options = {}) {
  const userTz = user.timezone || 'UTC';
  const nowUtc = dayjs.utc();
  let localTime;
  try {
    localTime = nowUtc.tz(userTz);
  } catch (_) {
    localTime = nowUtc.tz('UTC');
  }

  const localToday = localTime.startOf('day');
  const localTodayStr = localToday.format('YYYY-MM-DD');

  console.log(`\n------------------------------------------------------------------------`);
  console.log(`[REAL REMINDER MODE] User #${user.id}: ${user.name || 'Unnamed'}`);
  console.log(`Phone: ${user.phone_number || 'N/A'} | Email: ${user.email || 'N/A'}`);
  console.log(`Timezone: ${userTz} | Local Date: ${localTodayStr} (10 AM guard bypassed)`);
  console.log(`Settings -> Push: ${user.global_push_enabled ? 'ON' : 'OFF'} | Email: ${user.global_email_enabled ? 'ON' : 'OFF'} | SMS: ${user.global_sms_enabled ? 'ON' : 'OFF'}`);
  console.log(`------------------------------------------------------------------------`);

  // Fetch active subscriptions with reminders enabled for this user
  const [subscriptions] = await pool.query(
    `SELECT s.*, DATE_FORMAT(s.next_billing_date, '%Y-%m-%d') as billing_date_str,
            DATE_FORMAT(s.last_reminder_sent_date, '%Y-%m-%d') as last_sent_str
     FROM subscriptions s
     WHERE s.user_id = ?
       AND s.status = 'active'
       AND s.is_reminder_on = 1
     ORDER BY s.next_billing_date ASC`,
    [user.id]
  );

  if (subscriptions.length === 0) {
    console.log(`  ℹ️  No active subscriptions with reminders enabled for User #${user.id}.`);
    console.log(`     (Ensure subscription status is 'active' and is_reminder_on is enabled in the app).`);
    return { evaluated: 0, sent: 0, skipped: 0 };
  }

  console.log(`  Found ${subscriptions.length} active subscription(s) with reminders on file.`);

  let sentCount = 0;
  let skippedCount = 0;

  for (const sub of subscriptions) {
    const billingDate = dayjs.tz(sub.billing_date_str, userTz).startOf('day');
    const diffDays = billingDate.diff(localToday, 'day');
    const reminderDays = sub.reminder_days ?? 3;

    // Eligibility check:
    // 1. Matches exact reminder days (diffDays === reminderDays)
    // 2. OR is due soon/today and was missed (0 <= diffDays <= reminderDays)
    // 3. OR options.isAll / options.isForce was specified
    const isDueForReminder =
      options.isAll ||
      diffDays === reminderDays ||
      (diffDays >= 0 && diffDays <= reminderDays);

    console.log(`\n  ▸ Subscription #${sub.id}: "${sub.name}" ($${sub.amount})`);
    console.log(`    Next Due: ${sub.billing_date_str} (${diffDays} days away) | Reminder set to: ${reminderDays} days prior`);
    console.log(`    Last Sent: ${sub.last_sent_str || 'Never'}`);

    if (!isDueForReminder && !options.isForce) {
      console.log(`    - [SKIPPED] Not due for reminder today (${diffDays} days remaining vs ${reminderDays} days configured). Pass --force to override.`);
      skippedCount++;
      continue;
    }

    // Guard: already sent today?
    if (sub.last_sent_str === localTodayStr && !options.isForce) {
      console.log(`    - [SKIPPED] Reminder for today already recorded on ${sub.last_sent_str}. Pass --force to re-send.`);
      skippedCount++;
      continue;
    }

    const isIncome = sub.type === 'income';
    const verb = isIncome ? 'expected income' : 'subscription';
    const action = isIncome ? 'expected' : 'due';
    const formattedAmount = `$${parseFloat(sub.amount || 0).toFixed(2)}`;

    let dueText = '';
    if (diffDays === 0) {
      dueText = 'is due TODAY';
    } else if (diffDays === 1) {
      dueText = 'is due TOMORROW';
    } else if (diffDays > 1) {
      dueText = `is due in ${diffDays} days on ${sub.billing_date_str}`;
    } else {
      dueText = `was due on ${sub.billing_date_str} (${Math.abs(diffDays)} day(s) overdue)`;
    }

    const title = isIncome ? '💰 Upcoming Income' : 'Upcoming Renewal Reminder';
    const message = isIncome
      ? `Expected income of ${formattedAmount} for ${sub.name} ${dueText}.`
      : `Your ${sub.name} subscription payment of ${formattedAmount} ${dueText}.`;

    // 1. ALWAYS create in-app system notification
    try {
      const notifId = await createSystemNotification({
        userId: user.id,
        title,
        message,
        type: isIncome ? 'info' : 'warning',
        linkUrl: `/subscriptions`,
      });
      console.log(`    ✓ [IN-APP]  System notification created (ID: ${notifId})`);
    } catch (err) {
      console.error(`    ✗ [IN-APP]  Failed to create system notification:`, err.message);
    }

    // 2. Email channel (checks global + subscription level setting)
    const emailEnabled = user.global_email_enabled && (sub.is_email_enabled ?? 1);
    if (emailEnabled) {
      if (user.email) {
        try {
          const htmlContent = `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px; background: #ffffff;">
              <h2 style="color: #159A1D; margin: 0 0 16px 0;">Upcoming ${isIncome ? 'Income' : 'Payment'} Reminder</h2>
              <p style="font-size: 15px; color: #374151; margin-bottom: 20px;">Hi ${user.name || 'there'}, this is a reminder for your upcoming ${verb}:</p>
              <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;">
                <p style="margin: 0 0 8px 0; font-size: 16px; color: #0f172a;"><strong>${sub.name}</strong></p>
                <p style="margin: 0 0 4px 0; font-size: 15px; color: #334155;"><strong>${isIncome ? 'Amount Expected' : 'Amount Due'}:</strong> ${formattedAmount}</p>
                <p style="margin: 0; font-size: 15px; color: #334155;"><strong>Due Date:</strong> ${sub.billing_date_str} (${dueText})</p>
              </div>
              <p style="font-size: 13px; color: #64748b; margin-top: 24px;">Manage your reminder preferences anytime under Settings &gt; Notification Settings.</p>
            </div>
          `;
          await sendEmail(user.email, `Upcoming ${isIncome ? 'Income' : 'Payment'}: ${sub.name}`, message, htmlContent);
          console.log(`    ✓ [EMAIL]   Reminder email sent to ${user.email}`);
        } catch (e) {
          console.error(`    ✗ [EMAIL]   Failed to send email to ${user.email}:`, e.message);
        }
      } else {
        console.log(`    - [EMAIL]   Skipped (User has no email address on profile)`);
      }
    } else {
      console.log(`    - [EMAIL]   Skipped (Email disabled globally or on subscription)`);
    }

    // 3. SMS channel (requires global AND subscription opt-in)
    const smsEnabled = user.global_sms_enabled && sub.is_sms_enabled;
    if (smsEnabled) {
      if (user.phone_number) {
        try {
          await sendSMS(user.phone_number, `[MoneyLog Reminder] ${message}`);
          console.log(`    ✓ [SMS]     Reminder SMS sent to ${user.phone_number}`);
        } catch (e) {
          console.error(`    ✗ [SMS]     Failed to send SMS to ${user.phone_number}:`, e.message);
        }
      } else {
        console.log(`    - [SMS]     Skipped (User has no phone number on profile)`);
      }
    } else {
      console.log(`    - [SMS]     Skipped (SMS disabled globally or on subscription)`);
    }

    // 4. Push channel (requires global AND subscription opt-in)
    const pushEnabled = user.global_push_enabled && (sub.is_push_enabled ?? 1);
    if (pushEnabled) {
      try {
        const [tokens] = await pool.query('SELECT push_token FROM user_push_tokens WHERE user_id = ?', [user.id]);
        const validTokens = tokens
          .map((t) => t.push_token)
          .filter((t) => Expo.isExpoPushToken(t));

        if (validTokens.length > 0) {
          const messages = validTokens.map((to) => ({
            to,
            sound: 'default',
            title,
            body: message,
            data: { subscriptionId: sub.id, type: 'subscription_reminder' },
          }));
          const chunks = expo.chunkPushNotifications(messages);
          for (const chunk of chunks) {
            await expo.sendPushNotificationsAsync(chunk);
          }
          console.log(`    ✓ [PUSH]    Push notification dispatched to ${validTokens.length} device(s)`);
        } else {
          console.log(`    - [PUSH]    Skipped (No active Expo push tokens registered)`);
        }
      } catch (e) {
        console.error(`    ✗ [PUSH]    Failed to send push:`, e.message);
      }
    } else {
      console.log(`    - [PUSH]    Skipped (Push notifications disabled)`);
    }

    // 5. Update last_reminder_sent_date on the subscription
    await pool.query(
      'UPDATE subscriptions SET last_reminder_sent_date = ? WHERE id = ?',
      [localTodayStr, sub.id]
    );
    console.log(`    ✓ [STATE]   Updated subscription last_reminder_sent_date to ${localTodayStr}`);

    sentCount++;
  }

  return { evaluated: subscriptions.length, sent: sentCount, skipped: skippedCount };
}

async function run() {
  const { userId, isReal, isForce, isAll } = parseCliArgs();

  console.log(`\n========================================================`);
  console.log(`🔔 MoneyLog Notification Manager`);
  console.log(`Mode: ${isReal ? 'REAL REMINDERS (Database Subscriptions)' : 'TEST (Channel Verification)'}`);
  if (isReal) {
    console.log(`Guard: 10 AM time restriction BYPASSED`);
    if (isForce) console.log(`Flags: --force (Re-sending even if already recorded today)`);
    if (isAll) console.log(`Flags: --all (Evaluating all subscriptions regardless of days)`);
  }
  console.log(`========================================================`);

  try {
    let users = [];

    if (userId) {
      const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [userId]);
      if (rows.length === 0) {
        console.error(`\n❌ Error: User with ID ${userId} was not found in database.`);
        process.exit(1);
      }
      users = rows;
      console.log(`Targeting single user ID: ${userId} (${users[0].name || users[0].phone_number})`);
    } else {
      const [rows] = await pool.query('SELECT * FROM users ORDER BY id ASC');
      if (rows.length === 0) {
        console.log(`\n⚠️  Notice: No users found in database.`);
        console.log(`   Register a user through /login to test notifications.`);
        process.exit(0);
      }
      users = rows;
      console.log(`Found ${users.length} registered user(s). Processing...`);
    }

    if (isReal) {
      // Real Data Subscription Reminders
      let totalEvaluated = 0;
      let totalSent = 0;
      let totalSkipped = 0;

      for (const user of users) {
        const stats = await notifyUserReal(user, { isForce, isAll });
        totalEvaluated += stats.evaluated;
        totalSent += stats.sent;
        totalSkipped += stats.skipped;
      }

      console.log(`\n========================================================`);
      console.log(`🏁 Real Reminder Run Complete!`);
      console.log(`   Users Evaluated:                 ${users.length}`);
      console.log(`   Subscriptions Evaluated:         ${totalEvaluated}`);
      console.log(`   Reminders Dispatched:            ${totalSent}`);
      console.log(`   Subscriptions Skipped / Not Due: ${totalSkipped}`);
      console.log(`========================================================\n`);

    } else {
      // Test Notification
      const summary = {
        users: users.length,
        inAppCreated: 0,
        emailSent: 0,
        smsSent: 0,
        pushSent: 0,
      };

      for (const user of users) {
        const res = await notifyUserTest(user);
        if (res.inApp) summary.inAppCreated++;
        if (res.email === 'sent') summary.emailSent++;
        if (res.sms === 'sent') summary.smsSent++;
        if (res.push === 'sent') summary.pushSent++;
      }

      console.log(`\n========================================================`);
      console.log(`🏁 Test Run Complete!`);
      console.log(`   Users Evaluated:         ${summary.users}`);
      console.log(`   In-App System Alerts:    ${summary.inAppCreated} created`);
      console.log(`   Emails:                  ${summary.emailSent} sent`);
      console.log(`   SMS:                     ${summary.smsSent} sent`);
      console.log(`   Push Notifications:      ${summary.pushSent} sent`);
      console.log(`========================================================\n`);
    }

  } catch (error) {
    console.error(`\n❌ Critical error running notifications:`, error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

if (require.main === module) {
  run();
}

module.exports = { run, notifyUserTest, notifyUserReal };
