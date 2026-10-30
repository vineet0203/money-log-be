const nodemailer = require('nodemailer');
const {
  renderVerifyEmail,
  renderForgotPassword,
  renderNotificationAlert,
  renderPasswordChangedAlert,
  renderWelcomeEmail,
} = require('../templates/emails');

// Rackspace Email Standard Settings:
// Host: secure.emailsrvr.com
// Port: 465 (SSL/TLS - recommended) or 587 (STARTTLS)
const smtpHost = process.env.SMTP_HOST || 'secure.emailsrvr.com';
const smtpPort = parseInt(process.env.SMTP_PORT || '465', 10);
const smtpSecure =
  process.env.SMTP_SECURE !== undefined
    ? process.env.SMTP_SECURE === 'true'
    : smtpPort === 465;

const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;
// Rackspace requires the FROM address to match or be an alias of the authenticated mailbox
const defaultFrom = process.env.EMAIL_FROM || (smtpUser ? `Money Log <${smtpUser}>` : 'Money Log <no-reply@moneylog.com>');

let transporter = null;

if (smtpHost && smtpUser && smtpPass) {
  transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
    tls: {
      rejectUnauthorized: true,
    },
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
  });

  // Verify connection configuration asynchronously
  transporter.verify((error) => {
    if (error) {
      console.warn('[Rackspace Email] SMTP connection verification failed:', error.message);
    } else {
      console.log(`[Rackspace Email] Connected to ${smtpHost}:${smtpPort} (Secure: ${smtpSecure}) - ready`);
    }
  });
} else {
  console.warn('[Rackspace Email] SMTP credentials (SMTP_USER / SMTP_PASS) not configured. Outbound emails will be simulated.');
}

/**
 * Universal email sender. Supports both (to, subject, text, html) and ({ to, subject, text, html, from })
 */
async function sendEmail(toOrOptions, subject, text, html) {
  let to, sub, txt, htm, from;

  if (typeof toOrOptions === 'object' && toOrOptions !== null) {
    to = toOrOptions.to;
    sub = toOrOptions.subject;
    txt = toOrOptions.text;
    htm = toOrOptions.html;
    from = toOrOptions.from || defaultFrom;
  } else {
    to = toOrOptions;
    sub = subject;
    txt = text;
    htm = html;
    from = defaultFrom;
  }

  if (!to) {
    throw new Error('[Email Service] Recipient email is required');
  }

  if (!transporter) {
    console.warn(`[Email Service Simulated] To: ${to} | Subject: "${sub}"`);
    return { simulated: true, to, subject: sub };
  }

  const mailOptions = {
    from,
    to,
    subject: sub,
    text: txt || '',
    html: htm || txt || '',
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`[Email Service] Email sent to ${to} (Message ID: ${info.messageId})`);
    return info;
  } catch (error) {
    console.error(`[Email Service] Failed to send email to ${to}:`, error.message);
    throw error;
  }
}

/**
 * Sends Email Verification with 6-digit OTP code
 */
async function sendVerificationEmail({ to, name, code, expiresInMinutes = 10 }) {
  const template = renderVerifyEmail({ name, code, expiresInMinutes });
  return sendEmail(to, template.subject, template.text, template.html);
}

/**
 * Sends Password Reset Request Email
 */
async function sendPasswordResetEmail({ to, name, resetUrl, code, expiresInMinutes = 15 }) {
  const template = renderForgotPassword({ name, resetUrl, code, expiresInMinutes });
  return sendEmail(to, template.subject, template.text, template.html);
}

/**
 * Sends Notification Alert Email (Subscription / Bills / Budget / Expected Income)
 */
async function sendNotificationAlertEmail({
  to,
  name,
  title,
  itemName,
  amount,
  dueDate,
  alertType,
  description,
  ctaUrl,
  ctaText,
}) {
  const template = renderNotificationAlert({
    name,
    title,
    itemName,
    amount,
    dueDate,
    alertType,
    description,
    ctaUrl,
    ctaText,
  });
  return sendEmail(to, template.subject, template.text, template.html);
}

/**
 * Sends Password Changed Security Alert Email
 */
async function sendPasswordChangedAlert({ to, name, ipAddress, userAgent, timestamp }) {
  const template = renderPasswordChangedAlert({ name, ipAddress, userAgent, timestamp });
  return sendEmail(to, template.subject, template.text, template.html);
}

/**
 * Sends Welcome Onboarding Email
 */
async function sendWelcomeEmail({ to, name, loginUrl }) {
  const template = renderWelcomeEmail({ name, email: to, loginUrl });
  return sendEmail(to, template.subject, template.text, template.html);
}

module.exports = {
  sendEmail,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendNotificationAlertEmail,
  sendPasswordChangedAlert,
  sendWelcomeEmail,
};
