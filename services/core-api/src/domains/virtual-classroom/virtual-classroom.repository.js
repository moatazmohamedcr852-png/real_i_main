import mongoose from 'mongoose';
import { LiveSession } from '../live-sessions/live-session.model.js';
import { Course } from '../courses/course.model.js';
import { Enrollment } from '../enrollments/enrollment.model.js';
import { User } from '../auth/user.model.js';
import { AttendanceRecord } from '../attendance/attendance-record.model.js';
import { Poll } from '../polls/poll.model.js';
import { PollResponse } from '../poll-responses/poll-response.model.js';

export const classroomRepository = {
  course: (id) => Course.findById(id).lean(), user: (id) => User.findById(id).lean(),
  session: (id) => LiveSession.findById(id).lean(),
  listSessions: (filter) => LiveSession.find(filter).sort({ startsAt: -1 }).lean(),
  enrolledCourseIds: async (studentId) => (await Enrollment.find({ studentId, status: 'enrolled' }).select('courseId').lean()).map((item) => item.courseId),
  createSession: (data) => LiveSession.create(data),
  activeEnrollment: (studentId, courseId) => Enrollment.findOne({ studentId, courseId, status: 'enrolled' }).lean(),
  poll: (id) => Poll.findById(id).lean(),
  createPoll: (data) => Poll.create(data),
  createVote: async (data) => { const vote = new PollResponse(data); vote.$locals = { actorRole: 'student', actorUserId: data.studentId }; return vote.save(); },
  tally: (pollId) => PollResponse.aggregate([{ $match: { pollId: new mongoose.Types.ObjectId(pollId) } }, { $unwind: '$optionKeys' }, { $group: { _id: '$optionKeys', count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
  tallyPlan: (pollId) => PollResponse.aggregate([{ $match: { pollId: new mongoose.Types.ObjectId(pollId) } }, { $unwind: '$optionKeys' }, { $group: { _id: '$optionKeys', count: { $sum: 1 } } }]).explain('queryPlanner'),
  async joinAttendance({ sessionId, courseId, studentId, at }) {
    try {
      const updated = await AttendanceRecord.findOneAndUpdate({ sessionId, studentId, activeJoinedAt: null }, { $setOnInsert: { courseId, intervals: [], totalSeconds: 0 }, $set: { activeJoinedAt: at, lastEventAt: at } }, { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true });
      return updated;
    } catch (error) {
      if (error?.code !== 11000) throw error;
      return AttendanceRecord.findOne({ sessionId, studentId });
    }
  },
  attendance: (sessionId, studentId) => AttendanceRecord.findOne({ sessionId, studentId }),
  attendanceForSession: (sessionId) => AttendanceRecord.find({ sessionId }).sort({ totalSeconds: -1 }).lean(),
  async leaveAttendance({ sessionId, studentId, at, session }) {
    const record = await AttendanceRecord.findOne({ sessionId, studentId }).session(session);
    if (!record?.activeJoinedAt) return record;
    const seconds = Math.max(0, Math.floor((new Date(at).getTime() - new Date(record.activeJoinedAt).getTime()) / 1000));
    return AttendanceRecord.findOneAndUpdate({ _id: record._id, activeJoinedAt: record.activeJoinedAt }, { $push: { intervals: { joinedAt: record.activeJoinedAt, leftAt: at } }, $inc: { totalSeconds: seconds }, $set: { activeJoinedAt: null, lastEventAt: at } }, { new: true, session, runValidators: true });
  }
};

export const withClassroomTransaction = async (work) => { const session = await mongoose.startSession(); try { let result; await session.withTransaction(async () => { result = await work(session); }); return result; } finally { await session.endSession(); } };
