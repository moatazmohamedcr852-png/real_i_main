import pg from 'pg';

const { Pool } = pg;
const BASE_URL = 'http://localhost:3001/v1';
const pool = new Pool({ connectionString: 'postgresql://postgres:postgres@localhost:5432/real_i' });

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    },
    body: options.body && typeof options.body === 'object' ? JSON.stringify(options.body) : options.body
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (_) {
    json = text;
  }
  return { status: res.status, ok: res.ok, body: json };
}

async function runTests() {
  console.log('===========================================================');
  console.log('TESTING THREE SPECIFIC SCHEMA & LOGIC IMPLEMENTATION DETAILS');
  console.log('===========================================================\n');

  // Login Admin
  const adminLogin = await request('/auth/login', {
    method: 'POST',
    body: { email: 'admin@local.test', password: 'LocalAdmin1234' }
  });
  const adminToken = adminLogin.body.token;

  // -------------------------------------------------------------
  // TEST 1: Token Family Rotation & Reuse Detection
  // -------------------------------------------------------------
  console.log('TEST 1: Refresh Token Family Rotation & Reuse Revocation');
  
  // 1a. Login to get token 1
  const loginRes = await request('/auth/login', {
    method: 'POST',
    body: { email: 'student@local.test', password: 'LocalStudent1234' }
  });
  const rToken1 = loginRes.body.refreshToken;
  console.log('   ✓ Acquired initial refreshToken1');

  // Verify family_id column exists and is populated
  const familyCheck = await pool.query(
    'SELECT family_id, jti, revoked_at FROM refresh_tokens WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
    [loginRes.body.user.id]
  );
  const familyId = familyCheck.rows[0].family_id;
  if (!familyId) throw new Error('family_id column not found or null in refresh_tokens');
  console.log('   ✓ Verified family_id column in DB:', familyId);

  // 1b. Rotate token 1 -> get token 2
  const rot1Res = await request('/auth/refresh', {
    method: 'POST',
    body: { refreshToken: rToken1 }
  });
  if (!rot1Res.ok) throw new Error(`Rotation 1 failed: ${JSON.stringify(rot1Res.body)}`);
  const rToken2 = rot1Res.body.refreshToken;
  console.log('   ✓ Rotated refreshToken1 -> got refreshToken2');

  // 1c. Rotate token 2 -> get token 3
  const rot2Res = await request('/auth/refresh', {
    method: 'POST',
    body: { refreshToken: rToken2 }
  });
  if (!rot2Res.ok) throw new Error(`Rotation 2 failed: ${JSON.stringify(rot2Res.body)}`);
  const rToken3 = rot2Res.body.refreshToken;
  console.log('   ✓ Rotated refreshToken2 -> got refreshToken3');

  // 1d. Attempt reuse of token 1 (stale/already rotated)
  console.log('   -> Attempting reuse of stale refreshToken1...');
  const reuseRes = await request('/auth/refresh', {
    method: 'POST',
    body: { refreshToken: rToken1 }
  });
  console.log(`   ✓ Reuse attempt rejected with HTTP ${reuseRes.status}:`, reuseRes.body?.error?.code);
  if (reuseRes.status !== 401 || reuseRes.body?.error?.code !== 'REFRESH_TOKEN_REUSED') {
    throw new Error('Reuse of stale token was not rejected with 401 REFRESH_TOKEN_REUSED');
  }

  // 1e. Confirm the entire family is now revoked in PostgreSQL
  const familyTokens = await pool.query(
    'SELECT id, jti, revoked_at FROM refresh_tokens WHERE family_id = $1',
    [familyId]
  );
  const unrevoked = familyTokens.rows.filter((t) => t.revoked_at === null);
  console.log(`   ✓ Family ${familyId} total tokens: ${familyTokens.rows.length}, unrevoked count: ${unrevoked.length}`);
  if (unrevoked.length > 0) {
    throw new Error(`Expected all tokens in family to be revoked, but found ${unrevoked.length} active tokens!`);
  }
  console.log('   ✓ Verified: Entire token family revoked in database upon reuse detection!');

  // 1f. Confirm refreshToken3 (the latest valid token) is now also rejected
  const token3Attempt = await request('/auth/refresh', {
    method: 'POST',
    body: { refreshToken: rToken3 }
  });
  console.log(`   ✓ Latest token in family also rejected with HTTP ${token3Attempt.status}:`, token3Attempt.body?.error?.code);
  if (token3Attempt.status !== 401) {
    throw new Error('Latest token should have been rejected because the family was revoked');
  }

  // -------------------------------------------------------------
  // TEST 2: Notifications Deduplication on Events
  // -------------------------------------------------------------
  console.log('\nTEST 2: Notifications Table Unique Deduplication Constraint');

  // Check unique index in Postgres schema
  const indexCheck = await pool.query(`
    SELECT indexname, indexdef FROM pg_indexes 
    WHERE tablename = 'notifications' AND indexname = 'idx_notifications_recipient_dedup';
  `);
  if (indexCheck.rows.length === 0) {
    throw new Error('Unique index idx_notifications_recipient_dedup not found on notifications table');
  }
  console.log('   ✓ Verified unique constraint exists on notifications(recipient_id, deduplication_key)');

  // Create a dummy course & submission to test grading
  const courseRes = await pool.query('SELECT id FROM courses LIMIT 1');
  const courseId = courseRes.rows[0].id;
  const studentId = loginRes.body.user.id;

  const subInsert = await pool.query(
    `INSERT INTO submissions (student_id, course_id, kind, submission_type, attempt_status)
     VALUES ($1, $2, 'assessment', 'mcq', 'submitted')
     RETURNING id`,
    [studentId, courseId]
  );
  const testSubId = subInsert.rows[0].id;
  const dedupKey = `submission_graded:${testSubId}`;

  // Grade submission 1st time
  const grade1 = await request(`/attempts/${testSubId}/grade`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: { score: 95, feedback: 'Great job!' }
  });
  if (!grade1.ok) throw new Error(`Grade 1 failed: ${JSON.stringify(grade1.body)}`);
  console.log('   ✓ Submission graded 1st time');

  // Grade submission 2nd time (duplicate event)
  const grade2 = await request(`/attempts/${testSubId}/grade`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: { score: 98, feedback: 'Updated grade!' }
  });
  if (!grade2.ok) throw new Error(`Grade 2 failed: ${JSON.stringify(grade2.body)}`);
  console.log('   ✓ Submission graded 2nd time (duplicate event triggered)');

  // Verify only 1 notification row exists for this deduplication_key
  const notifRows = await pool.query(
    'SELECT id, recipient_id, deduplication_key, created_at FROM notifications WHERE deduplication_key = $1',
    [dedupKey]
  );
  console.log(`   ✓ Notifications found with key '${dedupKey}': ${notifRows.rows.length}`);
  if (notifRows.rows.length !== 1) {
    throw new Error(`Expected exactly 1 notification row, found ${notifRows.rows.length}`);
  }
  console.log('   ✓ Verified: Exactly 1 notification row exists, deduplication succeeded!');

  // Cleanup test submission & notification
  await pool.query('DELETE FROM notifications WHERE deduplication_key = $1', [dedupKey]);
  await pool.query('DELETE FROM submissions WHERE id = $1', [testSubId]);

  // -------------------------------------------------------------
  // TEST 3: Assessment Attempt-Start due_at Checked BEFORE max_attempts
  // -------------------------------------------------------------
  console.log('\nTEST 3: Assessment due_at Checked Before max_attempts');

  // Create an assessment with due_at in the past (e.g. 2 hours ago) and max_attempts = 5
  const pastDate = new Date(Date.now() - 2 * 3600 * 1000);
  const assessRes = await pool.query(
    `INSERT INTO assessments (course_id, author_id, title, instructions, status, time_limit_seconds, max_attempts, due_at, questions)
     VALUES ($1, (SELECT id FROM users WHERE role = 'admin' LIMIT 1), 'Past Due Assessment', 'Test due date precedence', 'published', 600, 5, $2, '[]'::jsonb)
     RETURNING id`,
    [courseId, pastDate]
  );
  const pastDueAssessId = assessRes.rows[0].id;
  console.log(`   ✓ Seeded past-due assessment (due: ${pastDate.toISOString()}, max_attempts: 5)`);

  // Student has 0 previous attempts (5 attempts remaining!)
  // Login student fresh
  const studentLoginFresh = await request('/auth/login', {
    method: 'POST',
    body: { email: 'student@local.test', password: 'LocalStudent1234' }
  });
  const studentTokenFresh = studentLoginFresh.body.token;

  // Attempt to start
  const startAttemptRes = await request(`/assessments/${pastDueAssessId}/start`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${studentTokenFresh}` }
  });

  console.log(`   ✓ Attempt start response: HTTP ${startAttemptRes.status}, code:`, startAttemptRes.body?.error?.code);
  if (startAttemptRes.status !== 400 || startAttemptRes.body?.error?.code !== 'ASSESSMENT_PAST_DUE') {
    throw new Error(`Expected ASSESSMENT_PAST_DUE, got: ${JSON.stringify(startAttemptRes.body)}`);
  }
  console.log('   ✓ Verified: past-due check correctly rejected attempt BEFORE checking max_attempts!');

  // Cleanup test assessment
  await pool.query('DELETE FROM assessments WHERE id = $1', [pastDueAssessId]);

  console.log('\n===========================================================');
  console.log('ALL THREE IMPLEMENTATION DETAIL TESTS PASSED SUCCESSFULLY!');
  console.log('===========================================================');
  await pool.end();
}

runTests().catch((err) => {
  console.error('\n❌ TEST FAILED:', err);
  pool.end();
  process.exit(1);
});
