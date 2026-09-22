import { AppError } from '../shared/errors.js';
import { safeErrorMetadata } from '../shared/safe-error.js';

export function notFound(req, _res, next) { next(new AppError(404, 'NOT_FOUND', `Route ${req.method} ${req.path} was not found.`)); }

export function errorHandler(error, req, res, _next) {
  if (error?.code === 11000) error = new AppError(409, 'DUPLICATE_RECORD', 'A record with these unique values already exists.');
  const status = error instanceof AppError ? error.status : 500;
  const code = error instanceof AppError ? error.code : 'INTERNAL_ERROR';
  req.log?.error({ ...safeErrorMetadata(error), requestId: req.requestId, code, status, userId: req.auth?.userId, method: req.method, path: req.path }, 'Request failed');
  res.status(status).json({ error: { code, message: status === 500 ? 'An unexpected error occurred.' : error.message, ...(error instanceof AppError && error.details ? { details: error.details } : {}) }, requestId: req.requestId });
}
