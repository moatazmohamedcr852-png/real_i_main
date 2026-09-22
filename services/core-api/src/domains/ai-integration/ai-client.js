import { AppError } from '../../shared/errors.js';

export function createAiClient({ config, tokenService, logger = { info() {}, warn() {} }, fetchImpl = globalThis.fetch }) {
  async function request({ actor, courseId, scopes, path, body, requestId, timeoutMs }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();
    try {
      const response = await fetchImpl(new URL(path, config.AI_SERVICE_BASE_URL), {
        method: 'POST', signal: controller.signal,
        headers: { authorization: `Bearer ${tokenService.mint({ actor, courseId, scopes })}`, 'content-type': 'application/json', 'x-request-id': requestId },
        body: JSON.stringify(body)
      });
      const payload = await response.json().catch(() => null);
      logger.info({ event: 'ai_service_response', requestId, path, status: response.status, durationMs: Date.now() - started }, 'AI service request completed');
      if (response.ok) return payload;
      if (response.status === 503) throw new AppError(503, 'AI_UNAVAILABLE', 'AI service is temporarily unavailable. Please try again later.');
      if (response.status === 429) throw new AppError(429, 'AI_RATE_LIMITED', 'AI request limit reached. Please try again later.');
      if (response.status === 401 || response.status === 403) throw new AppError(502, 'AI_SERVICE_AUTH_FAILED', 'AI service authentication failed.');
      throw new AppError(502, 'AI_SERVICE_REJECTED', 'AI service could not process this request.');
    } catch (error) {
      if (error?.name === 'AbortError') {
        logger.warn({ event: 'ai_service_timeout', requestId, path, timeoutMs }, 'AI service request timed out');
        throw new AppError(504, 'AI_SERVICE_TIMEOUT', 'AI service took too long to respond. Please try again.');
      }
      throw error;
    } finally { clearTimeout(timer); }
  }
  return { request };
}
