import { AppError } from '../../shared/errors.js';
import { Notification } from './notification.model.js';
import { safeErrorMetadata } from '../../shared/safe-error.js';

const view = (item) => ({ id: String(item._id), type: item.type, payload: item.payload, readAt: item.readAt, createdAt: item.createdAt });
export const notificationDispatcher = {
  async assessmentGraded({ recipientId, courseId, assessmentId, submissionId, session }) {
    return new Notification({ recipientId, type: 'assessment_graded', payload: { courseId, assessmentId, submissionId }, deduplicationKey: `assessment-graded:${submissionId}` }).save({ session });
  }
};
export function createNotificationService({ logger = { error() {} } } = {}) {
  return {
    async list(actor, { unreadOnly = false, limit = 20 } = {}) { return (await Notification.find({ recipientId: actor.userId, ...(unreadOnly ? { readAt: null } : {}) }).sort({ createdAt: -1 }).limit(Math.min(limit, 50)).lean()).map(view); },
    async markRead(actor, notificationId) { const item = await Notification.findOneAndUpdate({ _id: notificationId, recipientId: actor.userId }, { $set: { readAt: new Date() } }, { new: true }); if (!item) throw new AppError(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found.'); return view(item); },
    async createSystem(recipientId, payload) { try { return await Notification.create({ recipientId, type: 'system', payload }); } catch (error) { logger.error({ ...safeErrorMetadata(error), recipientId: String(recipientId), event: 'notification_delivery_failed' }, 'Notification delivery failed'); throw error; } }
  };
}
