import { asyncHandler } from '../shared/async-handler.js';

export function createAuthController(authService) {
  return {
    login: asyncHandler(async (req, res) => {
      const session = await authService.login(req.validated.body);
      res.status(200).json({ ...session, token: session.accessToken });
    }),
    register: asyncHandler(async (req, res) => {
      const session = await authService.register(req.validated.body);
      res.status(201).json({ ...session, token: session.accessToken });
    }),
    refresh: asyncHandler(async (req, res) => res.status(200).json(await authService.refresh(req.validated.body.refreshToken))),
    logout: asyncHandler(async (req, res) => { await authService.logout(req.auth.userId, req.auth.tokenId); res.status(204).send(); }),
    me: asyncHandler(async (req, res) => {
      const user = await authService.getUser(req.auth.userId);
      res.status(200).json({ user, ...user });
    })
  };
}
