import { AppError } from '../shared/errors.js';

function assertSafe(value) {
  if (Array.isArray(value)) return value.forEach(assertSafe);
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (key.startsWith('$') || key.includes('.')) throw new Error('Unsafe document key');
      assertSafe(item);
    }
  }
}

export function sanitizeInput(req, _res, next) {
  try {
    // Reject, rather than silently remove, operator/path keys so callers never lose supplied data unnoticed.
    assertSafe(req.body);
    assertSafe(req.query);
    assertSafe(req.params);
    next();
  } catch {
    next(new AppError(400, 'INVALID_INPUT', 'Request input could not be processed.'));
  }
}
