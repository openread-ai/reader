/**
 * @module lib/sample-book
 *
 * Constants and helpers for the first-login sample book.
 * S6.2: On first login with empty library, auto-import one
 * CC-BY book from the catalog to demonstrate AI Q&A features.
 *
 * The sample book is imported via the catalog API.  If the import
 * fails for any reason, the error is swallowed and the user simply
 * sees the welcome screen with an empty library.
 */

import { CATALOG_API_BASE_URL } from '@/services/constants';
import { createLogger } from '@/utils/logger';

const logger = createLogger('sample-book');

// ── Constants ───────────────────────────────────────────

/**
 * Catalog book ID for the sample book.
 * Change this value to swap the default sample book.
 *
 * Current: "Alice's Adventures in Wonderland" by Lewis Carroll
 * — public domain, small (~300 KB), well-known, good for AI Q&A demo.
 */
export const SAMPLE_BOOK_ID = 'alice-in-wonderland';

/** localStorage key used to prevent retrying after a failed or successful attempt. */
export const SAMPLE_BOOK_ATTEMPTED_KEY = 'sample_book_attempted';

// ── Types ───────────────────────────────────────────────

interface ImportApiResponse {
  status: 'ready' | 'preparing';
  download_url?: string;
  book_id?: string;
  book_hash?: string;
}

// ── Import logic ────────────────────────────────────────

/**
 * Attempt to import the sample book via the catalog API.
 * Returns true on success, false on failure.
 *
 * This function is intentionally fire-and-forget-safe:
 * it catches all errors internally and always marks the
 * attempt in localStorage so it is never retried.
 */
export async function importSampleBook(token: string): Promise<boolean> {
  // Mark as attempted immediately so we never retry
  localStorage.setItem(SAMPLE_BOOK_ATTEMPTED_KEY, new Date().toISOString());

  try {
    const res = await fetch(`${CATALOG_API_BASE_URL}/api/catalog/books/${SAMPLE_BOOK_ID}/import`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      logger.warn('Sample book import API returned non-OK', { status: res.status });
      return false;
    }

    const data = (await res.json()) as ImportApiResponse;

    if (data.status === 'ready') {
      logger.info('Sample book imported successfully', { bookId: data.book_id });
      return true;
    }

    // If the book is still being prepared, we don't poll —
    // keeping this lightweight.  The user can import from Explore later.
    logger.info('Sample book is still being prepared, skipping');
    return false;
  } catch (err) {
    logger.warn('Sample book import failed silently', err);
    return false;
  }
}
