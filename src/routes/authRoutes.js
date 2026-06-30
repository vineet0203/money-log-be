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
router.post('/logout', verifyToken, authController.logout);

module.exports = router;
