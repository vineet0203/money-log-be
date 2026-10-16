const rateLimit = require('express-rate-limit');

/**
 * Standardized Rate Limiters (§5.5)
 */

// OTP send limiter (phone + IP defense)
const otpSendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: { error: 'Too many OTP requests from this IP/number. Please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// OTP verify brute-force defense (5 attempts per 15 mins)
const otpVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many failed verification attempts. Please wait 15 minutes before trying again.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Reports and Dashboard heavy queries limiter (60 / 15 mins)
const reportsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: 'Too many analytics/report requests. Please slow down and try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.user?.id ? `user_${req.user.id}` : req.ip;
  },
});

module.exports = {
  otpSendLimiter,
  otpVerifyLimiter,
  reportsLimiter,
};
