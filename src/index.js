import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { mkdirSync } from 'fs';
import { createServer } from 'http';
import { setupSocketIO } from './socket/index.js';
import { getDb } from './db.js';
import { contextMiddleware } from './middleware/context.js';
import { optionalAuth } from './middleware/auth.js';
import authRouter from './routes/auth.js';
import profileRouter from './routes/profile.js';
import matchingRouter from './routes/matching.js';
import messagingRouter from './routes/messaging.js';
import reactionsRouter from './routes/reactions.js';
import photosRouter from './routes/photos.js';
import exportRouter from './routes/export.js';
import startersRouter from './routes/starters.js';
import pushRouter from './routes/push.js';
import accountRouter from './routes/account.js';
import adminRouter from './routes/admin.js';
import feedbackRouter from './routes/feedback.js';
import { configurePush } from './push/webpush.js';
import { scheduleBackups } from './backup/scheduler.js';
import { scheduleWeeklyDigest } from './email/digest-scheduler.js';
import { maybeResetPassword } from './maintenance/reset-password.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Deployed build SHA — stamped into build-info.json by scripts/deploy.mjs at
// upload time (Railway doesn't inject git metadata for CLI deploys). Lets the
// deploy guard confirm the NEW build is live, not the old replica.
const BUILD_SHA = (() => {
  if (process.env.RAILWAY_GIT_COMMIT_SHA) return process.env.RAILWAY_GIT_COMMIT_SHA;
  try {
    const p = join(dirname(fileURLToPath(import.meta.url)), 'build-info.json');
    return JSON.parse(readFileSync(p, 'utf8')).sha || null;
  } catch {
    return null;
  }
})();

// Ensure data directory exists
mkdirSync('data', { recursive: true });

const app = express();
const db = getDb();
const PORT = process.env.PORT || 3001;

// Trust Railway's reverse proxy so express-rate-limit reads the real client IP
app.set('trust proxy', 1);
app.disable('x-powered-by');
// Security headers — HSTS, X-Content-Type-Options, frameguard, referrer policy,
// etc. CSP is disabled (this is a JSON API, not an HTML origin); CORP set to
// cross-origin so the separate frontend can call it.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || 'http://localhost:5173' }));
app.use(express.json({ limit: '1mb' })); // cap request bodies
app.use(optionalAuth);
app.use(contextMiddleware(db));

app.use('/auth', authRouter);
app.use('/profile', profileRouter);
app.use('/matching', matchingRouter);
app.use('/messaging', messagingRouter);
app.use('/reactions', reactionsRouter);
app.use('/photos', photosRouter);
app.use('/export', exportRouter);
app.use('/starters', startersRouter);
app.use('/push', pushRouter);
app.use('/account', accountRouter);
app.use('/admin', adminRouter);
app.use('/feedback', feedbackRouter);

// /health includes the deployed git SHA so the deploy script can confirm the
// NEW build is live (not the old replica still serving during rollover).
app.get('/health', (_req, res) => res.json({ status: 'ok', sha: BUILD_SHA }));

// 404 for unmatched routes (JSON API).
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Central error handler — log it, never leak stack traces to clients.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  console.error('[error]', req.method, req.originalUrl, '-', err?.message, '\n', err?.stack);
  if (res.headersSent) return;
  res.status(err?.status && err.status < 600 ? err.status : 500).json({ error: 'Something went wrong.' });
});

// Last-resort process guards so an async slip never silently corrupts state.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  process.exit(1); // undefined state — let the platform restart cleanly
});

const httpServer = createServer(app);
const io = setupSocketIO(httpServer, db);

// Make io available to route handlers via app.locals
app.locals.io = io;
configurePush();
scheduleBackups(db);
scheduleWeeklyDigest(db);
maybeResetPassword(db);

httpServer.listen(PORT, () => console.log(`Spectrum Dating server on :${PORT}`));

