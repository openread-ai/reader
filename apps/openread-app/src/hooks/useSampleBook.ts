'use client';

/**
 * @module hooks/useSampleBook
 *
 * S6.2: Auto-import a sample book on first login with empty library.
 *
 * Runs once — guarded by localStorage flag and a per-mount ref.
 * Fails silently; the user just sees the welcome screen.
 */

import { useEffect, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useLibraryStore } from '@/store/libraryStore';
import { importSampleBook, SAMPLE_BOOK_ATTEMPTED_KEY } from '@/lib/sample-book';
import { syncWorker } from '@/services/sync/syncWorker';
import { createLogger } from '@/utils/logger';

const logger = createLogger('use-sample-book');

export function useSampleBook(): void {
  const { user, token } = useAuth();
  const libraryLoaded = useLibraryStore((s) => s.libraryLoaded);
  const attemptedRef = useRef(false);

  useEffect(() => {
    // Gate: must have user + token + loaded library, and not already attempted this mount
    if (!user || !token || !libraryLoaded || attemptedRef.current) return;

    // Gate: already attempted in a previous session
    if (localStorage.getItem(SAMPLE_BOOK_ATTEMPTED_KEY)) return;

    // Gate: library is not empty — no sample needed
    const visibleBooks = useLibraryStore.getState().library.filter((b) => !b.deletedAt);
    if (visibleBooks.length > 0) return;

    attemptedRef.current = true;

    const run = async () => {
      const success = await importSampleBook(token);
      if (success) {
        // Trigger library sync so the book appears
        try {
          await syncWorker.pullNow('books');
        } catch {
          logger.warn('Pull after sample book import failed');
        }
      }
    };

    run();
  }, [user, token, libraryLoaded]);
}
