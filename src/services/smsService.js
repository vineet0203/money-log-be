const twilio = require('twilio');

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromPhone = process.env.TWILIO_PHONE_NUMBER;
const verifyServiceSid = process.env.TWILIO_VERIFY_SERVICE_SID;

let client = null;

if (accountSid && authToken) {
  client = twilio(accountSid, authToken);
} else {
  console.warn('[Twilio SMS Service] Credentials not fully configured. SMS functionality will be disabled or simulated.');
}

/**
 * Sends an SMS message using Twilio
 * @param {string} to - The recipient's phone number
 * @param {string} body - The text content of the message
 * @returns {Promise<any>}
 */
const sendSMS = async (to, body) => {
  if (!client) {
    console.warn(`[Twilio SMS Simulated] To: ${to} | Message: "${body}"`);
    return { simulated: true, to, body };
  }

  if (!to) {
    throw new Error('[SMS Service] Recipient phone number is required');
  }

  try {
    const message = await client.messages.create({
      body,
      from: fromPhone,
      to,
    });
    console.log(`[SMS Service] SMS sent successfully to ${to}, SID: ${message.sid}`);
    return message;
  } catch (error) {
    console.error(`[SMS Service] Failed to send SMS to ${to}:`, error.message);
    throw error;
  }
};

/**
 * Sends a verification OTP code via Twilio Verify Service (Legacy phone OTP)
 * @param {string} phone - Target phone number
 * @returns {Promise<{ status: string, sid?: string, simulated?: boolean }>}
 */
const sendPhoneVerificationOtp = async (phone) => {
  if (process.env.NODE_ENV === 'development' || !client || !verifyServiceSid) {
    console.log(`[Twilio SMS Simulated] OTP sent to ${phone}`);
    return { status: 'pending', simulated: true };
  }

  const verification = await client.verify.v2
    .services(verifyServiceSid)
    .verifications.create({
      to: phone,
      channel: 'sms',
    });

  return verification;
};

/**
 * Checks a verification OTP code via Twilio Verify Service (Legacy phone OTP)
 * @param {string} phone - Target phone number
 * @param {string} code - 6-digit OTP code
 * @returns {Promise<boolean>}
 */
const verifyPhoneOtpCode = async (phone, code) => {
  if (process.env.NODE_ENV === 'development' || !client || !verifyServiceSid) {
    return code === '123456';
  }

  const check = await client.verify.v2
    .services(verifyServiceSid)
    .verificationChecks.create({ to: phone, code });

  return check.status === 'approved';
};

module.exports = {
  client,
  twilioClient: client,
  TWILIO_SERVICE_SID: verifyServiceSid,
  sendSMS,
  sendPhoneVerificationOtp,
  verifyPhoneOtpCode,
};
