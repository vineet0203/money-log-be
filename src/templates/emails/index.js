const { renderBaseLayout } = require('./baseLayout');
const { renderVerifyEmail } = require('./verifyEmail');
const { renderForgotPassword } = require('./forgotPassword');
const { renderNotificationAlert } = require('./notificationAlert');
const { renderPasswordChangedAlert } = require('./passwordChangedAlert');
const { renderWelcomeEmail } = require('./welcomeEmail');

module.exports = {
  renderBaseLayout,
  renderVerifyEmail,
  renderForgotPassword,
  renderNotificationAlert,
  renderPasswordChangedAlert,
  renderWelcomeEmail,
};
