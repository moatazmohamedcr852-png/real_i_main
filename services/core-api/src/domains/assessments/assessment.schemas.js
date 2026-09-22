import { z } from 'zod';

export const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const option = z.object({ id: z.string().trim().min(1).max(64), text: z.string().trim().min(1).max(2000) }).strict();
const question = z.object({ id: z.string().trim().min(1).max(64), type: z.enum(['mcq', 'true_false', 'short_answer', 'essay']), prompt: z.string().trim().min(1).max(20000), options: z.array(option).max(20).default([]), correctOptionIds: z.array(z.string().max(64)).max(1).default([]), points: z.number().min(1).max(1000), rubric: z.array(z.object({ label: z.string().trim().min(1).max(500), points: z.number().min(0).max(1000) }).strict()).max(20).default([]) }).strict();

// Used by both the HTTP route and the AI integration before assessment creation.
export const assessmentInput = z.object({ courseId: objectId, title: z.string().trim().min(1).max(200), instructions: z.string().max(10000).optional(), status: z.enum(['draft', 'published']).optional(), timeLimitSeconds: z.number().int().min(60).max(28800), randomizeQuestions: z.boolean().optional(), maxAttempts: z.number().int().min(1).max(20).optional(), availableFrom: z.coerce.date().nullable().optional(), dueAt: z.coerce.date().nullable().optional(), questions: z.array(question).min(1).max(200) }).strict();
export const response = z.object({ questionId: z.string().min(1).max(64), value: z.string().max(50000) }).strict();
