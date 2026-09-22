import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { AppError } from '../src/shared/errors.js';
import { createLogger } from '../src/shared/logger.js';

test('login is rate limited after repeated failed attempts', async (t) => {
  const app = createApp({
    config: { corsOrigins: ['http://localhost'] },
    logger: createLogger('silent'),
    tokens: { verifyAccessToken() { throw new Error('not used'); } },
    authService: { async login() { throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.'); } }
  });
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const url = `http://127.0.0.1:${server.address().port}/v1/auth/login`;
  let response;
  for (let attempt = 0; attempt < 21; attempt += 1) {
    response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'student@example.test', password: 'WrongPassword123' }) });
    if (attempt < 20) assert.equal(response.status, 401);
  }
  assert.equal(response.status, 429);
  assert.equal((await response.json()).error.code, 'AUTH_RATE_LIMITED');
});
