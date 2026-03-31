import { createLogger } from '@/utils/logger';

const logger = createLogger('error');

/** Extract a human-readable message from an unknown thrown value. */
export function getErrorMessage(error: unknown, fallback = 'Unknown error'): string {
  return error instanceof Error ? error.message : fallback;
}

export const handleGlobalError = (e: Error) => {
  // Log the error but do NOT auto-reload. The previous behavior reloaded
  // the page on any uncaught exception (rate-limited to once per 60s),
  // which caused unexpected reader reloads from transient errors like
  // network blips, WebSocket disconnects, or EPUB iframe CSP violations.
  logger.error('Unhandled error:', e?.message);
};
