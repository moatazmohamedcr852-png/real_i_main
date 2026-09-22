import { z } from 'zod';

const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(12).max(128).regex(/[a-z]/, 'Password must contain a lowercase letter.').regex(/[A-Z]/, 'Password must contain an uppercase letter.').regex(/[0-9]/, 'Password must contain a number.');

export const registerSchema = z.object({ body: z.object({ name: z.string().trim().min(1).max(120), email, password }).strip(), params: z.object({}), query: z.object({}) });
export const loginSchema = z.object({ body: z.object({ email, password: z.string().min(1).max(128) }).strip(), params: z.object({}), query: z.object({}) });
export const refreshSchema = z.object({ body: z.object({ refreshToken: z.string().min(1).max(4096) }).strict(), params: z.object({}), query: z.object({}) });
export const emptyRequestSchema = z.object({ body: z.object({}).strict(), params: z.object({}), query: z.object({}) });
