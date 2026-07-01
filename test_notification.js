require('dotenv').config();
const { pool } = require('./src/config/db');
const { Expo } = require('expo-server-sdk');

let expo = new Expo();

async function test() {
  try {
    // 1. Find a user that actually has a push token registered AND has at least one active subscription
    const [rows] = await pool.query(`
      SELECT u.id, u.email, u.phone_number, u.name, p.push_token, 
             s.id as sub_id, s.name as sub_name, s.amount as sub_amount, DATE_FORMAT(s.next_billing_date, '%Y-%m-%d') as sub_date
      FROM users u 
      JOIN user_push_tokens p ON u.id = p.user_id 
      JOIN subscriptions s ON u.id = s.user_id
      WHERE s.status = 'active'
      LIMIT 1
    `);

    if (rows.length === 0) {
      console.log('No users found with a registered Push Token AND an active subscription. Please ensure you have added a subscription in the app first.');
      process.exit(1);
    }
    
    const user = rows[0];
    console.log(`Found user: ${user.name || 'Unknown'}, Push Token: ${user.push_token}`);
    console.log(`Found subscription: ${user.sub_name} ($${user.sub_amount}) due on ${user.sub_date}`);

    // Create the exact real message used in production
    const messageText = `Your subscription ${user.sub_name} ($${user.sub_amount}) is due on ${user.sub_date}.`;

    // Send a real Expo Push Notification mimicking the queue_worker
    console.log(`Sending manual test Push Notification to device...`);
    if (Expo.isExpoPushToken(user.push_token)) {
      const messages = [{
        to: user.push_token,
        sound: 'default',
        title: 'Upcoming Subscription Payment',
        body: messageText,
        data: { subscriptionId: user.sub_id },
      }];

      try {
        let chunks = expo.chunkPushNotifications(messages);
        for (let chunk of chunks) {
          let ticketChunk = await expo.sendPushNotificationsAsync(chunk);
          console.log('Push Notification Result:', ticketChunk);
        }
        console.log('Manual test push sent successfully! Check your phone.');
      } catch (e) {
        console.error('Push failed:', e.message);
      }
    } else {
      console.error(`Token ${user.push_token} is not a valid Expo push token`);
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    process.exit(0);
  }
}

test();
