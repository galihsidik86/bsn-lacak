import * as Sentry from '@sentry/node';
import type { Application, ErrorRequestHandler } from 'express';
import { env } from '../env.js';
import { logger } from './logger.js';

// Sentry stays a no-op when SENTRY_DSN isn't set so dev / OSS deployments
// don't need to wire up an account just to boot the app. When it IS set,
// uncaught exceptions and 5xx errors propagate through the Express
// errorHandler below.

let initialized = false;

export function initSentry(): void {
  if (initialized) return;
  if (!env.SENTRY_DSN) {
    logger.debug('sentry_skipped_no_dsn');
    return;
  }
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENV,
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
  });
  initialized = true;
  logger.info({ env: env.SENTRY_ENV }, 'sentry_initialized');
}

export function setupSentryRequest(app: Application): void {
  if (!initialized) return;
  Sentry.setupExpressErrorHandler(app);
}

// Express error handler — caller mounts it AFTER routes but BEFORE the
// generic 500 fallback. Only forwards to Sentry; rethrowing lets the
// app's own error JSON response still run.
export const sentryErrorHandler: ErrorRequestHandler = (err, _req, _res, next) => {
  if (initialized) Sentry.captureException(err);
  next(err);
};
