import { User } from '../domains/auth/user.model.js';

export const mongoUserRepository = {
  findActiveByEmail(email) {
    return User.findOne({ email, deletedAt: null }).select('+passwordHash +refreshTokens.tokenHash');
  },
  findActiveById(id) {
    return User.findOne({ _id: id, deletedAt: null }).select('+passwordHash +refreshTokens.tokenHash');
  },
  create(data) { return User.create(data); },
  recordLogin(id) { return User.updateOne({ _id: id, deletedAt: null }, { $set: { lastLoginAt: new Date() } }); },
  async addRefreshToken(userId, token) {
    // Keep a bounded device-session history and remove expired/revoked entries in the same atomic write.
    return User.updateOne({ _id: userId, deletedAt: null }, [
      {
        $set: {
          refreshTokens: {
            $slice: [{ $concatArrays: [{ $filter: { input: '$refreshTokens', as: 'item', cond: { $gt: ['$$item.expiresAt', new Date()] } } }, [token]] }, -10]
          }
        }
      }
    ]);
  },
  rotateRefreshToken(userId, previousJti, previousHash, replacement) {
    return User.updateOne(
      { _id: userId, deletedAt: null, refreshTokens: { $elemMatch: { jti: previousJti, tokenHash: previousHash, revokedAt: null, expiresAt: { $gt: new Date() } } } },
      { $pull: { refreshTokens: { jti: previousJti } }, $push: { refreshTokens: { $each: [replacement], $slice: -10 } } }
    );
  },
  revokeRefreshToken(userId, jti) { return User.updateOne({ _id: userId, deletedAt: null }, { $set: { 'refreshTokens.$[item].revokedAt': new Date() } }, { arrayFilters: [{ 'item.jti': jti, 'item.revokedAt': null }] }); },
  revokeAllRefreshTokens(userId) { return User.updateOne({ _id: userId, deletedAt: null }, { $set: { 'refreshTokens.$[].revokedAt': new Date() } }); }
};
