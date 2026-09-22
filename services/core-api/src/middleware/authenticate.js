import { forbidden, unauthorized } from '../shared/errors.js';

export function authenticate(tokens) {
  return (req, _res, next) => {
    const header = req.get('authorization');
    if (!header?.startsWith('Bearer ')) return next(unauthorized());
    try {
      const claims = tokens.verifyAccessToken(header.slice(7));
      req.auth = { userId: claims.sub, role: claims.role, tokenId: claims.jti };
      next();
    } catch (error) { next(error); }
  };
}

export function authenticateOptional(tokens) {
  return (req, _res, next) => {
    const header = req.get('authorization');
    if (!header) return next();
    if (!header.startsWith('Bearer ')) return next(unauthorized());
    try { const claims = tokens.verifyAccessToken(header.slice(7)); req.auth = { userId: claims.sub, role: claims.role, tokenId: claims.jti }; next(); } catch (error) { next(error); }
  };
}

export const requireRoles = (...roles) => (req, _res, next) => {
  if (!req.auth || !roles.includes(req.auth.role)) return next(forbidden());
  next();
};

// Marks intentionally public endpoints in route definitions, preventing accidental ambiguity during audit.
export const allowAnonymous = (_req, _res, next) => next();
