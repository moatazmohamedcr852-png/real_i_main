import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import { query } from '../db/pool.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

const getAccessSecret = () => process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET || 'access-secret-32-chars-minimum-here';
const getRefreshSecret = () => process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET || 'refresh-secret-32-chars-minimum-here';

function formatUser(u) {
  return {
    id: String(u.id),
    _id: String(u.id),
    email: u.email,
    name: u.name,
    role: u.role,
    avatar: u.avatar || null
  };
}

function hashToken(t) {
  return crypto.createHash('sha256').update(t).digest('hex');
}

function issueTokens(user, familyId = null) {
  const accessJti = crypto.randomUUID();
  const refreshJti = crypto.randomUUID();
  const tokenFamilyId = familyId || crypto.randomUUID();

  const accessToken = jwt.sign(
    { sub: String(user.id), role: user.role, type: 'access', jti: accessJti },
    getAccessSecret(),
    { expiresIn: '15m' }
  );

  const refreshToken = jwt.sign(
    { sub: String(user.id), role: user.role, type: 'refresh', jti: refreshJti, familyId: tokenFamilyId },
    getRefreshSecret(),
    { expiresIn: '7d' }
  );

  return {
    accessToken,
    refreshToken,
    token: accessToken,
    accessJti,
    refreshJti,
    familyId: tokenFamilyId,
    accessTokenExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
    refreshTokenExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  };
}

// POST /register
router.post('/register', async (req, res, next) => {
  try {
    const { name, email, password } = req.body || {};
    if (!name || !email || !password) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Name, email, and password are required.' } });
    }

    const trimmedEmail = email.trim().toLowerCase();
    const trimmedName = name.trim();

    // Check both email and name uniqueness
    const existing = await query(
      'SELECT id, email, name FROM users WHERE email = $1 OR name = $2',
      [trimmedEmail, trimmedName]
    );

    if (existing.rows.length > 0) {
      const conflict = existing.rows[0];
      if (conflict.email === trimmedEmail) {
        return res.status(409).json({ error: { code: 'EMAIL_ALREADY_REGISTERED', message: 'An account already exists for this email.' } });
      }
      if (conflict.name === trimmedName) {
        return res.status(409).json({ error: { code: 'USERNAME_TAKEN', message: 'This name is already taken. Please choose another.' } });
      }
    }

    const hash = await bcrypt.hash(password, 12);
    const result = await query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, 'student')
       RETURNING id, name, email, role, avatar`,
      [name.trim(), trimmedEmail, hash]
    );

    const user = result.rows[0];
    const tokens = issueTokens(user);

    await query(
      `INSERT INTO refresh_tokens (user_id, family_id, jti, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [user.id, tokens.familyId, tokens.refreshJti, hashToken(tokens.refreshToken), tokens.refreshTokenExpiresAt]
    );

    const userObj = formatUser(user);
    res.status(201).json({
      user: userObj,
      ...userObj,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      token: tokens.accessToken,
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
      refreshTokenExpiresAt: tokens.refreshTokenExpiresAt
    });
  } catch (err) {
    next(err);
  }
});

// POST /login
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Email and password are required.' } });
    }

    const trimmedEmail = email.trim().toLowerCase();
    const result = await query(
      `SELECT id, name, email, password_hash, role, avatar
       FROM users
       WHERE email = $1 AND deleted_at IS NULL`,
      [trimmedEmail]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' } });
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' } });
    }

    await query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);

    const tokens = issueTokens(user);
    await query(
      `INSERT INTO refresh_tokens (user_id, family_id, jti, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [user.id, tokens.familyId, tokens.refreshJti, hashToken(tokens.refreshToken), tokens.refreshTokenExpiresAt]
    );

    const userObj = formatUser(user);
    res.status(200).json({
      user: userObj,
      ...userObj,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      token: tokens.accessToken,
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
      refreshTokenExpiresAt: tokens.refreshTokenExpiresAt
    });
  } catch (err) {
    next(err);
  }
});

// POST /refresh
router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body || {};
    if (!refreshToken) {
      return res.status(400).json({ error: { code: 'INVALID_TOKEN', message: 'Refresh token is required.' } });
    }

    let decoded;
    try {
      decoded = jwt.verify(refreshToken, getRefreshSecret());
    } catch (_) {
      return res.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'Invalid or expired refresh token.' } });
    }

    const userId = decoded.sub;
    const jti = decoded.jti;
    const familyId = decoded.familyId || null;
    const tokenHashStr = hashToken(refreshToken);

    const tokenRow = await query(
      `SELECT id, family_id, revoked_at, expires_at
       FROM refresh_tokens
       WHERE jti = $1 AND user_id = $2 AND token_hash = $3`,
      [jti, userId, tokenHashStr]
    );

    if (tokenRow.rows.length === 0) {
      if (familyId) {
        await query('UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1', [familyId]);
      }
      return res.status(401).json({ error: { code: 'REFRESH_TOKEN_REUSED', message: 'Session expired or token reused; please sign in again.' } });
    }

    const currentToken = tokenRow.rows[0];
    const currentFamilyId = currentToken.family_id || familyId;

    // Check if token was ALREADY revoked -> Reuse attack!
    if (currentToken.revoked_at !== null) {
      if (currentFamilyId) {
        await query('UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1', [currentFamilyId]);
      }
      return res.status(401).json({ error: { code: 'REFRESH_TOKEN_REUSED', message: 'Token reuse detected. Entire session family revoked; please sign in again.' } });
    }

    // Check if expired
    if (new Date() > new Date(currentToken.expires_at)) {
      await query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [currentToken.id]);
      return res.status(401).json({ error: { code: 'TOKEN_EXPIRED', message: 'Refresh token has expired.' } });
    }

    // Valid rotation: revoke the current token
    await query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [currentToken.id]);

    const userRes = await query('SELECT id, name, email, role, avatar FROM users WHERE id = $1 AND deleted_at IS NULL', [userId]);
    if (userRes.rows.length === 0) {
      return res.status(401).json({ error: { code: 'USER_NOT_FOUND', message: 'User not found.' } });
    }

    const user = userRes.rows[0];
    const tokens = issueTokens(user, currentFamilyId);

    await query(
      `INSERT INTO refresh_tokens (user_id, family_id, jti, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [user.id, currentFamilyId, tokens.refreshJti, hashToken(tokens.refreshToken), tokens.refreshTokenExpiresAt]
    );

    const userObj = formatUser(user);
    res.status(200).json({
      user: userObj,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      token: tokens.accessToken,
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
      refreshTokenExpiresAt: tokens.refreshTokenExpiresAt
    });
  } catch (err) {
    next(err);
  }
});

// POST /forgot-password
router.post('/forgot-password', async (req, res, next) => {
  try {
    const { email } = req.body || {};
    if (!email) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Email is required.' } });
    }

    const trimmedEmail = email.trim().toLowerCase();
    const result = await query('SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL', [trimmedEmail]);

    if (result.rows.length === 0) {
      return res.status(400).json({ error: { code: 'WRONG_EMAIL', message: 'The email is incorrect.' } });
    }

    const user = result.rows[0];

    // Generate a 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    await query(
      `INSERT INTO password_resets (user_id, otp_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, otpHash, expiresAt]
    );

    // Send email using Gmail
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: trimmedEmail,
      subject: 'Password Reset OTP',
      text: `Your OTP for password reset is: ${otp}. It expires in 15 minutes.\n\nYou can reset your password here: http://localhost:3001/reset-password.html?email=${encodeURIComponent(trimmedEmail)}`
    };

    await transporter.sendMail(mailOptions);
    console.log(`[Email Sent] OTP for ${trimmedEmail} was sent successfully.`);

    res.status(200).json({ message: 'OTP sent to your email.' });
  } catch (err) {
    console.error('Error sending email:', err);
    res.status(500).json({ error: { code: 'EMAIL_SEND_FAILED', message: 'Failed to send OTP email.' } });
  }
});

// POST /reset-password
router.post('/reset-password', async (req, res, next) => {
  try {
    const { email, otp, newPassword } = req.body || {};
    if (!email || !otp || !newPassword) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Email, OTP, and new password are required.' } });
    }

    const trimmedEmail = email.trim().toLowerCase();
    const userResult = await query('SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL', [trimmedEmail]);

    if (userResult.rows.length === 0) {
      return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Invalid OTP or email.' } });
    }
    const user = userResult.rows[0];

    // Find the latest valid OTP
    const resetResult = await query(
      `SELECT id, otp_hash FROM password_resets
       WHERE user_id = $1 AND used_at IS NULL AND expires_at > now()
       ORDER BY created_at DESC LIMIT 1`,
      [user.id]
    );

    if (resetResult.rows.length === 0) {
      return res.status(400).json({ error: { code: 'INVALID_OTP', message: 'Invalid or expired OTP.' } });
    }

    const resetRow = resetResult.rows[0];
    const isMatch = await bcrypt.compare(otp.toString(), resetRow.otp_hash);

    if (!isMatch) {
      return res.status(400).json({ error: { code: 'INVALID_OTP', message: 'Invalid or expired OTP.' } });
    }

    // Update password
    const newHash = await bcrypt.hash(newPassword, 12);
    await query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [newHash, user.id]);

    // Mark OTP as used
    await query('UPDATE password_resets SET used_at = now() WHERE id = $1', [resetRow.id]);

    // Optional: revoke all existing sessions to force re-login
    await query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [user.id]);

    res.status(200).json({ message: 'Password has been reset successfully.' });
  } catch (err) {
    next(err);
  }
});

// POST /logout
router.post('/logout', authenticate, async (req, res, next) => {
  try {
    if (req.auth?.tokenId) {
      await query('UPDATE refresh_tokens SET revoked_at = now() WHERE jti = $1', [req.auth.tokenId]);
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// GET /me
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const userObj = formatUser(req.user);
    res.status(200).json({
      user: userObj,
      ...userObj
    });
  } catch (err) {
    next(err);
  }
});

export default router;
