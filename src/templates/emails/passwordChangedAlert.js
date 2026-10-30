const { renderBaseLayout } = require('./baseLayout');

/**
 * Renders Security Alert when a password is changed or reset (Web Theme Light Mode)
 *
 * @param {object} params
 * @param {string} [params.name]
 * @param {string} [params.ipAddress]
 * @param {string} [params.userAgent]
 * @param {string} [params.timestamp]
 */
function renderPasswordChangedAlert({ name, ipAddress, userAgent, timestamp }) {
  const recipientName = name ? name.trim() : 'there';
  const subject = 'Security Alert: Your Money Log Password Was Changed';
  const previewText = `Your Money Log account password was recently updated. All other active sessions have been revoked.`;
  const formattedTime = timestamp || new Date().toUTCString();

  const content = `
    <!-- Security Badge -->
    <table cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 16px;">
      <tr>
        <td style="background-color: #FEF2F2; border: 1px solid #FECACA; border-radius: 9999px; padding: 4px 14px;">
          <span style="font-size: 12px; font-weight: 700; color: #DC2626; text-transform: uppercase; letter-spacing: 0.5px;">
            Security Notification
          </span>
        </td>
      </tr>
    </table>

    <h1 style="margin: 0 0 16px; font-size: 22px; font-weight: 700; color: #0F172A; letter-spacing: -0.3px;">
      Your Password Was Changed
    </h1>

    <p style="margin: 0 0 16px; font-size: 15px; line-height: 1.6; color: #475569;">
      Hi <strong style="color: #0F172A;">${recipientName}</strong>,
    </p>

    <p style="margin: 0 0 20px; font-size: 15px; line-height: 1.6; color: #475569;">
      The password for your Money Log account was successfully updated.
    </p>

    <!-- Event details table -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 12px; margin: 20px 0; padding: 16px 20px;">
      <tr>
        <td style="padding: 8px 0; font-size: 13px; color: #64748B;">Time (UTC):</td>
        <td style="padding: 8px 0; font-size: 13px; color: #0F172A; font-weight: 600;" align="right">${formattedTime}</td>
      </tr>
      ${ipAddress ? `
      <tr>
        <td style="padding: 8px 0; font-size: 13px; color: #64748B;">IP Address:</td>
        <td style="padding: 8px 0; font-size: 13px; color: #0F172A; font-weight: 600;" align="right">${ipAddress}</td>
      </tr>` : ''}
      ${userAgent ? `
      <tr>
        <td style="padding: 8px 0; font-size: 13px; color: #64748B;">Device:</td>
        <td style="padding: 8px 0; font-size: 13px; color: #0F172A; font-weight: 600;" align="right">${userAgent}</td>
      </tr>` : ''}
    </table>

    <div style="background-color: #F0FDF4; border-left: 4px solid #159A1D; border-radius: 6px; padding: 14px 18px; margin: 20px 0;">
      <p style="margin: 0; font-size: 13px; color: #166534; line-height: 1.5; font-weight: 500;">
        🔒 For your security, all other active sessions across your other devices and browsers have been logged out.
      </p>
    </div>

    <div style="background-color: #FEF2F2; border: 1px solid #FEE2E2; border-radius: 10px; padding: 16px; margin: 24px 0;">
      <p style="margin: 0; font-size: 13px; color: #991B1B; line-height: 1.5;">
        ⚠️ <strong>Did not make this change?</strong> Your account may be compromised. Please reset your password immediately or contact our support team.
      </p>
    </div>
  `;

  const html = renderBaseLayout({ title: subject, content, previewText });

  const text = `Hi ${recipientName},\n\nThe password for your Money Log account was successfully updated on ${formattedTime}.\n${ipAddress ? `IP: ${ipAddress}\n` : ''}\nAll other active sessions have been automatically logged out.\n\nIf you did not make this change, please contact Money Log support immediately.`;

  return { subject, html, text };
}

module.exports = {
  renderPasswordChangedAlert,
};
