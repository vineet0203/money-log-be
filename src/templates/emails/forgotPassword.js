const { renderBaseLayout } = require('./baseLayout');

/**
 * Renders Forgot Password / Password Reset Request template (Web Theme Light Mode)
 *
 * @param {object} params
 * @param {string} [params.name]
 * @param {string} params.resetUrl
 * @param {string} [params.code]
 * @param {number} [params.expiresInMinutes=15]
 */
function renderForgotPassword({ name, resetUrl, code, expiresInMinutes = 15 }) {
  const recipientName = name ? name.trim() : 'there';
  const subject = 'Reset Your Money Log Password';
  const previewText = `Instructions to reset your Money Log password. Valid for ${expiresInMinutes} minutes.`;

  const content = `
    <h1 style="margin: 0 0 16px; font-size: 22px; font-weight: 700; color: #0F172A; letter-spacing: -0.3px;">
      Password Reset Request
    </h1>

    <p style="margin: 0 0 16px; font-size: 15px; line-height: 1.6; color: #475569;">
      Hi <strong style="color: #0F172A;">${recipientName}</strong>,
    </p>

    <p style="margin: 0 0 24px; font-size: 15px; line-height: 1.6; color: #475569;">
      We received a request to reset the password for your Money Log account. Click the button below to choose a new password:
    </p>

    <!-- Action Button -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 28px 0;">
      <tr>
        <td align="center">
          <a class="btn-action" href="${resetUrl}" target="_blank" style="display: inline-block; background-color: #159A1D; color: #FFFFFF; font-size: 15px; font-weight: 600; text-decoration: none; padding: 14px 36px; border-radius: 12px; box-shadow: 0 4px 14px rgba(21, 154, 29, 0.35); text-align: center;">
            Reset Password
          </a>
        </td>
      </tr>
    </table>

    ${code ? `
    <!-- 6-digit code for mobile app -->
    <div style="background-color: #F8FAFC; border: 1px dashed #CBD5E1; border-radius: 12px; padding: 18px; text-align: center; margin: 24px 0;">
      <p style="margin: 0 0 6px; font-size: 12px; color: #64748B; text-transform: uppercase; letter-spacing: 1px; font-weight: 600;">
        Or enter this reset code in the mobile app:
      </p>
      <div style="font-family: monospace; font-size: 26px; font-weight: 800; letter-spacing: 6px; color: #159A1D;">
        ${code}
      </div>
    </div>` : ''}

    <!-- Expiration Warning Notice -->
    <div style="background-color: #FFFBEB; border-radius: 10px; border: 1px solid #FDE68A; padding: 14px 18px; margin: 24px 0;">
      <p style="margin: 0; font-size: 13px; color: #92400E; line-height: 1.5;">
        ⏱️ <strong>Note:</strong> This link is valid for <strong>${expiresInMinutes} minutes</strong>. If it expires, you can request a new one from the login screen.
      </p>
    </div>

    <!-- Fallback URL -->
    <p style="margin: 24px 0 8px; font-size: 12px; color: #64748B;">
      If the button above does not work, copy and paste this link into your browser:
    </p>
    <p style="margin: 0 0 24px; font-size: 12px; word-break: break-all; color: #159A1D; font-family: monospace;">
      ${resetUrl}
    </p>

    <!-- Security Advisory -->
    <p style="margin: 0; font-size: 13px; color: #94A3B8; line-height: 1.5; border-top: 1px solid #F1F5F9; padding-top: 20px;">
      If you did not request a password reset, you can safely ignore this email. Your password will remain unchanged and your account is secure.
    </p>
  `;

  const html = renderBaseLayout({ title: subject, content, previewText });

  const text = `Hi ${recipientName},\n\nWe received a request to reset your Money Log password.\n\nReset your password here:\n${resetUrl}\n\n${code ? `Reset Code: ${code}\n\n` : ''}This link will expire in ${expiresInMinutes} minutes.\n\nIf you did not request this change, you can safely ignore this email.`;

  return { subject, html, text };
}

module.exports = {
  renderForgotPassword,
};
