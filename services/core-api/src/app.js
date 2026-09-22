import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pinoHttp from 'pino-http';
import { authRoutes } from './routes/auth.routes.js';
import { courseRoutes } from './routes/course.routes.js';
import { assessmentRoutes } from './routes/assessment.routes.js';
import { enrollmentRoutes } from './routes/enrollment.routes.js';
import { liveSessionRoutes } from './routes/live-session.routes.js';
import { calendarAnalyticsRoutes } from './routes/calendar-analytics.routes.js';
import { aiIntegrationRoutes } from './routes/ai-integration.routes.js';
import { webCompatRoutes } from './routes/web-compat.routes.js';
import { createAiRateLimits } from './middleware/rate-limits.js';
import { errorHandler, notFound } from './middleware/error-handler.js';
import { requestContext } from './middleware/request-context.js';
import { sanitizeInput } from './middleware/sanitize.js';
import { allowAnonymous } from './middleware/authenticate.js';

export function createApp({ config, logger, authService, tokens, courseService, assessmentService, enrollmentService, virtualClassroomService, calendarAnalyticsService, notificationService, aiIntegrationService }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(requestContext);
  app.use(pinoHttp({ logger, genReqId: (req) => req.requestId, customProps: (req) => ({ requestId: req.requestId }) }));
  app.use(helmet(config.serveWeb ? { contentSecurityPolicy: false, crossOriginEmbedderPolicy: false } : {}));
  app.use(cors({ origin: (origin, callback) => callback(null, !origin || config.corsOrigins.includes(origin)), credentials: false, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] }));
  app.use(express.json({ limit: '1mb', type: 'application/json' }));
  app.use(sanitizeInput);
  app.get('/health', allowAnonymous, (_req, res) => res.status(200).json({ status: 'ok' }));
  app.get('/v1/health', allowAnonymous, (_req, res) => res.status(200).json({ status: 'ok' }));
  app.use('/v1/auth', authRoutes({ authService, tokens }));
  if (courseService) app.use('/v1/courses', courseRoutes({ service: courseService, enrollmentService, tokens }));
  if (assessmentService) app.use('/v1', assessmentRoutes({ service: assessmentService, tokens }));
  if (enrollmentService) app.use('/v1/enrollments', enrollmentRoutes({ service: enrollmentService, tokens }));
  if (virtualClassroomService) app.use('/v1/live-sessions', liveSessionRoutes({ service: virtualClassroomService, tokens }));
  if (calendarAnalyticsService && notificationService) app.use('/v1', calendarAnalyticsRoutes({ calendarAnalyticsService, notificationService, tokens }));
  if (aiIntegrationService) app.use('/v1', aiIntegrationRoutes({ service: aiIntegrationService, tokens, limits: createAiRateLimits(config) }));
  if (tokens) app.use('/v1', webCompatRoutes({ tokens, virtualClassroomService }));
  const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../apps/web');
  if (config.serveWeb && existsSync(path.join(webRoot, 'index.html'))) {
    app.use(express.static(webRoot));
    app.get(/^(?!\/v1\/|\/health).*/, allowAnonymous, (req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      res.sendFile(path.join(webRoot, 'index.html'));
    });
  }
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
