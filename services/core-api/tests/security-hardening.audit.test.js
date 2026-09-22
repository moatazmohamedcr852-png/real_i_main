import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import { createLogger } from '../src/shared/logger.js';

const id = '507f1f77bcf86cd799439011';
const tokens = { verifyAccessToken() { return { sub: 'audit-student', role: 'student', jti: 'audit-token' }; } };
const config = { corsOrigins: ['http://localhost:5173'] };

async function serverFor(t, services = {}) {
  const app = createApp({
    config,
    logger: createLogger('silent'),
    tokens,
    authService: { async logout() {}, async login() {}, async register() {}, async refresh() {}, async getUser() {}, ...services.authService },
    ...services
  });
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  return `http://127.0.0.1:${server.address().port}`;
}

test('audit regression: logout rejects an unexpected body and CORS only emits the configured origin', async (t) => {
  const base = await serverFor(t);
  const logout = await fetch(`${base}/v1/auth/logout`, { method: 'POST', headers: { authorization: 'Bearer audit', 'content-type': 'application/json' }, body: JSON.stringify({ ignored: true }) });
  assert.equal(logout.status, 400);
  assert.equal((await logout.json()).error.code, 'VALIDATION_ERROR');
  const allowed = await fetch(`${base}/health`, { headers: { origin: 'http://localhost:5173' } });
  const denied = await fetch(`${base}/health`, { headers: { origin: 'https://untrusted.example' } });
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  assert.equal(denied.headers.get('access-control-allow-origin'), null);
});

test('audit regression: assessment-start and poll-vote limits are keyed to the authenticated user', async (t) => {
  const base = await serverFor(t, {
    assessmentService: { async start() { return { id: 'attempt' }; } },
    virtualClassroomService: { async vote() { return { id: 'vote' }; } }
  });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetch(`${base}/v1/assessments/${id}/start`, { method: 'POST', headers: { authorization: 'Bearer audit', 'content-type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 201);
  }
  const limitedStart = await fetch(`${base}/v1/assessments/${id}/start`, { method: 'POST', headers: { authorization: 'Bearer audit', 'content-type': 'application/json' }, body: '{}' });
  assert.equal(limitedStart.status, 429);
  assert.equal((await limitedStart.json()).error.code, 'ASSESSMENT_START_RATE_LIMITED');
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await fetch(`${base}/v1/live-sessions/${id}/polls/${id}/votes`, { method: 'POST', headers: { authorization: 'Bearer audit', 'content-type': 'application/json' }, body: JSON.stringify({ optionKeys: ['yes'] }) });
    assert.equal(response.status, 201);
  }
  const limitedVote = await fetch(`${base}/v1/live-sessions/${id}/polls/${id}/votes`, { method: 'POST', headers: { authorization: 'Bearer audit', 'content-type': 'application/json' }, body: JSON.stringify({ optionKeys: ['yes'] }) });
  assert.equal(limitedVote.status, 429);
  assert.equal((await limitedVote.json()).error.code, 'POLL_VOTE_RATE_LIMITED');
});

test('audit regression: centralized error logging records safe metadata, never raw error content', () => {
  const events = [];
  const req = { requestId: 'request-audit', method: 'POST', path: '/v1/attempts/example/answers', auth: { userId: 'student-audit' }, log: { error(value) { events.push(value); } } };
  const response = { status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
  errorHandler(new Error('private essay answer must not reach logs'), req, response, () => {});
  assert.equal(response.statusCode, 500);
  assert.equal(response.body.error.code, 'INTERNAL_ERROR');
  assert.equal(JSON.stringify(events).includes('private essay answer'), false);
  assert.equal(events[0].errorName, 'Error');
});

test('audit regression: environment parsing rejects wildcard or malformed CORS origins', () => {
  const source = { NODE_ENV: 'test', MONGODB_URI: 'mongodb://localhost:27017/real_i', JWT_ACCESS_SECRET: 'a'.repeat(32), JWT_REFRESH_SECRET: 'b'.repeat(32), JITSI_JWT_SECRET: 'c'.repeat(32), JITSI_APP_ID: 'real-i', JITSI_DOMAIN: 'meet.example.test', CORS_ORIGINS: 'http://localhost:5173' };
  assert.deepEqual(loadEnv(source).corsOrigins, ['http://localhost:5173']);
  assert.throws(() => loadEnv({ ...source, CORS_ORIGINS: '*' }), /wildcard/);
  assert.throws(() => loadEnv({ ...source, CORS_ORIGINS: 'localhost:5173' }), /absolute HTTP/);
});
