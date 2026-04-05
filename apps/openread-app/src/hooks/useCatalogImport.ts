'use client';

import { useState, useCallback, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { CATALOG_API_BASE_URL } from '@/services/constants';
import { getPlatformFetch } from '@/utils/fetch';
import { createLogger } from '@/utils/logger';
import { eventDispatcher } from '@/utils/event';
import { syncWorker } from '@/services/sync/syncWorker';
import { useLibraryLimit } from '@/hooks/useLibraryLimit';
import type { ImportState, ImportApiResponse, StatusApiResponse } from '@/types/catalog';

export type { ImportStatus, ImportState } from '@/types/catalog';

const logger = createLogger('catalog-import');

interface ApiErrorResponse {
  code: string;
  message: string;
}

export interface UseCatalogImportReturn {
  importStates: Record<string, ImportState>;
  importBook: (catalogBookId: string, iaIdentifier?: string) => Promise<void>;
  getImportState: (catalogBookId: string) => ImportState;
  resetImportState: (catalogBookId: string) => void;
}

// ── Constants ───────────────────────────────────────────

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 30;

// ── Hook ────────────────────────────────────────────────

export function useCatalogImport(): UseCatalogImportReturn {
  const { token, user } = useAuth();
  const { canAddBook, libraryLimit } = useLibraryLimit();
  const [importStates, setImportStates] = useState<Record<string, ImportState>>({});
  const pollAbortRefs = useRef<Record<string, AbortController>>({});

  const updateState = useCallback((bookId: string, update: Partial<ImportState>) => {
    setImportStates((prev) => ({
      ...prev,
      [bookId]: { ...prev[bookId]!, ...update } as ImportState,
    }));
  }, []);

  const pollStatus = useCallback(
    async (catalogBookId: string, controller: AbortController): Promise<boolean> => {
      for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
        if (controller.signal.aborted) return false;

        // Update progress (capped at 90% during polling — final 100% on ready)
        const progress = Math.min(10 + Math.round((attempt / MAX_POLL_ATTEMPTS) * 80), 90);
        updateState(catalogBookId, { progress });

        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        if (controller.signal.aborted) return false;

        try {
          const platformFetch = await getPlatformFetch();
          const res = await platformFetch(
            `${CATALOG_API_BASE_URL}/catalog/books/${catalogBookId}/status`,
            { signal: controller.signal },
          );
          if (!res.ok) continue;

          const data = (await res.json()) as StatusApiResponse;
          if (data.caching_status === 'cached') {
            return true;
          }
          if (data.caching_status === 'failed') {
            return false;
          }
        } catch (err) {
          if (controller.signal.aborted) return false;
          logger.warn('Poll status error', { catalogBookId, error: err });
        }
      }
      return false; // Timeout
    },
    [updateState],
  );

  const importBook = useCallback(
    async (catalogBookId: string, iaIdentifier?: string) => {
      if (!token || !user) {
        eventDispatcher.dispatch('toast', {
          message: 'Sign in to add books to your library',
          type: 'warning',
        });
        return;
      }

      if (!canAddBook) {
        eventDispatcher.dispatch('toast', {
          message: `Library full (${libraryLimit} books). Upgrade for unlimited.`,
          type: 'warning',
        });
        return;
      }

      // Prevent duplicate imports
      const current = importStates[catalogBookId];
      if (current?.status === 'importing') return;

      // Cancel any existing poll for this book
      if (pollAbortRefs.current[catalogBookId]) {
        pollAbortRefs.current[catalogBookId]!.abort();
      }
      const controller = new AbortController();
      pollAbortRefs.current[catalogBookId] = controller;

      updateState(catalogBookId, { status: 'importing', progress: 5, error: undefined });

      try {
        const platformFetch = await getPlatformFetch();

        let url: string;
        let body: string | undefined;
        if (iaIdentifier) {
          url = `${CATALOG_API_BASE_URL}/api/catalog/ia/import`;
          body = JSON.stringify({ ia_identifier: iaIdentifier });
        } else {
          url = `${CATALOG_API_BASE_URL}/api/catalog/books/${catalogBookId}/import`;
        }

        const headers: Record<string, string> = {
          Authorization: `Bearer ${token}`,
        };
        if (body) {
          headers['Content-Type'] = 'application/json';
        }

        const res = await platformFetch(url, {
          method: 'POST',
          headers,
          body,
          signal: controller.signal,
        });

        if (!res.ok) {
          const errorData = (await res.json().catch(() => null)) as ApiErrorResponse | null;
          const errorMessage = errorData?.message || `Import failed (${res.status})`;
          throw new Error(errorMessage);
        }

        const data = (await res.json()) as ImportApiResponse;

        if (data.status === 'ready') {
          updateState(catalogBookId, {
            status: 'ready',
            progress: 100,
            bookId: data.book_id,
            bookHash: data.book_hash,
            downloadUrl: data.download_url,
          });
          syncWorker.pullNow('books').catch(() => {});
          eventDispatcher.dispatch('toast', {
            message: 'Book added to your library',
            type: 'success',
          });
          return;
        }

        if (data.status === 'preparing') {
          updateState(catalogBookId, { progress: 10 });
          const cached = await pollStatus(catalogBookId, controller);

          if (controller.signal.aborted) return;

          if (cached) {
            const retryRes = await platformFetch(
              `${CATALOG_API_BASE_URL}/api/catalog/books/${catalogBookId}/import`,
              {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
                signal: controller.signal,
              },
            );

            if (retryRes.ok) {
              const retryData = (await retryRes.json()) as ImportApiResponse;
              updateState(catalogBookId, {
                status: 'ready',
                progress: 100,
                bookId: retryData.book_id,
                bookHash: retryData.book_hash,
                downloadUrl: retryData.download_url,
              });
              syncWorker.pullNow('books').catch(() => {});
              eventDispatcher.dispatch('toast', {
                message: 'Book added to your library',
                type: 'success',
              });
              return;
            }
          }

          throw new Error('Import timed out. Please try again later.');
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;

        const errorMessage = err instanceof Error ? err.message : 'Import failed';
        logger.error('Import failed', { catalogBookId, iaIdentifier, error: err });
        updateState(catalogBookId, { status: 'error', progress: 0, error: errorMessage });
        eventDispatcher.dispatch('toast', {
          message: errorMessage,
          type: 'error',
        });
      } finally {
        if (pollAbortRefs.current[catalogBookId] === controller) {
          delete pollAbortRefs.current[catalogBookId];
        }
      }
    },
    [token, user, importStates, updateState, pollStatus, canAddBook, libraryLimit],
  );

  const getImportState = useCallback(
    (catalogBookId: string): ImportState => {
      return importStates[catalogBookId] || { status: 'idle' };
    },
    [importStates],
  );

  const resetImportState = useCallback((catalogBookId: string) => {
    if (pollAbortRefs.current[catalogBookId]) {
      pollAbortRefs.current[catalogBookId]!.abort();
      delete pollAbortRefs.current[catalogBookId];
    }
    setImportStates((prev) => {
      const next = { ...prev };
      delete next[catalogBookId];
      return next;
    });
  }, []);

  return { importStates, importBook, getImportState, resetImportState };
}
