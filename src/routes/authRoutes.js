const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const authController = require('../controllers/authController');
const { verifyToken } = require('../middleware/authMiddleware');
const validate = require('../middleware/validate');
const { sendOtpSchema, verifyOtpSchema, completeProfileSchema, refreshTokenSchema } = require('../schemaValidation/authSchemas');

const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 requests per `window` (here, per 15 minutes)
  message: { error: 'Too many OTP requests from this IP, please try again after 15 minutes' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/send-otp', otpLimiter, validate(sendOtpSchema), authController.sendOtp);
router.post('/verify-otp', validate(verifyOtpSchema), authController.verifyOtp);
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
