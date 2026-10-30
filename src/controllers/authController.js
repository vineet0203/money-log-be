const { pool } = require('../config/db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const {
  sendWelcomeEmail,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendPasswordChangedAlert,
} = require('../services/emailService');
const {
  sendPhoneVerificationOtp,
  verifyPhoneOtpCode,
} = require('../services/smsService');

// Dummy hash used for constant-time comparison when user does not exist (prevents timing attacks)
const DUMMY_HASH = '$2b$12$e80yq9gqgqgqgqgqgqgqg.qgqgqgqgqgqgqgqgqgqgqgqgqgqgqgq';

/**
 * Creates a new refresh token and session record in MySQL (Multi-Device aware)
 */
async function createDeviceSession({ userId, req }) {
  const rawRefreshToken = uuidv4();
  const tokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');

  const clientType = req.headers['x-client-type'] === 'mobile' ? 'mobile' : 'web';
  const deviceName =
    req.headers['x-device-name'] ||
    (req.headers['user-agent'] ? req.headers['user-agent'].slice(0, 100) : 'Unknown Device');
  const ipAddress = req.ip || req.connection?.remoteAddress || null;

  // Refresh token valid for 30 days
  const [insertResult] = await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, device_name, device_type, ip_address, expires_at)
     VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY))`,
    [userId, tokenHash, deviceName, clientType, ipAddress]
  );

  return {
    sessionId: insertResult.insertId,
    refreshToken: rawRefreshToken,
  };
}

/**
 * Signs a short-lived Access Token (15m) linked to the user's token version and session ID
 */
function generateAccessToken({ userId, tokenVersion = 1, sessionId }) {
  return jwt.sign(
    {
      id: userId,
      version: tokenVersion,
      sid: sessionId,
    },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: '15m' }
  );
}

/**
 * Helper to attach cookies for Web clients and return normalized JSON payload
 */
function handleAuthResponse({ res, req, accessToken, refreshToken, user, statusCode = 200, message = 'Success' }) {
  const clientType = req.headers['x-client-type'];

  if (clientType === 'web') {
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
    };
    res.cookie('accessToken', accessToken, { ...cookieOptions, maxAge: 15 * 60 * 1000 });
    res.cookie('refreshToken', refreshToken, { ...cookieOptions, maxAge: 30 * 24 * 60 * 60 * 1000 });
  }

  return res.status(statusCode).json({
    message,
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      phoneNumber: user.phone_number,
    },
  });
}

/**
 * Seeds default categories for a new user
 */
async function seedDefaultCategories(userId) {
  const defaultCategories = [
    { name: 'Entertainment', icon: 'film-outline', color: '#F59E0B' },
    { name: 'Food', icon: 'restaurant-outline', color: '#EF4444' },
    { name: 'Travelling', icon: 'airplane-outline', color: '#3B82F6' },
    { name: 'Electricity', icon: 'flash-outline', color: '#EAB308' },
    { name: 'Phone', icon: 'call-outline', color: '#10B981' },
    { name: 'Internet', icon: 'wifi-outline', color: '#6366F1' },
    { name: 'Others', icon: 'help-circle-outline', color: '#94A3B8' },
  ];

  for (const cat of defaultCategories) {
    await pool.query(
      'INSERT INTO categories (user_id, name, icon_name, color, budget_limit) VALUES (?, ?, ?, ?, ?)',
      [userId, cat.name, cat.icon, cat.color, 100.0]
    );
  }
}

// ========================================================
// 1. SIGNUP & LOGIN FLOWS (Email + Password + 6-Digit Email OTP)
// ========================================================

/**
 * POST /auth/signup
 * Register a new user with email, password, and name, then send a 6-digit email OTP
 */
exports.signup = async (req, res) => {
  const { email, password, name, phone } = req.body;

  try {
    // 1. Check for existing email conflict
    const [existing] = await pool.query(
      'SELECT id, email_verified_at, is_deleted FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1',
      [email]
    );

    let userId;
    const passwordHash = await bcrypt.hash(password, 12);

    if (existing.length > 0) {
      const existingUser = existing[0];
      if (existingUser.is_deleted === 1) {
        return res.status(409).json({ error: 'This account was previously deleted. Please contact support.' });
      }
      if (existingUser.email_verified_at !== null) {
        return res.status(409).json({ error: 'An account with this email address already exists.' });
      }

      // If user registered earlier but never verified email, update info and resend fresh OTP
      userId = existingUser.id;
      await pool.query(
        'UPDATE users SET password_hash = ?, name = ?, phone_number = ? WHERE id = ?',
        [passwordHash, name, phone || null, userId]
      );
    } else {
      // 2. Insert new user record (email_verified_at = NULL)
      const [insertResult] = await pool.query(
        `INSERT INTO users (email, password_hash, name, phone_number, token_version, is_active)
         VALUES (?, ?, ?, ?, 1, 1)`,
        [email, passwordHash, name, phone || null]
      );
      userId = insertResult.insertId;
    }

    // 3. Generate secure 6-digit numeric OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = crypto.createHash('sha256').update(otp).digest('hex');

    // 4. Invalidate old OTPs and store new OTP (valid for 10 minutes)
    await pool.query('DELETE FROM email_verification_otps WHERE user_id = ?', [userId]);
    await pool.query(
      `INSERT INTO email_verification_otps (user_id, otp_hash, expires_at)
       VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))`,
      [userId, otpHash]
    );

    // 5. Send 6-digit verification code to email via Rackspace SMTP
    sendVerificationEmail({
      to: email,
      name,
      code: otp,
      expiresInMinutes: 10,
    }).catch((err) => {
      console.warn('[Signup] Error sending verification OTP email:', err.message);
    });

    return res.status(201).json({
      message: 'Account created successfully. A 6-digit verification code has been sent to your email.',
      email,
      requiresEmailVerification: true,
    });
  } catch (error) {
    console.error('Error during signup:', error);
    return res.status(500).json({ error: 'Failed to create account. Please try again.' });
  }
};

/**
 * POST /auth/verify-email-otp
 * Verifies 6-digit email OTP and issues initial device authentication session tokens
 */
exports.verifyEmailOtp = async (req, res) => {
  const { email, otp } = req.body;

  try {
    // 1. Look up user
    const [users] = await pool.query(
      `SELECT id, email, name, phone_number, token_version, is_active, is_deleted, email_verified_at 
       FROM users 
       WHERE LOWER(email) = LOWER(?) LIMIT 1`,
      [email]
    );

    if (users.length === 0 || users[0].is_deleted === 1) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const user = users[0];

    if (user.email_verified_at !== null) {
      return res.status(200).json({ message: 'Email is already verified. Please sign in.' });
    }

    // 2. Fetch active verification OTP
    const [otpRows] = await pool.query(
      `SELECT id, otp_hash, attempts, expires_at 
       FROM email_verification_otps 
       WHERE user_id = ? 
       ORDER BY id DESC LIMIT 1`,
      [user.id]
    );

    if (otpRows.length === 0) {
      return res.status(400).json({ error: 'No active verification code found. Please request a new code.' });
    }

    const otpRecord = otpRows[0];

    // 3. Check expiration
    if (new Date() > new Date(otpRecord.expires_at)) {
      return res.status(400).json({ error: 'Verification code has expired. Please request a new code.' });
    }

    // 4. Check brute-force attempts
    if (otpRecord.attempts >= 5) {
      return res.status(429).json({ error: 'Too many incorrect attempts. Please request a new verification code.' });
    }

    // 5. Compare OTP hash
    const incomingHash = crypto.createHash('sha256').update(otp).digest('hex');
    if (incomingHash !== otpRecord.otp_hash) {
      await pool.query('UPDATE email_verification_otps SET attempts = attempts + 1 WHERE id = ?', [otpRecord.id]);
      const remainingAttempts = 4 - otpRecord.attempts;
      return res.status(400).json({
        error: `Invalid verification code. ${remainingAttempts > 0 ? `${remainingAttempts} attempt(s) remaining.` : 'Code has been invalidated.'}`,
      });
    }

    // 6. Mark email verified & remove used OTP
    await pool.query('UPDATE users SET email_verified_at = NOW() WHERE id = ?', [user.id]);
    await pool.query('DELETE FROM email_verification_otps WHERE user_id = ?', [user.id]);

    // 7. Seed default categories if user has none
    const [categories] = await pool.query('SELECT id FROM categories WHERE user_id = ? LIMIT 1', [user.id]);
    if (categories.length === 0) {
      await seedDefaultCategories(user.id);
    }

    // 8. Create multi-device session and issue tokens
    const { sessionId, refreshToken } = await createDeviceSession({ userId: user.id, req });
    const accessToken = generateAccessToken({
      userId: user.id,
      tokenVersion: user.token_version,
      sessionId,
    });

    const userRecord = {
      id: user.id,
      email: user.email,
      name: user.name,
      phoneNumber: user.phone_number,
    };

    // 9. Send welcome email in background
    sendWelcomeEmail({
      to: user.email,
      name: user.name,
    }).catch((err) => {
      console.warn('[VerifyEmailOtp] Notice sending welcome email:', err.message);
    });

    return handleAuthResponse({
      res,
      req,
      accessToken,
      refreshToken,
      user: userRecord,
      statusCode: 200,
      message: 'Email verified successfully!',
    });
  } catch (error) {
    console.error('Error during verifyEmailOtp:', error);
    return res.status(500).json({ error: 'Failed to verify email. Please try again.' });
  }
};

/**
 * POST /auth/resend-email-otp
 * Resends a fresh 6-digit OTP to the user's email address
 */
exports.resendEmailOtp = async (req, res) => {
  const { email } = req.body;

  try {
    const [users] = await pool.query(
      'SELECT id, email, name, email_verified_at, is_deleted FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1',
      [email]
    );

    if (users.length === 0 || users[0].is_deleted === 1) {
      return res.status(404).json({ error: 'No account found with this email address.' });
    }

    const user = users[0];

    if (user.email_verified_at !== null) {
      return res.status(400).json({ error: 'Email is already verified. Please sign in.' });
    }

    // Cooldown check (60 seconds)
    const [latestOtp] = await pool.query(
      `SELECT created_at FROM email_verification_otps 
       WHERE user_id = ? 
       ORDER BY id DESC LIMIT 1`,
      [user.id]
    );

    if (latestOtp.length > 0) {
      const elapsedSeconds = Math.floor((Date.now() - new Date(latestOtp[0].created_at).getTime()) / 1000);
      if (elapsedSeconds < 60) {
        return res.status(429).json({
          error: `Please wait ${60 - elapsedSeconds} second(s) before requesting another code.`,
        });
      }
    }

    // Generate new 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = crypto.createHash('sha256').update(otp).digest('hex');

    await pool.query('DELETE FROM email_verification_otps WHERE user_id = ?', [user.id]);
    await pool.query(
      `INSERT INTO email_verification_otps (user_id, otp_hash, expires_at)
       VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))`,
      [user.id, otpHash]
    );

    sendVerificationEmail({
      to: user.email,
      name: user.name,
      code: otp,
      expiresInMinutes: 10,
    }).catch((err) => {
      console.warn('[ResendOtp] Error sending email:', err.message);
    });

    return res.status(200).json({
      message: 'A fresh 6-digit verification code has been sent to your email.',
    });
  } catch (error) {
    console.error('Error during resendEmailOtp:', error);
    return res.status(500).json({ error: 'Failed to resend verification code. Please try again.' });
  }
};

/**
 * POST /auth/login
 * Authenticate with email and password
 */
exports.login = async (req, res) => {
  const { email, password } = req.body;

  try {
    // 1. Query user by email
    const [rows] = await pool.query(
      `SELECT id, email, name, phone_number, password_hash, token_version, 
              is_active, is_deleted, email_verified_at, failed_login_attempts, locked_until
       FROM users 
       WHERE LOWER(email) = LOWER(?)
       LIMIT 1`,
      [email]
    );

    // 2. User not found -> execute dummy hash check to prevent timing attack
    if (rows.length === 0) {
      await bcrypt.compare(password, DUMMY_HASH);
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const user = rows[0];

    // 3. Check if account is deleted or deactivated
    if (user.is_deleted === 1) {
      return res.status(401).json({ error: 'Account no longer exists.' });
    }

    if (user.is_active === 0) {
      return res.status(403).json({ error: 'Your account has been deactivated. Please contact support.' });
    }

    // 4. Check account lockout status
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      const remainingMinutes = Math.ceil((new Date(user.locked_until) - new Date()) / 60000);
      return res.status(423).json({
        error: `Account is temporarily locked due to consecutive failed attempts. Try again in ${remainingMinutes} minute(s).`,
      });
    }

    // 5. Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password_hash || '');

    if (!isPasswordValid) {
      const newAttempts = (user.failed_login_attempts || 0) + 1;
      const isLocking = newAttempts >= 5;

      await pool.query(
        `UPDATE users 
         SET failed_login_attempts = ?,
             locked_until = CASE WHEN ? THEN DATE_ADD(NOW(), INTERVAL 15 MINUTE) ELSE NULL END
         WHERE id = ?`,
        [newAttempts, isLocking, user.id]
      );

      if (isLocking) {
        return res.status(423).json({
          error: 'Account locked for 15 minutes due to 5 consecutive failed login attempts.',
        });
      }

      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // 6. Reset failed attempts on successful login
    if (user.failed_login_attempts > 0 || user.locked_until) {
      await pool.query('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?', [user.id]);
    }

    // 7. Check email verification status
    if (user.email_verified_at === null) {
      // Generate fresh 6-digit verification OTP
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const otpHash = crypto.createHash('sha256').update(otp).digest('hex');

      await pool.query('DELETE FROM email_verification_otps WHERE user_id = ?', [user.id]);
      await pool.query(
        `INSERT INTO email_verification_otps (user_id, otp_hash, expires_at)
         VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))`,
        [user.id, otpHash]
      );

      sendVerificationEmail({
        to: user.email,
        name: user.name,
        code: otp,
        expiresInMinutes: 10,
      }).catch((err) => {
        console.warn('[Login] Error sending verification OTP email:', err.message);
      });

      return res.status(403).json({
        error: 'Your email address is not verified yet. A fresh 6-digit verification code has been sent to your inbox.',
        requiresEmailVerification: true,
        email: user.email,
      });
    }

    // 8. Create device session & tokens
    const { sessionId, refreshToken } = await createDeviceSession({ userId: user.id, req });
    const accessToken = generateAccessToken({
      userId: user.id,
      tokenVersion: user.token_version,
      sessionId,
    });

    return handleAuthResponse({
      res,
      req,
      accessToken,
      refreshToken,
      user,
      statusCode: 200,
      message: 'Logged in successfully',
    });
  } catch (error) {
    console.error('Error during login:', error);
    return res.status(500).json({ error: 'Failed to log in. Please try again.' });
  }
};

// ========================================================
// 2. FORGOT & RESET PASSWORD FLOWS
// ========================================================

/**
 * POST /auth/forgot-password
 * Send password reset instructions via email
 */
exports.forgotPassword = async (req, res) => {
  const { email } = req.body;
  const genericResponse = {
    message: 'If an account matches that email address, password reset instructions have been sent.',
  };

  try {
    // 1. Lookup user
    const [rows] = await pool.query(
      `SELECT id, email, name FROM users 
       WHERE LOWER(email) = LOWER(?) AND is_deleted = 0
       LIMIT 1`,
      [email]
    );

    // Anti-enumeration: always return generic response if not found
    if (rows.length === 0) {
      return res.status(200).json(genericResponse);
    }

    const user = rows[0];

    // 2. Invalidate any existing unused reset tokens for this user
    await pool.query(
      'UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL',
      [user.id]
    );

    // 3. Generate secure reset token (for web link) and 6-digit code (for mobile app)
    const rawToken = crypto.randomBytes(32).toString('hex');
    const numericCode = crypto.randomInt(100000, 999999).toString();

    const rawTokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const codeHash = crypto.createHash('sha256').update(numericCode).digest('hex');

    // Tokens valid for 15 minutes
    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 15 MINUTE)),
              (?, ?, DATE_ADD(NOW(), INTERVAL 15 MINUTE))`,
      [user.id, rawTokenHash, user.id, codeHash]
    );

    const resetUrl = `${process.env.FRONTEND_URL || 'https://moneylog.com'}/reset-password?token=${rawToken}`;

    // 4. Send email via Nodemailer
    sendPasswordResetEmail({
      to: user.email,
      name: user.name,
      resetUrl,
      code: numericCode,
      expiresInMinutes: 15,
    }).catch((err) => {
      console.warn('[Forgot Password] Notice sending reset email:', err.message);
    });

    return res.status(200).json(genericResponse);
  } catch (error) {
    console.error('Error during forgotPassword:', error);
    return res.status(500).json({ error: 'Failed to process request. Please try again later.' });
  }
};

/**
 * POST /auth/reset-password
 * Reset password using token/code
 */
exports.resetPassword = async (req, res) => {
  const { token, newPassword } = req.body;

  try {
    const tokenHash = crypto.createHash('sha256').update(token.trim()).digest('hex');

    // 1. Validate token
    const [tokenRows] = await pool.query(
      `SELECT * FROM password_reset_tokens 
       WHERE token_hash = ? AND expires_at > NOW() AND used_at IS NULL
       LIMIT 1`,
      [tokenHash]
    );

    if (tokenRows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired password reset link/code.' });
    }

    const resetRecord = tokenRows[0];
    const userId = resetRecord.user_id;

    // 2. Hash new password
    const passwordHash = await bcrypt.hash(newPassword, 12);

    // 3. Update password, increment token_version (invalidates ALL existing sessions everywhere)
    await pool.query(
      `UPDATE users 
       SET password_hash = ?, 
           token_version = token_version + 1,
           failed_login_attempts = 0,
           locked_until = NULL
       WHERE id = ?`,
      [passwordHash, userId]
    );

    // 4. Invalidate all reset tokens for this user
    await pool.query(
      'UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL',
      [userId]
    );

    // 5. Purge all existing refresh tokens for this user across all devices
    await pool.query('DELETE FROM refresh_tokens WHERE user_id = ?', [userId]);

    // 6. Send security alert email
    const [userRows] = await pool.query('SELECT email, name FROM users WHERE id = ?', [userId]);
    if (userRows.length > 0) {
      sendPasswordChangedAlert({
        to: userRows[0].email,
        name: userRows[0].name,
        ipAddress: req.ip,
      }).catch((err) => {
        console.warn('[Reset Password] Notice sending alert email:', err.message);
      });
    }

    return res.status(200).json({
      message: 'Your password has been successfully reset. Please log in with your new password.',
    });
  } catch (error) {
    console.error('Error during resetPassword:', error);
    return res.status(500).json({ error: 'Failed to reset password. Please try again.' });
  }
};

/**
 * POST /auth/change-password
 * Authenticated user changes their password
 */
exports.changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const userId = req.user.id;
  const currentSessionId = req.user.sessionId;

  try {
    const [rows] = await pool.query('SELECT password_hash, email, name FROM users WHERE id = ?', [userId]);
    if (rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }

    const user = rows[0];

    const isCurrentValid = await bcrypt.compare(currentPassword, user.password_hash || '');
    if (!isCurrentValid) {
      return res.status(400).json({ error: 'Current password is incorrect.' });
    }

    const newHash = await bcrypt.hash(newPassword, 12);

    // Update password and increment version
    await pool.query(
      `UPDATE users 
       SET password_hash = ?, 
           token_version = token_version + 1,
           failed_login_attempts = 0,
           locked_until = NULL
       WHERE id = ?`,
      [newHash, userId]
    );

    // Revoke all other device sessions except this one
    await pool.query('DELETE FROM refresh_tokens WHERE user_id = ? AND id != ?', [userId, currentSessionId || 0]);

    // Send security alert
    sendPasswordChangedAlert({
      to: user.email,
      name: user.name,
      ipAddress: req.ip,
    }).catch((err) => {
      console.warn('[Change Password] Notice sending alert email:', err.message);
    });

    // Generate fresh access token with the incremented version for current device
    const [versionRows] = await pool.query('SELECT token_version FROM users WHERE id = ?', [userId]);
    const newVersion = versionRows[0]?.token_version || 1;

    const newAccessToken = generateAccessToken({
      userId,
      tokenVersion: newVersion,
      sessionId: currentSessionId,
    });

    const clientType = req.headers['x-client-type'];
    if (clientType === 'web') {
      res.cookie('accessToken', newAccessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/',
        maxAge: 15 * 60 * 1000,
      });
    }

    return res.status(200).json({
      message: 'Password changed successfully. All other devices have been logged out.',
      accessToken: newAccessToken,
    });
  } catch (error) {
    console.error('Error changing password:', error);
    return res.status(500).json({ error: 'Failed to change password. Please try again.' });
  }
};

// ========================================================
// 3. REFRESH TOKEN & LOGOUT FLOWS
// ========================================================

/**
 * POST /auth/refresh-token
 * Extend active device session and issue new Access Token
 */
exports.refreshToken = async (req, res) => {
  const clientType = req.headers['x-client-type'];
  let refreshToken = req.body?.refreshToken;

  if (!refreshToken && clientType === 'web' && req.cookies && req.cookies.refreshToken) {
    refreshToken = req.cookies.refreshToken;
  }

  if (!refreshToken) {
    return res.status(400).json({ error: 'Refresh token is required' });
  }

  try {
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

    // Query active session and current user status
    const [rows] = await pool.query(
      `SELECT r.*, u.token_version, u.is_active, u.is_deleted
       FROM refresh_tokens r
       JOIN users u ON r.user_id = u.id
       WHERE r.token_hash = ? AND r.expires_at > NOW() AND r.is_revoked = 0
       LIMIT 1`,
      [tokenHash]
    );

    if (rows.length === 0 || rows[0].is_deleted === 1) {
      return res.status(401).json({ error: 'Invalid or expired session. Please log in again.' });
    }

    const session = rows[0];

    if (session.is_active === 0) {
      return res.status(403).json({ error: 'Account has been deactivated.' });
    }

    // Issue new Access Token linked to current session and token version
    const accessToken = generateAccessToken({
      userId: session.user_id,
      tokenVersion: session.token_version,
      sessionId: session.id,
    });

    // Sliding window: extend session expiry by 30 days and update last_used_at
    await pool.query(
      'UPDATE refresh_tokens SET expires_at = DATE_ADD(NOW(), INTERVAL 30 DAY), last_used_at = NOW() WHERE id = ?',
      [session.id]
    );

    if (clientType === 'web') {
      const cookieOptions = {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/',
      };
      res.cookie('accessToken', accessToken, { ...cookieOptions, maxAge: 15 * 60 * 1000 });
      res.cookie('refreshToken', refreshToken, { ...cookieOptions, maxAge: 30 * 24 * 60 * 60 * 1000 });
    }

    return res.status(200).json({
      message: 'Token refreshed successfully',
      accessToken,
      refreshToken,
    });
  } catch (error) {
    console.error('Error refreshing token:', error);
    return res.status(500).json({ error: 'Failed to refresh token' });
  }
};

/**
 * POST /auth/logout
 * Logs out calling device (deletes device session)
 */
exports.logout = async (req, res) => {
  let userId = null;
  let sessionId = null;

  try {
    let token = req.headers.authorization?.split(' ')[1];
    const clientType = req.headers['x-client-type'];
    if (clientType === 'web' && req.cookies && req.cookies.accessToken) {
      token = req.cookies.accessToken;
    }
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET, { ignoreExpiration: true });
      userId = decoded.id;
      sessionId = decoded.sid;
    }
  } catch (err) {
    // Ignore verification errors on logout
  }

  let { refreshToken, pushToken } = req.body || {};
  const clientType = req.headers['x-client-type'];

  try {
    // 1. Clear Web HttpOnly cookies
    if (clientType === 'web') {
      if (req.cookies && req.cookies.refreshToken) {
        refreshToken = req.cookies.refreshToken;
      }
      const cookieOptions = {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/',
      };
      res.cookie('accessToken', '', { ...cookieOptions, maxAge: 0 });
      res.cookie('refreshToken', '', { ...cookieOptions, maxAge: 0 });
    }

    // 2. Delete this specific session by refreshToken hash or sessionId
    if (refreshToken) {
      const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
      await pool.query('DELETE FROM refresh_tokens WHERE token_hash = ?', [tokenHash]);
    } else if (sessionId) {
      await pool.query('DELETE FROM refresh_tokens WHERE id = ?', [sessionId]);
    }

    // 3. Delete push token if provided
    if (pushToken && userId) {
      await pool.query('DELETE FROM user_push_tokens WHERE push_token = ? AND user_id = ?', [pushToken, userId]);
    }

    return res.status(200).json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Error during logout:', error);
    return res.status(500).json({ error: 'Failed to logout' });
  }
};

/**
 * POST /auth/logout-all
 * Logs out from all devices simultaneously (increments token_version & purges all refresh tokens)
 */
exports.logoutAll = async (req, res) => {
  const userId = req.user.id;
  const clientType = req.headers['x-client-type'];

  try {
    // 1. Increment global token_version to invalidate all issued access tokens
    await pool.query('UPDATE users SET token_version = token_version + 1 WHERE id = ?', [userId]);

    // 2. Delete all refresh tokens for this user
    await pool.query('DELETE FROM refresh_tokens WHERE user_id = ?', [userId]);

    // 3. Clear cookies for Web
    if (clientType === 'web') {
      const cookieOptions = {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/',
      };
      res.cookie('accessToken', '', { ...cookieOptions, maxAge: 0 });
      res.cookie('refreshToken', '', { ...cookieOptions, maxAge: 0 });
    }

    return res.status(200).json({ message: 'Logged out from all devices successfully' });
  } catch (error) {
    console.error('Error during logoutAll:', error);
    return res.status(500).json({ error: 'Failed to logout all devices' });
  }
};

// ========================================================
// 4. LEGACY OTP FLOWS (Preserved for backward compatibility)
// ========================================================

exports.sendOtp = async (req, res) => {
  let { phone } = req.body;
  phone = phone.replace(/[^+\d]/g, '');

  try {
    const verification = await sendPhoneVerificationOtp(phone);
    res.status(200).json({ message: 'OTP sent successfully', status: verification.status });
  } catch (error) {
    console.error('Error sending OTP:', error);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
};

exports.verifyOtp = async (req, res) => {
  let { phone, code } = req.body;
  phone = phone.replace(/[^+\d]/g, '');

  try {
    const isValid = await verifyPhoneOtpCode(phone, code);

    if (!isValid) {
      return res.status(401).json({ error: 'Invalid OTP' });
    }

    const [rows] = await pool.query('SELECT * FROM users WHERE phone_number = ?', [phone]);
    let userRecord = null;

    if (rows.length === 0) {
      const tempEmail = `user_${Date.now().toString(36)}@moneylog.local`;
      const dummyPasswordHash = await bcrypt.hash(uuidv4(), 10);

      const [insertResult] = await pool.query(
        'INSERT INTO users (phone_number, email, password_hash) VALUES (?, ?, ?)',
        [phone, tempEmail, dummyPasswordHash]
      );
      const [newUser] = await pool.query('SELECT * FROM users WHERE id = ?', [insertResult.insertId]);
      userRecord = newUser[0];
      await seedDefaultCategories(userRecord.id);
    } else {
      userRecord = rows[0];
    }

    const { sessionId, refreshToken } = await createDeviceSession({ userId: userRecord.id, req });
    const accessToken = generateAccessToken({
      userId: userRecord.id,
      tokenVersion: userRecord.token_version,
      sessionId,
    });

    return handleAuthResponse({
      res,
      req,
      accessToken,
      refreshToken,
      user: userRecord,
      message: 'OTP verified successfully',
    });
  } catch (error) {
    console.error('Error verifying OTP:', error);
    res.status(500).json({ error: 'Failed to verify OTP' });
  }
};
