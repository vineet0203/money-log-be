const twilio = require('twilio');

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromPhone = process.env.TWILIO_PHONE_NUMBER;

let client;

if (accountSid && authToken) {
  client = twilio(accountSid, authToken);
} else {
  console.warn('Twilio credentials not fully configured. SMS functionality will be disabled.');
}

/**
 * Sends an SMS message using Twilio
 * @param {string} to - The recipient's phone number
 * @param {string} body - The text content of the message
 * @returns {Promise<any>}
 */
const sendSMS = async (to, body) => {
  if (!client) {
    console.warn(`Twilio not configured. Would have sent SMS to ${to}: ${body}`);
    return null;
  }

  if (!to) {
    throw new Error('Recipient phone number is required');
  }

  try {
    const message = await client.messages.create({
      body,
      from: fromPhone,
      to,
    });
    console.log(`SMS sent successfully to ${to}, SID: ${message.sid}`);
    return message;
  } catch (error) {
    console.error(`Failed to send SMS to ${to}:`, error.message);
    throw error;
  }
};

module.exports = {
  sendSMS,
};
