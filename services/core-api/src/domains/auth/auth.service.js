import bcrypt from 'bcryptjs';
import { AppError } from '../../shared/errors.js';
import { tokenHash } from './token.service.js';

const publicUser = (user) => ({ id: String(user._id), email: user.email, name: user.name, role: user.role });
const session = (user, tokens) => ({ user: publicUser(user), accessToken: tokens.access.token, refreshToken: tokens.refresh.token, accessTokenExpiresAt: tokens.access.expiresAt, refreshTokenExpiresAt: tokens.refresh.expiresAt });

export function createAuthService({ users, tokens, logger }) {
  const issue = async (user) => {
    const access = tokens.createAccessToken(user);
    const refresh = tokens.createRefreshToken(user);
    const write = await users.addRefreshToken(user._id, { jti: refresh.jti, tokenHash: tokenHash(refresh.token), expiresAt: refresh.expiresAt });
    if (write.modifiedCount !== 1) throw new AppError(503, 'SESSION_PERSISTENCE_FAILED', 'Could not create a session; please retry.');
    return session(user, { access, refresh });
  };
  return {
    async register({ name, email, password }) {
      email = email.trim().toLowerCase();
      const existing = await users.findActiveByEmail(email);
      if (existing) throw new AppError(409, 'EMAIL_ALREADY_REGISTERED', 'An account already exists for this email.');
      try {
        const user = await users.create({ name, email, passwordHash: await bcrypt.hash(password, 12), role: 'student' });
        return issue(user);
      } catch (error) {
        if (error?.code === 11000) throw new AppError(409, 'EMAIL_ALREADY_REGISTERED', 'An account already exists for this email.');
        throw error;
      }
    },
    async login({ email, password }) {
      email = email.trim().toLowerCase();
      const user = await users.findActiveByEmail(email);
      if (!user || !(await bcrypt.compare(password, user.passwordHash))) throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
      await users.recordLogin(user._id);
      return issue(user);
    },
    async refresh(refreshToken) {
      const claims = tokens.verifyRefreshToken(refreshToken);
      const user = await users.findActiveById(claims.sub);
      if (!user) throw new AppError(401, 'INVALID_TOKEN', 'Invalid or expired token.');
      const access = tokens.createAccessToken(user);
      const nextRefresh = tokens.createRefreshToken(user);
      const rotation = await users.rotateRefreshToken(user._id, claims.jti, tokenHash(refreshToken), { jti: nextRefresh.jti, tokenHash: tokenHash(nextRefresh.token), expiresAt: nextRefresh.expiresAt });
      if (rotation.modifiedCount !== 1) {
        await users.revokeAllRefreshTokens(user._id);
        logger.warn({ userId: String(user._id), tokenId: claims.jti }, 'Refresh-token reuse or concurrent rotation detected');
        throw new AppError(401, 'REFRESH_TOKEN_REUSED', 'Session expired; please sign in again.');
      }
      return session(user, { access, refresh: nextRefresh });
    },
    async logout(userId, jti) { await users.revokeRefreshToken(userId, jti); },
    async getUser(userId) {
      const user = await users.findActiveById(userId);
      if (!user) throw new AppError(401, 'UNAUTHORIZED', 'Authentication is required.');
      return publicUser(user);
    }
  };
}
