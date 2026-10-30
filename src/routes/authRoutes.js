const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { verifyToken } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const {
  loginLimiter,
  signupLimiter,
  forgotPasswordLimiter,
  emailOtpLimiter,
  otpSendLimiter,
  otpVerifyLimiter,
} = require('../middleware/rateLimiters');
const {
  signupSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  refreshTokenSchema,
  verifyEmailOtpSchema,
  resendEmailOtpSchema,
  sendOtpSchema,
  verifyOtpSchema,
} = require('../schemaValidation/authSchemas');

// 1. Primary Authentication Endpoints
router.post('/signup', signupLimiter, validate(signupSchema), authController.signup);
router.post('/verify-email-otp', emailOtpLimiter, validate(verifyEmailOtpSchema), authController.verifyEmailOtp);
router.post('/resend-email-otp', emailOtpLimiter, validate(resendEmailOtpSchema), authController.resendEmailOtp);
router.post('/login', loginLimiter, validate(loginSchema), authController.login);

// 2. Password Reset & Account Recovery
router.post('/forgot-password', forgotPasswordLimiter, validate(forgotPasswordSchema), authController.forgotPassword);
router.post('/reset-password', validate(resetPasswordSchema), authController.resetPassword);
router.post('/change-password', verifyToken, validate(changePasswordSchema), authController.changePassword);

// 3. Multi-Device Session Management
router.post('/refresh-token', validate(refreshTokenSchema), authController.refreshToken);
router.post('/logout', authController.logout);
router.post('/logout-all', verifyToken, authController.logoutAll);

// 4. Cookie Failsafe Cleanup
router.post('/clear-cookies', (req, res) => {
  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
  };
  res.cookie('accessToken', '', { ...cookieOptions, maxAge: 0 });
  res.cookie('refreshToken', '', { ...cookieOptions, maxAge: 0 });
  res.status(200).json({ message: 'Cookies cleared' });
});

// 5. Legacy OTP Endpoints (Maintained for smooth mobile transition)
router.post('/send-otp', otpSendLimiter, validate(sendOtpSchema), authController.sendOtp);
router.post('/verify-otp', otpVerifyLimiter, validate(verifyOtpSchema), authController.verifyOtp);

module.exports = router;
