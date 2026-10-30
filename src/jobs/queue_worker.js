const { pool } = require('../config/db');
const { Expo } = require('expo-server-sdk');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const { sendSMS } = require('../services/smsService');
const { sendNotificationAlertEmail } = require('../services/emailService');

dayjs.extend(utc);
dayjs.extend(timezone);

let expo = new Expo();

async function processNotificationQueue() {
  console.log('[Queue Worker] Checking for pending notifications...');

  try {
    // 1. Fetch up to 500 pending notifications
    const [jobs] = await pool.query(`
      SELECT n.*, u.email, u.phone_number, u.timezone, 
             s.name as subscription_name, s.amount, s.next_billing_date, s.status as sub_status, s.reminder_days, s.type as sub_type
      FROM notification_queue n
      JOIN users u ON n.user_id = u.id
      JOIN subscriptions s ON n.subscription_id = s.id
      WHERE n.status = 'pending'
      LIMIT 500
    `);

    if (jobs.length === 0) {
      return;
    }

    console.log(`[Queue Worker] Processing chunk of ${jobs.length} notifications...`);

    // 2. Lock them
    const jobIds = jobs.map(j => j.id);
    await pool.query(
      `UPDATE notification_queue SET status = 'processing' WHERE id IN (?)`,
      [jobIds]
    );

    let expoMessages = [];
    let jobMap = new Map();

    const nowUtc = dayjs.utc();

    for (const job of jobs) {
      // 3. JIT Validation: Has the user paid since this was queued?
      // If paid, next_billing_date is pushed to the future.
      const userTz = job.timezone || 'UTC';
      let localTime;
      try {
        localTime = nowUtc.tz(userTz);
      } catch(e) {
        localTime = nowUtc.tz('UTC');
      }

      const localToday = localTime.startOf('day');
      const dbDateStr = job.next_billing_date;

      const expectedDateStr = localToday.add(job.reminder_days, 'day').format('YYYY-MM-DD');

      // If subscription is inactive or the billing date no longer matches what we expect today,
      // it means they paid it or cancelled it. Cancel the notification!
      if (job.sub_status !== 'active' || dbDateStr !== expectedDateStr) {
        console.log(`[Queue Worker] Cancelling job ${job.id} - Subscription ${job.subscription_id} is no longer due (User likely paid/cancelled).`);
        await markJobStatus(job.id, 'failed'); // or 'cancelled' if we add to enum
        continue;
      }

      // If occurrence on this date is skipped or paid, cancel the job
      const [occCheck] = await pool.query(
        `SELECT id, status FROM recurring_occurrences 
         WHERE recurring_id = ? AND due_date = ?`,
        [job.subscription_id, dbDateStr]
      );
      if (occCheck.length > 0 && (occCheck[0].status === 'skipped' || occCheck[0].status === 'paid')) {
        console.log(`[Queue Worker] Cancelling job ${job.id} - Occurrence on ${dbDateStr} is ${occCheck[0].status}.`);
        await markJobStatus(job.id, 'failed');
        continue;
      }

      const isIncome = job.sub_type === 'income';
      const verb = isIncome ? 'expected income' : 'subscription';
      const action = isIncome ? 'expected' : 'due';
      const messageText = `Your ${verb} ${job.subscription_name} (${job.amount}) is ${action} on ${dbDateStr}.`;
      
      try {
        if (job.type === 'email') {
          if (!job.email) {
            console.error(`[Queue Worker] Skipping email for user ${job.user_id} - No email address on file`);
            await markJobStatus(job.id, 'failed');
            continue;
          }
          
          console.log(`[Queue Worker] Attempting to send Email to ${job.email}`);
          await sendNotificationAlertEmail({
            to: job.email,
            title: isIncome ? 'Upcoming Income Reminder' : 'Upcoming Payment Reminder',
            itemName: job.subscription_name,
            amount: job.amount,
            dueDate: dbDateStr,
            alertType: isIncome ? 'income' : 'expense',
          });
          await markJobStatus(job.id, 'sent');
        } 
        else if (job.type === 'sms') {
          if (!job.phone_number) {
            console.error(`[Queue Worker] Skipping SMS for user ${job.user_id} - No phone number on file`);
            await markJobStatus(job.id, 'failed');
            continue;
          }
          
          console.log(`[Queue Worker] Attempting to send SMS to ${job.phone_number}`);
          await sendSMS(job.phone_number, messageText);
          await markJobStatus(job.id, 'sent');
        } 
        else if (job.type === 'push') {
          const [tokens] = await pool.query('SELECT push_token FROM user_push_tokens WHERE user_id = ?', [job.user_id]);

          if (tokens.length === 0) {
            console.log(`[Queue Worker] No push tokens found for user ${job.user_id} - Skipping remote push`);
            await markJobStatus(job.id, 'failed');
            continue;
          }

          let hasValidToken = false;
          for (const t of tokens) {
            if (Expo.isExpoPushToken(t.push_token)) {
              hasValidToken = true;
              const messageObj = {
                to: t.push_token,
                sound: 'default',
                title: isIncome ? 'Upcoming Income' : 'Upcoming Subscription Payment',
                body: messageText,
                data: { subscriptionId: job.subscription_id },
              };
              expoMessages.push(messageObj);
              jobMap.set(messageObj, { jobId: job.id, userId: job.user_id, title: messageObj.title, body: messageObj.body });
            } else {
              console.error(`[Queue Worker] Invalid push token "${t.push_token}" for user ${job.user_id}`);
            }
          }

          if (!hasValidToken) {
            await markJobStatus(job.id, 'failed');
          }
        }
      } catch (err) {
        console.error(`[Queue Worker] Error processing job ${job.id}:`, err);
        await markJobStatus(job.id, 'failed');
      }
    }

    if (expoMessages.length > 0) {
      let chunks = expo.chunkPushNotifications(expoMessages);
      for (let chunk of chunks) {
        try {
          let ticketChunk = await expo.sendPushNotificationsAsync(chunk);
          for (let i = 0; i < ticketChunk.length; i++) {
            const ticket = ticketChunk[i];
            const message = chunk[i];
            const jobData = jobMap.get(message);
            
            if (ticket.status === 'ok') {
              await markJobStatus(jobData.jobId, 'sent');
            } else {
              console.error(`[Queue Worker] Error sending push: ${ticket.details?.error}`);
              await markJobStatus(jobData.jobId, 'failed');
            }
          }
        } catch (error) {
          console.error('[Queue Worker] Error in Expo chunk sending:', error);
          for (const msg of chunk) {
            await markJobStatus(jobMap.get(msg).jobId, 'failed');
          }
        }
      }
    }

    console.log(`[Queue Worker] Finished processing chunk.`);

  } catch (error) {
    console.error('[Queue Worker] Critical error:', error);
  }
}

async function markJobStatus(jobId, status) {
  await pool.query('UPDATE notification_queue SET status = ? WHERE id = ?', [status, jobId]);
}

module.exports = { processNotificationQueue };
