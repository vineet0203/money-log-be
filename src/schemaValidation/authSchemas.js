const { z } = require('zod');

// Schema for sending OTP
const sendOtpSchema = z.object({
  body: z.object({
    phone: z.string().min(10).max(15).regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number format')
  })
});

// Schema for verifying OTP
const verifyOtpSchema = z.object({
  body: z.object({
    phone: z.string().min(10).max(15).regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number format'),
    code: z.string().length(6).regex(/^\d+$/, 'OTP must be exactly 6 digits')
  })
});

// Schema for completing profile
const completeProfileSchema = z.object({
  body: z.object({
    name: z.string().min(1, 'Name is required').max(100),
    email: z.string().email('Invalid email address').optional().or(z.literal(''))
  })
});

// Schema for refreshing token
const refreshTokenSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(1, 'Refresh token is required')
  })
});

module.exports = {
  sendOtpSchema,
  verifyOtpSchema,
  completeProfileSchema,
  refreshTokenSchema
};
