const { renderBaseLayout } = require('./baseLayout');

/**
 * Renders Email Verification template with 6-digit OTP code (Web Theme Light Mode)
 *
 * @param {object} params
 * @param {string} [params.name]
 * @param {string} params.code - 6-digit numeric OTP
 * @param {number} [params.expiresInMinutes=10]
 */
function renderVerifyEmail({ name, code, expiresInMinutes = 10 }) {
  const recipientName = name ? name.trim() : 'there';
  const subject = `${code} is your Money Log verification code`;
  const previewText = `Your 6-digit email verification code is ${code}. Valid for ${expiresInMinutes} minutes.`;

  const content = `
    <h1 style="margin: 0 0 16px; font-size: 22px; font-weight: 700; color: #0F172A; letter-spacing: -0.3px;">
      Confirm Your Email Address
    </h1>

    <p style="margin: 0 0 16px; font-size: 15px; line-height: 1.6; color: #475569;">
      Hi <strong style="color: #0F172A;">${recipientName}</strong>,
    </p>

    <p style="margin: 0 0 24px; font-size: 15px; line-height: 1.6; color: #475569;">
      Thank you for signing up for Money Log! To complete your registration and activate your account, please enter the 6-digit verification code below:
    </p>

    <!-- 6-digit OTP Block -->
    <div style="background-color: #F0FDF4; border: 2px dashed #159A1D; border-radius: 14px; padding: 26px 16px; text-align: center; margin: 28px 0;">
      <p style="margin: 0 0 10px; font-size: 12px; color: #166534; text-transform: uppercase; letter-spacing: 1.5px; font-weight: 700;">
        Email Verification Code
      </p>
      <div style="font-family: 'Courier New', Courier, monospace, sans-serif; font-size: 40px; font-weight: 800; letter-spacing: 10px; color: #159A1D;">
        ${code}
      </div>
      <p style="margin: 12px 0 0; font-size: 13px; color: #166534; font-weight: 500;">
        ⏱️ This code is valid for <strong>${expiresInMinutes} minutes</strong>.
      </p>
    </div>

    <!-- Security note -->
    <div style="background-color: #F8FAFC; border-radius: 10px; border: 1px solid #E2E8F0; padding: 14px 18px; margin: 24px 0;">
      <p style="margin: 0; font-size: 13px; color: #64748B; line-height: 1.5;">
        🔒 Never share this code with anyone. Money Log support representatives will never ask you for your verification code.
      </p>
    </div>

    <p style="margin: 0; font-size: 13px; color: #94A3B8; line-height: 1.5; border-top: 1px solid #F1F5F9; padding-top: 20px;">
      If you did not create an account with Money Log, you can safely ignore this email.
    </p>
  `;

  const html = renderBaseLayout({ title: subject, content, previewText });

  const text = `Hi ${recipientName},\n\nYour 6-digit verification code for Money Log is: ${code}\n\nThis code will expire in ${expiresInMinutes} minutes.\n\nNever share this code with anyone.\nIf you did not sign up for Money Log, please ignore this email.`;

  return { subject, html, text };
}

module.exports = {
  renderVerifyEmail,
};
