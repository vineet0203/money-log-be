const rateLimit = require('express-rate-limit');

/**
 * Standardized Rate Limiters
 */

// Login brute-force defense (5 attempts per 15 mins per IP)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many failed login attempts. Please wait 15 minutes before trying again.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Signup abuse prevention (5 accounts per hour per IP)
const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: 'Too many accounts created from this IP. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Password reset request limiter (3 requests per 15 mins per IP)
const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  message: { error: 'Too many password reset requests. Please wait 15 minutes before trying again.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// OTP send limiter (phone + IP defense)
const otpSendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
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

// Email OTP verification rate limiter (10 attempts per 15 mins per IP)
const emailOtpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many verification attempts. Please wait 15 minutes before trying again.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Reports and Dashboard heavy queries limiter (60 / 15 mins)
const reportsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: 'Too many analytics/report requests. Please slow down and try again later.' },
  validate: { keyGeneratorIpFallback: false },
  keyGenerator: (req) => {
    return req.user?.id ? `user_${req.user.id}` : req.ip;
  },
});

module.exports = {
  loginLimiter,
  signupLimiter,
  forgotPasswordLimiter,
  emailOtpLimiter,
  otpSendLimiter,
  otpVerifyLimiter,
  reportsLimiter,
};
