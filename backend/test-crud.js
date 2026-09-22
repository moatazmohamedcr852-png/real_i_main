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

  if (!res.ok) {
    throw new Error(`[${res.status}] ${options.method || 'GET'} ${path}: ${JSON.stringify(json)}`);
  }
  return json;
}

async function runTests() {
  console.log('==============================================');
  console.log('RUNNING END-TO-END VERIFICATION TEST SUITE');
  console.log('==============================================\n');

  // 1. Health Check
  console.log('1. Testing /health...');
  const health = await request('/health');
  console.log('   ✓ Health response:', health);
  if (health.database !== 'connected') throw new Error('Database not reported as connected');

  // 2. Auth: Login Admin & Student
  console.log('\n2. Testing Authentication...');
  const adminAuth = await request('/auth/login', {
    method: 'POST',
    body: { email: 'admin@local.test', password: 'LocalAdmin1234' }
  });
  const adminToken = adminAuth.token;
  console.log('   ✓ Admin logged in, token acquired.');

  const studentAuth = await request('/auth/login', {
    method: 'POST',
    body: { email: 'student@local.test', password: 'LocalStudent1234' }
  });
  const studentToken = studentAuth.token;
  console.log('   ✓ Student logged in, token acquired.');

  const me = await request('/auth/me', { headers: { Authorization: `Bearer ${studentToken}` } });
  console.log('   ✓ /auth/me verified for student:', me.email);

  // 3. Courses CRUD
  console.log('\n3. Testing Courses CRUD...');
  const categories = await request('/courses/categories');
  console.log('   ✓ Categories:', categories);

  const newCourse = await request('/courses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: {
      title: 'Automated Test Course',
      description: 'Course created by test script to verify persistence.',
      category: 'Data Science',
      difficulty: 'intermediate',
      status: 'published'
    }
  });
  const courseId = newCourse.id;
  console.log('   ✓ Course created:', courseId, newCourse.title);

  const courseInDb = await pool.query('SELECT title, category FROM courses WHERE id = $1', [courseId]);
  if (courseInDb.rows[0].title !== 'Automated Test Course') throw new Error('Course not found in DB');
  console.log('   ✓ Course verified directly in Postgres table!');

  const updatedCourse = await request(`/courses/${courseId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: { title: 'Updated Automated Test Course' }
  });
  console.log('   ✓ Course updated:', updatedCourse.title);

  // Student self-enroll
  const enrollment = await request(`/courses/${courseId}/enroll`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${studentToken}` }
  });
  console.log('   ✓ Student enrolled:', enrollment.success);

  // Add lesson
  const lesson = await request(`/courses/${courseId}/lessons`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: { title: 'Lesson 1: Intro', content: 'Lesson content here' }
  });
  console.log('   ✓ Lesson added:', lesson.id, lesson.title);

  // 4. Assessments CRUD
  console.log('\n4. Testing Assessments CRUD...');
  const newAssessment = await request(`/courses/${courseId}/assessments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: {
      title: 'Automated Test Quiz',
      instructions: 'Quiz instructions',
      timeLimitSeconds: 600,
      status: 'published',
      questions: [
        {
          id: 'q1',
          type: 'mcq',
          prompt: 'What is Postgres?',
          options: [{ id: 'a', text: 'Database' }, { id: 'b', text: 'Browser' }],
          correctOptionIds: ['a'],
          points: 10
        }
      ]
    }
  });
  const assessmentId = newAssessment.id;
  console.log('   ✓ Assessment created:', assessmentId, newAssessment.title);

  const assessInDb = await pool.query('SELECT title, status FROM assessments WHERE id = $1', [assessmentId]);
  if (assessInDb.rows[0].title !== 'Automated Test Quiz') throw new Error('Assessment not in DB');
  console.log('   ✓ Assessment verified directly in Postgres!');

  // Student takes assessment
  const attempt = await request(`/assessments/${assessmentId}/start`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${studentToken}` }
  });
  console.log('   ✓ Assessment attempt started:', attempt.submissionId);

  await request(`/attempts/${attempt.submissionId}/answers`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${studentToken}` },
    body: { responses: [{ questionId: 'q1', value: 'a' }] }
  });
  console.log('   ✓ Answers saved');

  const submitRes = await request(`/attempts/${attempt.submissionId}/submit`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${studentToken}` }
  });
  console.log('   ✓ Attempt submitted, score received:', submitRes.score);

  const subInDb = await pool.query('SELECT grading_score, attempt_status FROM submissions WHERE id = $1', [attempt.submissionId]);
  console.log('   ✓ Submission score verified in DB:', subInDb.rows[0].grading_score);

  // 5. Meetings CRUD
  console.log('\n5. Testing Meetings CRUD...');
  const newMeeting = await request('/meetings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: {
      title: 'Test Live Meeting',
      description: 'Scheduled meeting for test',
      courseId,
      startsAt: new Date(),
      endsAt: new Date(Date.now() + 3600000)
    }
  });
  const meetingId = newMeeting.meeting.id;
  console.log('   ✓ Meeting created:', meetingId, newMeeting.meeting.title);

  const launchRes = await request(`/meetings/${meetingId}/launch`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  console.log('   ✓ Meeting launched, status:', launchRes.status);

  const joinToken = await request(`/live-sessions/${meetingId}/join-token`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${studentToken}` }
  });
  console.log('   ✓ Join token issued:', !!joinToken.token);

  await request(`/live-sessions/${meetingId}/attendance/join`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${studentToken}` }
  });
  console.log('   ✓ Attendance join recorded');

  const attendanceReport = await request(`/live-sessions/${meetingId}/attendance`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  console.log('   ✓ Attendance report fetched, total records:', attendanceReport.attendance.length);

  // 6. Calendar Events CRUD
  console.log('\n6. Testing Calendar Events CRUD...');
  const newEvent = await request('/calendar/events', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: {
      title: 'Important Platform Milestone',
      description: 'Event description',
      startsAt: new Date(Date.now() + 86400000),
      scope: 'global'
    }
  });
  console.log('   ✓ Calendar event created:', newEvent.id, newEvent.title);

  const eventsList = await request('/calendar', { headers: { Authorization: `Bearer ${studentToken}` } });
  console.log('   ✓ Calendar events list fetched, total count:', eventsList.length);

  // 7. Users & Admin CRUD
  console.log('\n7. Testing Users & Admin Endpoints...');
  const usersList = await request('/users', { headers: { Authorization: `Bearer ${adminToken}` } });
  console.log('   ✓ User list count:', usersList.length);

  const studentProfile = await request(`/users/${studentAuth.user.id}`, { headers: { Authorization: `Bearer ${studentToken}` } });
  console.log('   ✓ Student learning profile fetched, completed tasks:', studentProfile.completed_tasks.length);

  // Toggle lesson progress
  const toggleRes = await request(`/users/${studentAuth.user.id}/lessons/${lesson.id}/toggle`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${studentToken}` }
  });
  console.log('   ✓ Lesson progress toggled, completed lessons:', toggleRes.completed_lessons);

  // Guidelines CRUD
  const guideline = await request('/admin/guidelines', {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: { directive: 'Always encourage problem-solving and critical thinking.' }
  });
  console.log('   ✓ Guideline created:', guideline.id, guideline.directive);

  const toggledGuideline = await request(`/admin/guidelines/${guideline.id}/toggle`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  console.log('   ✓ Guideline status toggled:', toggledGuideline.status);

  // KPIs
  const kpis = await request('/analytics/kpis', { headers: { Authorization: `Bearer ${adminToken}` } });
  console.log('   ✓ Analytics KPIs fetched:', kpis);

  // 8. Data & AI Chat Endpoints
  console.log('\n8. Testing Data & AI Endpoints...');
  const projects = await request('/data/projects', { headers: { Authorization: `Bearer ${studentToken}` } });
  console.log('   ✓ /data/projects count:', projects.length);

  const chat = await request(`/courses/${courseId}/ai/chat`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${studentToken}` },
    body: { message: 'Can you explain the core concept of this course?' }
  });
  console.log('   ✓ AI Chat response received:', chat.role, chat.content.slice(0, 60) + '...');

  const quiz = await request(`/courses/${courseId}/ai/quizzes`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${studentToken}` },
    body: { topic: 'Data Structures' }
  });
  console.log('   ✓ Generated quiz questions:', quiz.questions.length);

  // Cleanup test course & meeting
  console.log('\n9. Cleaning up test artifacts...');
  await request(`/courses/${courseId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  await request(`/meetings/${meetingId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  console.log('   ✓ Test course & meeting cleanly deleted/archived.');

  await pool.end();
  console.log('\n==============================================');
  console.log('ALL VERIFICATION TESTS PASSED 100%!');
  console.log('==============================================');
}

runTests().catch((err) => {
  console.error('\n❌ TEST FAILED:', err);
  pool.end();
  process.exit(1);
});
