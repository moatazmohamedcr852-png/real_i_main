import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env') });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  MONGODB_URI: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JITSI_JWT_SECRET: z.string().min(32),
  JITSI_APP_ID: z.string().min(1).max(200),
  JITSI_DOMAIN: z.string().min(1).max(253),
  CORS_ORIGINS: z.string().min(1),
  LOG_LEVEL: z.string().default('info'),
  AI_SERVICE_BASE_URL: z.string().url().default('http://127.0.0.1:8001'),
  AI_INTERNAL_JWT_SECRET: z.string().min(32).default('development-ai-internal-secret-change-before-production-000'),
  AI_INTERNAL_JWT_KID: z.string().min(1).max(100).default('2026-01'),
  AI_INTERNAL_JWT_ISSUER: z.string().min(1).default('real-i-core-api'),
  AI_INTERNAL_JWT_AUDIENCE: z.string().min(1).default('real-i-ai'),
  AI_CHAT_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(12000),
  AI_QUIZ_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(25000),
  AI_INGEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(25000),
  AI_DIRECTIVE_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(15000),
  AI_CHAT_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(1000).default(10),
  AI_INGEST_RATE_LIMIT_PER_15_MINUTES: z.coerce.number().int().min(1).max(1000).default(6),
  AI_QUIZ_RATE_LIMIT_PER_15_MINUTES: z.coerce.number().int().min(1).max(1000).default(5),
  AI_DIRECTIVE_RATE_LIMIT_PER_15_MINUTES: z.coerce.number().int().min(1).max(1000).default(10),
  SERVE_WEB: z.enum(['true', 'false']).optional(),
  LOCAL_SEED_USERS: z.enum(['true', 'false']).optional()
});

export function loadEnv(source = process.env) {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`);
  }
  const corsOrigins = parsed.data.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean).map((origin) => {
    if (origin === '*') throw new Error('Invalid environment configuration: CORS_ORIGINS may not contain a wildcard.');
    let url;
    try { url = new URL(origin); } catch { throw new Error('Invalid environment configuration: CORS_ORIGINS must contain absolute HTTP(S) origins.'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) throw new Error('Invalid environment configuration: CORS_ORIGINS must contain absolute HTTP(S) origins without paths.');
    return origin;
  });
  if (!corsOrigins.length) throw new Error('Invalid environment configuration: CORS_ORIGINS must contain at least one origin.');
  const development = parsed.data.NODE_ENV === 'development';
  return {
    ...parsed.data,
    corsOrigins,
    serveWeb: parsed.data.SERVE_WEB ? parsed.data.SERVE_WEB === 'true' : development,
    seedLocalUsers: parsed.data.LOCAL_SEED_USERS ? parsed.data.LOCAL_SEED_USERS === 'true' : development
  };
}
