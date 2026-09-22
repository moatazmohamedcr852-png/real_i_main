import { ipKeyGenerator, rateLimit } from 'express-rate-limit';

function perUserLimit({ windowMs, limit, code, message }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => req.auth?.userId ? `user:${req.auth.userId}` : `ip:${ipKeyGenerator(req.ip)}`,
    message: { error: { code, message } }
  });
}

export const assessmentStartLimit = perUserLimit({ windowMs: 15 * 60 * 1000, limit: 20, code: 'ASSESSMENT_START_RATE_LIMITED', message: 'Too many assessment-start requests. Please try again later.' });
export const assessmentMutationLimit = perUserLimit({ windowMs: 15 * 60 * 1000, limit: 240, code: 'ASSESSMENT_WRITE_RATE_LIMITED', message: 'Too many assessment write requests. Please try again later.' });
export const pollVoteLimit = perUserLimit({ windowMs: 5 * 60 * 1000, limit: 10, code: 'POLL_VOTE_RATE_LIMITED', message: 'Too many poll-vote requests. Please try again later.' });
export const calendarReadLimit = perUserLimit({ windowMs: 60 * 1000, limit: 120, code: 'CALENDAR_RATE_LIMITED', message: 'Too many calendar requests. Please try again shortly.' });
export const analyticsLimit = perUserLimit({ windowMs: 5 * 60 * 1000, limit: 30, code: 'ANALYTICS_RATE_LIMITED', message: 'Too many analytics requests. Please try again later.' });
export const notificationMutationLimit = perUserLimit({ windowMs: 60 * 1000, limit: 60, code: 'NOTIFICATION_RATE_LIMITED', message: 'Too many notification requests. Please try again shortly.' });

export function createAiRateLimits(config = {}) {
  return {
    chat: perUserLimit({ windowMs: 60 * 1000, limit: config.AI_CHAT_RATE_LIMIT_PER_MINUTE ?? 10, code: 'AI_CHAT_RATE_LIMITED', message: 'Too many AI chat requests. Please try again shortly.' }),
    ingest: perUserLimit({ windowMs: 15 * 60 * 1000, limit: config.AI_INGEST_RATE_LIMIT_PER_15_MINUTES ?? 6, code: 'AI_INGEST_RATE_LIMITED', message: 'Too many ingestion requests. Please try again later.' }),
    quiz: perUserLimit({ windowMs: 15 * 60 * 1000, limit: config.AI_QUIZ_RATE_LIMIT_PER_15_MINUTES ?? 5, code: 'AI_QUIZ_RATE_LIMITED', message: 'Too many AI quiz requests. Please try again later.' }),
    directive: perUserLimit({ windowMs: 15 * 60 * 1000, limit: config.AI_DIRECTIVE_RATE_LIMIT_PER_15_MINUTES ?? 10, code: 'AI_DIRECTIVE_RATE_LIMITED', message: 'Too many AI directive requests. Please try again later.' })
  };
}
