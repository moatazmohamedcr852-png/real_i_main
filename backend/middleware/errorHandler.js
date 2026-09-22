export function notFound(req, res) {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Cannot ${req.method} ${req.path}`
    }
  });
}

export function errorHandler(err, req, res, _next) {
  console.error(`[Error] ${req.method} ${req.path}:`, err);

  let status = err.status || err.statusCode || 500;
  let code = err.code || 'INTERNAL_SERVER_ERROR';
  let message = err.message || 'An internal server error occurred.';

  // PostgreSQL unique violation
  if (err.code === '23505') {
    status = 409;
    code = 'DUPLICATE_RECORD';
    message = 'A record with this identifier or unique attribute already exists.';
  }

  // PostgreSQL foreign key violation
  if (err.code === '23503') {
    status = 400;
    code = 'FOREIGN_KEY_VIOLATION';
    message = 'Referenced resource does not exist.';
  }

  // PostgreSQL invalid text representation (e.g. invalid UUID format)
  if (err.code === '22P02') {
    status = 400;
    code = 'INVALID_SYNTAX';
    message = 'Invalid identifier syntax.';
  }

  res.status(status).json({
    error: {
      code,
      message
    },
    message // backwards compat
  });
}
