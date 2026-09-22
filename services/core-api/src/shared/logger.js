import pino from 'pino';

export function createLogger(level = 'info') {
  return pino({
    level,
    // Payloads containing learner work or AI prompts must never be logged. These
    // paths are defense-in-depth if a boundary attaches one to a log record.
    redact: [
      'req.headers.authorization', 'req.headers.cookie', 'req.body.password', 'req.body.refreshToken', 'req.body.responses', 'req.body.questions', 'req.body.responseText', 'req.body.feedback', 'req.body.description', 'req.body.content',
      'password', 'passwordHash', 'refreshToken', 'accessToken', 'token', 'authorization',
      'refreshTokens.tokenHash', 'serviceToken', 'apiKey', 'prompt', 'messages', 'content',
      'submission', 'answer', 'responses', 'questionSnapshot', 'correctOptionIds', 'rubric', 'feedback', 'description', 'payload', 'courseContent'
    ]
  });
}
