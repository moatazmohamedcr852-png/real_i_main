import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { User } from '../src/domains/auth/user.model.js';
import { Course } from '../src/domains/courses/course.model.js';
import { Enrollment } from '../src/domains/enrollments/enrollment.model.js';
import { LiveSession } from '../src/domains/live-sessions/live-session.model.js';
import { Poll } from '../src/domains/polls/poll.model.js';
import { PollResponse } from '../src/domains/poll-responses/poll-response.model.js';
import { AttendanceRecord } from '../src/domains/attendance/attendance-record.model.js';
import { calculatePresence } from '../src/domains/attendance/attendance.service.js';
import { classroomRepository, withClassroomTransaction } from '../src/domains/virtual-classroom/virtual-classroom.repository.js';
import { createVirtualClassroomService } from '../src/domains/virtual-classroom/virtual-classroom.service.js';

let mongo; let clock; let service;
const models = [User, Course, Enrollment, LiveSession, Poll, PollResponse, AttendanceRecord];
const config = { JITSI_JWT_SECRET: 'j'.repeat(40), JITSI_APP_ID: 'real-i', JITSI_DOMAIN: 'meet.real-i.test' };
before(async () => { mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } }); await mongoose.connect(mongo.getUri(), { dbName: 'real_i_classroom_tests' }); await Promise.all(models.map((model) => model.syncIndexes())); });
beforeEach(async () => { await Promise.all(models.map((model) => model.deleteMany({}))); clock = new Date('2026-04-01T10:00:00Z'); service = createVirtualClassroomService({ repo: classroomRepository, transaction: withClassroomTransaction, config, now: () => new Date(clock), logger: { info() {} } }); });
after(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop(); });

async function fixture() {
  const [instructor, student, outsider] = await User.create([
    { name: 'Teacher', email: 'class-teacher@example.test', passwordHash: 'x'.repeat(60), role: 'instructor' },
    { name: 'Learner', email: 'class-student@example.test', passwordHash: 'x'.repeat(60), role: 'student' },
    { name: 'Outsider', email: 'class-outsider@example.test', passwordHash: 'x'.repeat(60), role: 'student' }
  ]);
  const course = await Course.create({ title: 'Live course', description: 'Course', instructorId: instructor._id, status: 'published', publishedAt: clock });
  await Enrollment.create({ studentId: student._id, courseId: course._id });
  const session = await service.createSession({ userId: instructor._id, role: 'instructor' }, { courseId: course._id, title: 'Live class', providerRoomId: 'real-i-live-class', startsAt: clock, endsAt: new Date(clock.getTime() + 3600 * 1000) });
  return { instructor: { userId: instructor._id, role: 'instructor' }, student: { userId: student._id, role: 'student' }, outsider: { userId: outsider._id, role: 'student' }, course, session };
}

test('Jitsi token binds the room, expires, and never grants a student moderator access', async () => {
  const { instructor, student, outsider, session } = await fixture();
  const studentJoin = await service.issueJoinToken(student, session._id);
  const studentClaims = jwt.verify(studentJoin.token, config.JITSI_JWT_SECRET, { audience: config.JITSI_APP_ID, issuer: config.JITSI_APP_ID, clockTimestamp: Math.floor(clock.getTime() / 1000) });
  assert.equal(studentClaims.room, 'real-i-live-class');
  assert.equal(studentClaims.sub, config.JITSI_DOMAIN);
  assert.equal(studentClaims.context.user.id, String(student.userId));
  assert.equal(studentClaims.context.user.moderator, false);
  assert.ok(studentClaims.exp * 1000 <= clock.getTime() + 5 * 60 * 1000);
  assert.throws(() => jwt.verify(`${studentJoin.token}tampered`, config.JITSI_JWT_SECRET, { audience: config.JITSI_APP_ID, issuer: config.JITSI_APP_ID, clockTimestamp: Math.floor(clock.getTime() / 1000) }));
  assert.throws(() => jwt.verify(studentJoin.token, config.JITSI_JWT_SECRET, { audience: config.JITSI_APP_ID, issuer: config.JITSI_APP_ID, clockTimestamp: studentClaims.exp + 1 }), { name: 'TokenExpiredError' });
  const moderatorJoin = await service.issueJoinToken(instructor, session._id);
  assert.equal(jwt.decode(moderatorJoin.token).context.user.moderator, true);
  await assert.rejects(() => service.issueJoinToken(outsider, session._id), { code: 'FORBIDDEN' });
});

test('attendance calculates reconnect intervals and poll vote/tally use the session flow', async () => {
  const { instructor, student, session } = await fixture();
  await service.recordJoin(student, session._id);
  clock = new Date(clock.getTime() + 600 * 1000);
  await service.recordLeave(student, session._id);
  clock = new Date(clock.getTime() + 300 * 1000);
  await service.recordJoin(student, session._id);
  clock = new Date(clock.getTime() + 300 * 1000);
  const presence = await service.recordLeave(student, session._id);
  assert.equal(presence.totalSeconds, 900);
  assert.equal(presence.presencePercentage, 25);
  const poll = await service.createPoll(instructor, session._id, { question: 'Continue?', responseType: 'single_choice', options: [{ key: 'yes', label: 'Yes' }, { key: 'no', label: 'No' }], status: 'open' });
  await service.vote(student, session._id, poll._id, { optionKeys: ['yes'] });
  await assert.rejects(() => service.vote(student, session._id, poll._id, { optionKeys: ['no'] }), { code: 'VOTE_ALREADY_RECORDED' });
  const tally = await service.tally(instructor, session._id, poll._id);
  assert.deepEqual(tally.options.map((item) => [item.key, item.count]), [['yes', 1], ['no', 0]]);
  const plan = await classroomRepository.tallyPlan(poll._id);
  assert.match(JSON.stringify(plan), /poll_response_tally_by_option/);
});

test('presence calculation clamps active intervals to the scheduled session duration', () => {
  const presence = calculatePresence({ intervals: [], activeJoinedAt: new Date('2026-04-01T09:50:00Z') }, { startsAt: new Date('2026-04-01T10:00:00Z'), endsAt: new Date('2026-04-01T11:00:00Z') }, new Date('2026-04-01T12:00:00Z'));
  assert.equal(presence.totalSeconds, 3600);
  assert.equal(presence.presencePercentage, 100);
});
