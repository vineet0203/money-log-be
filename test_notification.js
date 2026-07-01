require('dotenv').config();
const { pool } = require('./src/config/db');
const { Expo } = require('expo-server-sdk');
const { sendEmail } = require('./src/utils/sendgrid');
const { sendSMS } = require('./src/utils/twilio');

let expo = new Expo();

async function test() {
  try {
    // 1. Find a user that actually has an active subscription
    // We join user_push_tokens separately to handle users who might only have email/sms enabled
    const [rows] = await pool.query(`
      SELECT u.id, u.email, u.phone_number, u.name, 
             u.global_push_enabled, u.global_email_enabled, u.global_sms_enabled,
             s.id as sub_id, s.name as sub_name, s.amount as sub_amount, DATE_FORMAT(s.next_billing_date, '%Y-%m-%d') as sub_date,
             s.is_email_enabled, s.is_sms_enabled
      FROM users u 
      JOIN subscriptions s ON u.id = s.user_id
      WHERE s.status = 'active'
      LIMIT 1
    `);

    if (rows.length === 0) {
      console.log('No users found with an active subscription. Please ensure you have added a subscription in the app first.');
      process.exit(1);
    }
    
    const user = rows[0];
    
    // Fetch push tokens for this user
    const [tokens] = await pool.query('SELECT push_token FROM user_push_tokens WHERE user_id = ?', [user.id]);
    const pushToken = tokens.length > 0 ? tokens[0].push_token : null;

    console.log(`Found user: ${user.name || 'Unknown'}, Phone: ${user.phone_number}, Email: ${user.email}`);
    console.log(`Found subscription: ${user.sub_name} ($${user.sub_amount}) due on ${user.sub_date}`);
    console.log(`User Preferences -> Push: ${user.global_push_enabled}, Email: ${user.global_email_enabled}, SMS: ${user.global_sms_enabled}`);
    console.log(`Subscription Preferences -> Email: ${user.is_email_enabled}, SMS: ${user.is_sms_enabled}`);

    // Create the exact real message used in production
    const messageText = `Your subscription ${user.sub_name} ($${user.sub_amount}) is due on ${user.sub_date}.`;

    // 1. Send Expo Push Notification (if globally enabled)
    if (user.global_push_enabled) {
      if (pushToken && Expo.isExpoPushToken(pushToken)) {
        console.log(`\n[PUSH] Sending manual test Push Notification to ${pushToken}...`);
        const messages = [{
          to: pushToken,
          sound: 'default',
          title: 'Upcoming Subscription Payment',
          body: messageText,
          data: { subscriptionId: user.sub_id },
        }];

        try {
          let chunks = expo.chunkPushNotifications(messages);
          for (let chunk of chunks) {
            let ticketChunk = await expo.sendPushNotificationsAsync(chunk);
            console.log('Push Result:', ticketChunk);
          }
          console.log('[PUSH] Test push sent successfully!');
        } catch (e) {
          console.error('[PUSH] Failed:', e.message);
        }
      } else {
        console.log(`\n[PUSH] Skipped: User has Push enabled, but no valid Expo push token was found.`);
      }
    } else {
      console.log(`\n[PUSH] Skipped: User has global push notifications disabled.`);
    }

    // 2. Send Email Notification (if globally enabled AND enabled on the subscription)
    if (user.global_email_enabled && user.is_email_enabled) {
      if (user.email) {
        console.log(`\n[EMAIL] Sending test Email to ${user.email}...`);
        try {
          await sendEmail(
            user.email,
            `Upcoming Subscription Payment: ${user.sub_name}`,
            messageText,
            `<h3>MoneyLog Reminder</h3><p>${messageText}</p>`
          );
          console.log('[EMAIL] Test email sent successfully!');
        } catch (e) {
          console.error('[EMAIL] Failed:', e.message);
        }
      } else {
        console.log(`\n[EMAIL] Skipped: User has Email enabled, but no email address on file.`);
      }
    } else {
      console.log(`\n[EMAIL] Skipped: Email notifications are disabled (either globally or for this subscription).`);
    }

    // 3. Send SMS Notification (if globally enabled AND enabled on the subscription)
    if (user.global_sms_enabled && user.is_sms_enabled) {
      if (user.phone_number) {
        console.log(`\n[SMS] Sending test SMS to ${user.phone_number}...`);
        try {
          await sendSMS(
            user.phone_number,
            `MoneyLog Reminder: ${messageText}`
          );
          console.log('[SMS] Test SMS sent successfully!');
        } catch (e) {
          console.error('[SMS] Failed:', e.message);
        }
      } else {
        console.log(`\n[SMS] Skipped: User has SMS enabled, but no phone number on file.`);
      }
    } else {
      console.log(`\n[SMS] Skipped: SMS notifications are disabled (either globally or for this subscription).`);
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    process.exit(0);
  }
}

test();
