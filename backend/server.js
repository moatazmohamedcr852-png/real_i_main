import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

dotenv.config();

import { pool } from './db/pool.js';
import authRoutes from './routes/auth.js';
import courseRoutes from './routes/courses.js';
import assessmentRoutes from './routes/assessments.js';
import meetingRoutes from './routes/meetings.js';
import eventRoutes from './routes/events.js';
import userRoutes from './routes/users.js';
import adminRoutes from './routes/admin.js';
import dataRoutes from './routes/data.js';
import notificationRoutes from './routes/notifications.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Health checks
app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', server: 'healthy', database: 'connected' });
  } catch (err) {
    res.status(503).json({ status: 'error', server: 'healthy', database: 'unreachable', error: err.message });
  }
});

// Helper to mount routers at a prefix
function mountRouters(prefix = '') {
  app.use(`${prefix}/auth`, authRoutes);
  app.use(`${prefix}/courses`, courseRoutes);
  app.use(prefix, assessmentRoutes);
  app.use(prefix, meetingRoutes);
  app.use(prefix, eventRoutes);
  app.use(`${prefix}/users`, userRoutes);
  app.use(prefix, adminRoutes);
  app.use(prefix, dataRoutes);
  app.use(prefix, notificationRoutes);
}

// Mount under /v1 (primary for frontend), /api, and root
mountRouters('/v1');
mountRouters('/api');

// Direct /login and /register shortcuts if frontend hits them directly
app.post('/login', (req, res, next) => {
  req.url = '/login';
  authRoutes(req, res, next);
});
app.post('/register', (req, res, next) => {
  req.url = '/register';
  authRoutes(req, res, next);
});

// Serve frontend static build if available
const webRoot = path.resolve(__dirname, '../apps/web');
if (fs.existsSync(path.join(webRoot, 'index.html'))) {
  console.log(`Serving frontend static build from ${webRoot}`);
  app.use(express.static(webRoot));

  // Client-side SPA routing fallback
  app.get(/^(?!\/v1\/|\/api\/|\/health).*/, (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    res.sendFile(path.join(webRoot, 'index.html'));
  });
}

// 404 & Error handlers
app.use(notFound);
app.use(errorHandler);

// Fail-fast DB verification before starting server
async function startServer() {
  if (!process.env.DATABASE_URL) {
    console.error('FATAL: DATABASE_URL environment variable is unset.');
    process.exit(1);
  }

  try {
    console.log('Connecting to PostgreSQL database...');
    const client = await pool.connect();
    const res = await client.query('SELECT current_database(), version()');
    console.log(`Connected to PostgreSQL: database "${res.rows[0].current_database}"`);
    client.release();
  } catch (err) {
    console.error('FATAL: Unable to reach PostgreSQL database at DATABASE_URL:', err.message);
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`===============================================`);
    console.log(`REAL_i Backend Server running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/v1/health`);
    console.log(`Frontend URL: http://localhost:${PORT}`);
    console.log(`===============================================`);
  });
}

startServer();

export default app;
