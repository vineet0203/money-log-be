const { renderBaseLayout } = require('./baseLayout');

/**
 * Renders Welcome Email for new users (Web Theme Light Mode)
 *
 * @param {object} params
 * @param {string} [params.name]
 * @param {string} [params.email]
 * @param {string} [params.loginUrl]
 */
function renderWelcomeEmail({
  name,
  email,
  loginUrl = `${process.env.FRONTEND_URL || 'https://moneylog.com'}/login`,
}) {
  const recipientName = name ? name.trim() : 'there';
  const subject = 'Welcome to Money Log! 🎉';
  const previewText = `Your Money Log account is ready. Start tracking your finances today.`;

  const content = `
    <h1 style="margin: 0 0 16px; font-size: 22px; font-weight: 700; color: #0F172A; letter-spacing: -0.3px;">
      Welcome to Money Log! 🎉
    </h1>

    <p style="margin: 0 0 16px; font-size: 15px; line-height: 1.6; color: #475569;">
      Hi <strong style="color: #0F172A;">${recipientName}</strong>,
    </p>

    <p style="margin: 0 0 20px; font-size: 15px; line-height: 1.6; color: #475569;">
      We're thrilled to welcome you to Money Log. Your account is active and ready to help you track money, manage life, and build lasting wealth.
    </p>

    <div style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 12px; padding: 20px 24px; margin: 24px 0;">
      <div style="font-size: 14px; font-weight: 700; color: #0F172A; margin-bottom: 12px;">
        Here is what you can do right now:
      </div>
      <ul style="margin: 0; padding-left: 20px; color: #475569; font-size: 13px; line-height: 1.8;">
        <li><strong style="color: #0F172A;">Log Transactions:</strong> Categorize your daily income and expenses.</li>
        <li><strong style="color: #0F172A;">Manage Subscriptions:</strong> Never get blindsided by unexpected auto-renewals.</li>
        <li><strong style="color: #0F172A;">Point of Sale (POS):</strong> Run fast, live store registers with printable receipts.</li>
        <li><strong style="color: #0F172A;">Multi-Device Sync:</strong> Access your data on web and mobile seamlessly.</li>
      </ul>
    </div>

    <!-- CTA Button -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 28px 0 16px;">
      <tr>
        <td align="center">
          <a class="btn-action" href="${loginUrl}" target="_blank" style="display: inline-block; background-color: #159A1D; color: #FFFFFF; font-size: 15px; font-weight: 600; text-decoration: none; padding: 14px 36px; border-radius: 12px; box-shadow: 0 4px 14px rgba(21, 154, 29, 0.35); text-align: center;">
            Open Money Log Dashboard
          </a>
        </td>
      </tr>
    </table>
  `;

  const html = renderBaseLayout({ title: subject, content, previewText });

  const text = `Hi ${recipientName},\n\nWelcome to Money Log!\n\nAccess your dashboard:\n${loginUrl}\n\nThank you for choosing Money Log!`;

  return { subject, html, text };
}

module.exports = {
  renderWelcomeEmail,
};
