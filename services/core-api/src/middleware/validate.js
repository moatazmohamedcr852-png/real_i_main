import { AppError } from '../shared/errors.js';

export function validate(schema) {
  return (req, _res, next) => {
    const result = schema.safeParse({ body: req.body, params: req.params, query: req.query });
    if (!result.success) return next(new AppError(400, 'VALIDATION_ERROR', 'Invalid request input.', result.error.flatten()));
    req.validated = result.data;
    next();
  };
}
