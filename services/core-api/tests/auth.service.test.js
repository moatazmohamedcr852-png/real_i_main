import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';
import { createAuthService } from '../src/domains/auth/auth.service.js';
import { createTokenService } from '../src/domains/auth/token.service.js';
import { User } from '../src/domains/auth/user.model.js';

const config = { JWT_ACCESS_SECRET: 'a'.repeat(40), JWT_REFRESH_SECRET: 'b'.repeat(40) };
const logger = { warn() {} };

function usersFixture() {
  const records = new Map();
  return {
    records,
    async findActiveByEmail(email) { return [...records.values()].find((user) => user.email === email) ?? null; },
    async findActiveById(id) { return records.get(String(id)) ?? null; },
    async create(data) { const user = { ...data, _id: String(records.size + 1), refreshTokens: [] }; records.set(user._id, user); return user; },
    async recordLogin() { return { modifiedCount: 1 }; },
    async addRefreshToken(id, token) { records.get(String(id)).refreshTokens.push(token); return { modifiedCount: 1 }; },
    async rotateRefreshToken(id, jti, hash, replacement) { const user = records.get(String(id)); const index = user.refreshTokens.findIndex((token) => token.jti === jti && token.tokenHash === hash && !token.revokedAt); if (index === -1) return { modifiedCount: 0 }; user.refreshTokens.splice(index, 1, replacement); return { modifiedCount: 1 }; },
    async revokeRefreshToken(id, jti) { const token = records.get(String(id)).refreshTokens.find((item) => item.jti === jti); if (token) token.revokedAt = new Date(); return { modifiedCount: token ? 1 : 0 }; },
    async revokeAllRefreshTokens(id) { records.get(String(id)).refreshTokens.forEach((token) => { token.revokedAt = new Date(); }); return { modifiedCount: 1 }; }
  };
}

test('registration always assigns the student role and creates a session', async () => {
  const users = usersFixture();
  const service = createAuthService({ users, tokens: createTokenService(config), logger });
  const result = await service.register({ name: 'A Student', email: 'STUDENT@example.test', password: 'ValidPass1234' });
  assert.equal(result.user.role, 'student');
  assert.equal(result.user.email, 'student@example.test');
  assert.ok(result.accessToken);
  assert.equal(users.records.get('1').refreshTokens.length, 1);
});

test('a refresh token rotates once and rejects reuse by revoking sessions', async () => {
  const users = usersFixture();
  const service = createAuthService({ users, tokens: createTokenService(config), logger });
  const registered = await service.register({ name: 'A Student', email: 'student@example.test', password: 'ValidPass1234' });
  const rotated = await service.refresh(registered.refreshToken);
  assert.notEqual(rotated.refreshToken, registered.refreshToken);
  await assert.rejects(() => service.refresh(registered.refreshToken), { code: 'REFRESH_TOKEN_REUSED' });
  assert.ok(users.records.get('1').refreshTokens.every((token) => token.revokedAt));
});

test('invalid, tampered, and expired access tokens are rejected uniformly', () => {
  const tokens = createTokenService(config);
  const valid = tokens.createAccessToken({ _id: 'user-1', role: 'student' }).token;
  const expired = jwt.sign({ sub: 'user-1', role: 'student', type: 'access', jti: 'expired' }, config.JWT_ACCESS_SECRET, { issuer: 'real-i-core-api', audience: 'real-i', expiresIn: '-1s' });
  for (const token of [`${valid}x`, expired]) assert.throws(() => tokens.verifyAccessToken(token), { code: 'INVALID_TOKEN' });
});

test('login failure does not reveal whether the email exists', async () => {
  const users = usersFixture();
  const service = createAuthService({ users, tokens: createTokenService(config), logger });
  await service.register({ name: 'A Student', email: 'student@example.test', password: 'ValidPass1234' });
  const failure = async (email, password) => {
    try { await service.login({ email, password }); } catch (error) { return { code: error.code, message: error.message, status: error.status }; }
    assert.fail('Expected login to fail');
  };
  assert.deepEqual(await failure('student@example.test', 'WrongPassword123'), await failure('missing@example.test', 'WrongPassword123'));
});

test('logout revokes the presented refresh session', async () => {
  const users = usersFixture();
  const service = createAuthService({ users, tokens: createTokenService(config), logger });
  const registered = await service.register({ name: 'A Student', email: 'student@example.test', password: 'ValidPass1234' });
  const claims = createTokenService(config).verifyRefreshToken(registered.refreshToken);
  await service.logout('1', claims.jti);
  await assert.rejects(() => service.refresh(registered.refreshToken), { code: 'REFRESH_TOKEN_REUSED' });
});

test('Users has a named unique index on canonical email', () => {
  const emailIndex = User.schema.indexes().find(([keys, options]) => keys.email === 1 && options.name === 'user_unique_email');
  assert.equal(emailIndex?.[1].unique, true);
});
