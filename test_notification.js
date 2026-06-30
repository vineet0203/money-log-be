require('dotenv').config();
const { pool } = require('./src/config/db');
const { sendEmail } = require('./src/utils/sendgrid');
const { sendSMS } = require('./src/utils/twilio');

async function test() {
  try {
    const [users] = await pool.query('SELECT * FROM users LIMIT 1');
    if (users.length === 0) {
      console.log('No users found.');
      process.exit(1);
    }
    const user = users[0];
    console.log(`Found user: ${user.email}, Phone: ${user.phone_number}`);

    // Send a test email
    if (user.email) {
      console.log(`Sending test email to ${user.email}...`);
      try {
        await sendEmail(
          user.email, 
          'Test Notification from Money Log', 
          'This is a test notification.',
          '<h3>Test Notification</h3><p>This is a test notification from Money Log.</p>'
        );
        console.log('Test email sent successfully.');
      } catch (e) {
        console.error('Email failed:', e.message);
      }
    }

    // Send a test SMS
    if (user.phone_number) {
      console.log(`Sending test SMS to ${user.phone_number}...`);
      try {
        await sendSMS(
          user.phone_number,
          'This is a test notification from Money Log.'
        );
        console.log('Test SMS sent successfully.');
      } catch (e) {
        console.error('SMS failed:', e.message);
      }
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    process.exit(0);
  }
}

test();
