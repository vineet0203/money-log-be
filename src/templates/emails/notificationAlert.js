const { renderBaseLayout } = require('./baseLayout');

/**
 * Renders a Notification Alert email (Upcoming Bill / Subscription, Expected Income, Budget Warning)
 *
 * @param {object} params
 * @param {string} [params.name]
 * @param {string} params.title - Alert headline e.g. "Upcoming Payment Due"
 * @param {string} params.itemName - e.g. "Netflix Premium", "AWS Cloud"
 * @param {string|number} params.amount - e.g. "15.99" or "$15.99"
 * @param {string} [params.dueDate] - e.g. "2026-11-05"
 * @param {'expense'|'income'|'warning'|'info'} [params.alertType='expense']
 * @param {string} [params.description]
 * @param {string} [params.ctaUrl]
 * @param {string} [params.ctaText='View in Money Log']
 */
function renderNotificationAlert({
  name,
  title = 'Payment Due Reminder',
  itemName,
  amount,
  dueDate,
  alertType = 'expense',
  description,
  ctaUrl = `${process.env.FRONTEND_URL || 'https://moneylog.com'}/subscriptions`,
  ctaText = 'View in Money Log',
}) {
  const recipientName = name ? name.trim() : 'there';
  const isIncome = alertType === 'income';
  const isWarning = alertType === 'warning';

  let badgeColor = '#DC2626'; // rose-600
  let badgeBg = '#FEF2F2';
  let badgeBorder = '#FECACA';
  let badgeLabel = 'Payment Due';

  if (isIncome) {
    badgeColor = '#159A1D';
    badgeBg = '#F0FDF4';
    badgeBorder = '#BBF7D0';
    badgeLabel = 'Expected Income';
  } else if (isWarning) {
    badgeColor = '#D97706';
    badgeBg = '#FFFBEB';
    badgeBorder = '#FDE68A';
    badgeLabel = 'Budget Alert';
  }

  const formattedAmount = String(amount).startsWith('$') ? String(amount) : `$${amount}`;
  const subject = `${title}: ${itemName} (${formattedAmount})`;
  const previewText = `${itemName} of ${formattedAmount} is ${isIncome ? 'expected' : 'due'}${dueDate ? ` on ${dueDate}` : ''}.`;

  const content = `
    <!-- Alert Badge -->
    <table cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 16px;">
      <tr>
        <td style="background-color: ${badgeBg}; border: 1px solid ${badgeBorder}; border-radius: 9999px; padding: 4px 14px;">
          <span style="font-size: 12px; font-weight: 700; color: ${badgeColor}; text-transform: uppercase; letter-spacing: 0.5px;">
            ${badgeLabel}
          </span>
        </td>
      </tr>
    </table>

    <h1 style="margin: 0 0 16px; font-size: 22px; font-weight: 700; color: #0F172A; letter-spacing: -0.3px;">
      ${title}
    </h1>

    <p style="margin: 0 0 16px; font-size: 15px; line-height: 1.6; color: #475569;">
      Hi <strong style="color: #0F172A;">${recipientName}</strong>,
    </p>

    <p style="margin: 0 0 24px; font-size: 15px; line-height: 1.6; color: #475569;">
      ${description || `This is a reminder that your ${isIncome ? 'expected income for' : 'subscription payment for'} <strong style="color: #0F172A;">${itemName}</strong> is coming up.`}
    </p>

    <!-- Details Box -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 12px; margin: 24px 0; overflow: hidden;">
      <tr>
        <td style="padding: 20px 24px; border-bottom: 1px solid #E2E8F0;">
          <div style="font-size: 12px; color: #64748B; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px; font-weight: 600;">
            Item / Service
          </div>
          <div style="font-size: 18px; font-weight: 700; color: #0F172A;">
            ${itemName}
          </div>
        </td>
      </tr>
      <tr>
        <td style="padding: 20px 24px;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td width="50%" valign="top">
                <div style="font-size: 12px; color: #64748B; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px; font-weight: 600;">
                  ${isIncome ? 'Amount Expected' : 'Amount Due'}
                </div>
                <div style="font-size: 24px; font-weight: 800; color: ${badgeColor};">
                  ${formattedAmount}
                </div>
              </td>
              ${dueDate ? `
              <td width="50%" valign="top" style="border-left: 1px solid #E2E8F0; padding-left: 20px;">
                <div style="font-size: 12px; color: #64748B; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px; font-weight: 600;">
                  Date
                </div>
                <div style="font-size: 16px; font-weight: 700; color: #0F172A;">
                  ${dueDate}
                </div>
              </td>` : ''}
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <!-- Call to Action -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 28px 0 16px;">
      <tr>
        <td align="center">
          <a class="btn-action" href="${ctaUrl}" target="_blank" style="display: inline-block; background-color: #159A1D; color: #FFFFFF; font-size: 15px; font-weight: 600; text-decoration: none; padding: 14px 36px; border-radius: 12px; box-shadow: 0 4px 14px rgba(21, 154, 29, 0.35); text-align: center;">
            ${ctaText}
          </a>
        </td>
      </tr>
    </table>

    <p style="margin: 20px 0 0; font-size: 12px; color: #94A3B8; text-align: center;">
      Manage your alert preferences anytime from your <a href="${process.env.FRONTEND_URL || 'https://moneylog.com'}/settings" style="color: #159A1D; font-weight: 600;">Notification Settings</a>.
    </p>
  `;

  const html = renderBaseLayout({ title: subject, content, previewText });

  const text = `Hi ${recipientName},\n\n${title}\nItem: ${itemName}\nAmount: ${formattedAmount}\n${dueDate ? `Date: ${dueDate}\n` : ''}\nView details in Money Log:\n${ctaUrl}\n\nThank you for using Money Log!`;

  return { subject, html, text };
}

module.exports = {
  renderNotificationAlert,
};
