export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const unauthorized = () => new AppError(401, 'UNAUTHORIZED', 'Authentication is required.');
export const forbidden = () => new AppError(403, 'FORBIDDEN', 'You do not have permission for this resource.');
