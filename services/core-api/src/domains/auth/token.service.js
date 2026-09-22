import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { AppError } from '../../shared/errors.js';

const ACCESS_TTL = '15m';
const REFRESH_TTL = '7d';

export function tokenHash(token) { return crypto.createHash('sha256').update(token).digest('hex'); }

export function createTokenService(config) {
  const sign = (user, type) => {
    const jti = crypto.randomUUID();
    const secret = type === 'access' ? config.JWT_ACCESS_SECRET : config.JWT_REFRESH_SECRET;
    const expiresIn = type === 'access' ? ACCESS_TTL : REFRESH_TTL;
    const token = jwt.sign({ sub: String(user._id), role: user.role, type, jti }, secret, { issuer: 'real-i-core-api', audience: 'real-i', expiresIn });
    return { token, jti, expiresAt: new Date(Date.now() + (type === 'access' ? 15 : 7 * 24 * 60) * 60 * 1000) };
  };
  const verify = (token, type) => {
    try {
      const decoded = jwt.verify(token, type === 'access' ? config.JWT_ACCESS_SECRET : config.JWT_REFRESH_SECRET, { issuer: 'real-i-core-api', audience: 'real-i' });
      if (decoded.type !== type || !decoded.sub || !decoded.jti) throw new Error('Wrong token type');
      return decoded;
    } catch { throw new AppError(401, 'INVALID_TOKEN', 'Invalid or expired token.'); }
  };
  return { createAccessToken: (user) => sign(user, 'access'), createRefreshToken: (user) => sign(user, 'refresh'), verifyAccessToken: (token) => verify(token, 'access'), verifyRefreshToken: (token) => verify(token, 'refresh') };
}
