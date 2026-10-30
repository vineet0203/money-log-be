const { z } = require('zod');

// Schema for User Signup (Email, Password, Name, and optional Phone)
const signupSchema = z.object({
  body: z.object({
    email: z
      .string({ required_error: 'Email is required' })
      .email('Invalid email address')
      .max(255)
      .transform((val) => val.trim().toLowerCase()),
    password: z
      .string({ required_error: 'Password is required' })
      .min(8, 'Password must be at least 8 characters')
      .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
      .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
      .regex(/[0-9]/, 'Password must contain at least one number'),
    name: z
      .string({ required_error: 'Name is required' })
      .min(1, 'Name is required')
      .max(100)
      .transform((val) => val.trim()),
    phone: z.string().max(20).optional().transform((val) => (val ? val.trim() : val)),
  }),
});

// Schema for User Login (Email + Password)
const loginSchema = z.object({
  body: z.object({
    email: z
      .string({ required_error: 'Email is required' })
      .email('Invalid email address')
      .transform((val) => val.trim().toLowerCase()),
    password: z
      .string({ required_error: 'Password is required' })
      .min(1, 'Password cannot be empty'),
  }),
});

// Schema for Forgot Password Request
const forgotPasswordSchema = z.object({
  body: z.object({
    email: z
      .string({ required_error: 'Email is required' })
      .email('Invalid email address')
      .transform((val) => val.trim().toLowerCase()),
  }),
});

// Schema for Reset Password Request
const resetPasswordSchema = z.object({
  body: z.object({
    token: z
      .string({ required_error: 'Reset token or code is required' })
      .min(1, 'Reset token cannot be empty')
      .transform((val) => val.trim()),
    newPassword: z
      .string({ required_error: 'New password is required' })
      .min(8, 'Password must be at least 8 characters')
      .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
      .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
      .regex(/[0-9]/, 'Password must contain at least one number'),
  }),
});

// Schema for Authenticated Password Change
const changePasswordSchema = z.object({
  body: z.object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z
      .string({ required_error: 'New password is required' })
      .min(8, 'Password must be at least 8 characters')
      .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
      .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
      .regex(/[0-9]/, 'Password must contain at least one number'),
  }),
});

// Schema for refreshing token
const refreshTokenSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(1, 'Refresh token is required').optional(),
  }),
});

// Schema for verifying email via 6-digit OTP
const verifyEmailOtpSchema = z.object({
  body: z.object({
    email: z
      .string({ required_error: 'Email is required' })
      .email('Invalid email address')
      .transform((val) => val.trim().toLowerCase()),
    otp: z
      .string({ required_error: 'Verification code is required' })
      .length(6, 'Verification code must be 6 digits')
      .regex(/^\d{6}$/, 'Verification code must be 6 digits'),
  }),
});

// Schema for resending email verification 6-digit OTP
const resendEmailOtpSchema = z.object({
  body: z.object({
    email: z
      .string({ required_error: 'Email is required' })
      .email('Invalid email address')
      .transform((val) => val.trim().toLowerCase()),
  }),
});

// Schema for sending OTP (legacy transition)
const sendOtpSchema = z.object({
  body: z.object({
    phone: z.string().min(10).max(15).regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number format'),
  }),
});

// Schema for verifying OTP (legacy transition)
const verifyOtpSchema = z.object({
  body: z.object({
    phone: z.string().min(10).max(15).regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number format'),
    code: z.string().length(6).regex(/^\d+$/, 'OTP must be exactly 6 digits'),
  }),
});

module.exports = {
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
};
