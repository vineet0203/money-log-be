const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const authController = require('../controllers/authController');
const { verifyToken } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const { otpSendLimiter, otpVerifyLimiter } = require('../middleware/rateLimiters');
const { sendOtpSchema, verifyOtpSchema, completeProfileSchema, refreshTokenSchema } = require('../schemaValidation/authSchemas');

router.post('/send-otp', otpSendLimiter, validate(sendOtpSchema), authController.sendOtp);
router.post('/verify-otp', otpVerifyLimiter, validate(verifyOtpSchema), authController.verifyOtp);
router.post('/refresh-token', validate(refreshTokenSchema), authController.refreshToken);
router.post('/complete-profile', verifyToken, validate(completeProfileSchema), authController.completeProfile);
// Logout must remain reachable when the access token has expired so it can
// clear the HttpOnly cookies and invalidate the refresh-token session.
router.post('/logout', authController.logout);

// Failsafe route to force clear cookies if token is expired/invalid
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

module.exports = router;
