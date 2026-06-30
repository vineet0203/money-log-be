const sgMail = require('@sendgrid/mail');

const apiKey = process.env.SENDGRID_API_KEY;
const fromEmail = process.env.SENDGRID_FROM_EMAIL;

if (apiKey) {
  sgMail.setApiKey(apiKey);
} else {
  console.warn('SendGrid API key not configured. Email functionality will be disabled.');
}

/**
 * Sends an email using Twilio SendGrid
 * @param {string} to - The recipient's email address
 * @param {string} subject - The subject line
 * @param {string} text - The plain text body
 * @param {string} html - Optional HTML body
 * @returns {Promise<any>}
 */
const sendEmail = async (to, subject, text, html) => {
  if (!apiKey) {
    console.warn(`SendGrid not configured. Would have sent email to ${to}: ${subject}`);
    return null;
  }

  if (!to || !fromEmail) {
    throw new Error('Recipient email and FROM email are required');
  }

  const msg = {
    to,
    from: fromEmail,
    subject,
    text,
    html: html || text, // Fallback to text if html is not provided
  };

  try {
    const response = await sgMail.send(msg);
    console.log(`Email sent successfully to ${to}`);
    return response;
  } catch (error) {
    console.error(`Failed to send email to ${to}:`, error.message);
    if (error.response) {
      console.error(error.response.body);
    }
    throw error;
  }
};

module.exports = {
  sendEmail,
};
