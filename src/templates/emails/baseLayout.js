/**
 * Base email layout matching the Money Log web theme (Clean, Modern Light Theme)
 * Compatible with Gmail, Apple Mail, Outlook, Yahoo, and mobile email clients.
 */
function renderBaseLayout({ title, content, previewText = '' }) {
  const currentYear = new Date().getFullYear();
  const webUrl = (process.env.FRONTEND_URL || process.env.APP_URL || 'https://moneylog.com').replace(/\/$/, '');
  const logoUrl = `${webUrl}/logo/logo_text.png`;

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <title>${title}</title>
    <!--[if mso]>
    <style type="text/css">
      table, td {border-collapse: collapse !important;}
      body, table, td, p, a, li, blockquote {font-family: Arial, sans-serif !important;}
    </style>
    <![endif]-->
    <style type="text/css">
      body { margin: 0; padding: 0; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; background-color: #F8FAFC; }
      table { border-spacing: 0; border-collapse: collapse; }
      img { border: 0; line-height: 100%; outline: none; text-decoration: none; }
      a { color: #159A1D; text-decoration: none; }
      @media only screen and (max-width: 620px) {
        .email-container { width: 100% !important; max-width: 100% !important; border-radius: 0 !important; }
        .email-content { padding: 28px 20px !important; }
        .email-header { padding: 24px 20px !important; }
        .email-footer { padding: 20px !important; }
        .btn-action { width: 100% !important; box-sizing: border-box !important; text-align: center !important; }
      }
    </style>
  </head>
  <body style="margin: 0; padding: 0; background-color: #F8FAFC; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #334155;">
    ${previewText ? `
    <div style="display: none; max-height: 0px; overflow: hidden; mso-hide: all; font-size: 1px; line-height: 1px; color: #F8FAFC;">
      ${previewText}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
    </div>` : ''}

    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #F8FAFC; width: 100%; margin: 0; padding: 40px 16px;">
      <tr>
        <td align="center">
          <table class="email-container" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 580px; background-color: #FFFFFF; border-radius: 16px; border: 1px solid #E2E8F0; overflow: hidden; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.05);">
            <!-- Header with Official Logo -->
            <tr>
              <td class="email-header" align="center" style="padding: 32px 40px 28px; background-color: #FFFFFF; border-bottom: 1px solid #F1F5F9;">
                <table cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td align="center">
                      <a href="${webUrl}" target="_blank" style="display: inline-block; text-decoration: none;">
                        <img 
                          src="${logoUrl}" 
                          alt="Money Log" 
                          width="170" 
                          height="38" 
                          style="display: block; width: 170px; height: auto; max-height: 42px; border: 0; outline: none; margin: 0 auto;"
                        />
                      </a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Main Body Content -->
            <tr>
              <td class="email-content" style="padding: 36px 40px 32px; background-color: #FFFFFF;">
                ${content}
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td class="email-footer" style="padding: 24px 40px; background-color: #F8FAFC; text-align: center; border-top: 1px solid #F1F5F9;">
                <p style="margin: 0 0 8px; font-size: 12px; color: #64748B; line-height: 1.5; font-weight: 500;">
                  © ${currentYear} Money Log. Track Money, Manage Life, Build Wealth.
                </p>
                <p style="margin: 0; font-size: 11px; color: #94A3B8; line-height: 1.4;">
                  This is an automated operational notification regarding your Money Log account.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

module.exports = {
  renderBaseLayout,
};
