import jwt from 'jsonwebtoken';

export function createInternalAiTokenService(config) {
  return {
    mint({ actor, courseId, scopes }) {
      return jwt.sign({ actor_id: String(actor.userId), actor_role: actor.role, course_id: String(courseId), scopes }, config.AI_INTERNAL_JWT_SECRET, {
        algorithm: 'HS256', issuer: config.AI_INTERNAL_JWT_ISSUER, audience: config.AI_INTERNAL_JWT_AUDIENCE,
        subject: 'core-api', expiresIn: '60s', header: { kid: config.AI_INTERNAL_JWT_KID }
      });
    }
  };
}
