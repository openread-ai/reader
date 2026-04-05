import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useCatalogImport } from '@/hooks/useCatalogImport';

// ── Hoisted mocks ──────────────────────────────────────

const { mockAuthState, mockDispatch } = vi.hoisted(() => {
  const mockAuthState = {
    token: 'test-token-123' as string | null,
    user: { id: 'user-1' } as { id: string } | null,
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
  };
  const mockDispatch = vi.fn();
  return { mockAuthState, mockDispatch };
});

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => mockAuthState,
}));

vi.mock('@/utils/event', () => ({
  eventDispatcher: {
    dispatch: (...args: unknown[]) => mockDispatch(...args),
  },
}));

vi.mock('@/services/sync/syncWorker', () => ({
  syncWorker: {
    pullNow: vi.fn(() => Promise.resolve()),
  },
}));

// Mock useLibraryLimit (library limit logic is tested separately)
const { mockLibraryLimitState } = vi.hoisted(() => {
  const mockLibraryLimitState = {
    canAddBook: true,
    libraryLimit: null as number | null,
    currentCount: 0,
    plan: 'free' as const,
    upgradeTierName: 'Reader',
    upgradePriceCents: 799,
    isLoading: false,
  };
  return { mockLibraryLimitState };
});

vi.mock('@/hooks/useLibraryLimit', () => ({
  useLibraryLimit: () => mockLibraryLimitState,
}));

// ── Test helpers ───────────────────────────────────────

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function mockImportResponse(status: 'ready' | 'preparing', extra?: Record<string, unknown>) {
  return {
    ok: true,
    json: async () => ({ status, ...extra }),
  };
}

function mockStatusResponse(cachingStatus: string) {
  return {
    ok: true,
    json: async () => ({ caching_status: cachingStatus }),
  };
}

function mockErrorResponse(status: number, body?: Record<string, unknown>) {
  return {
    ok: false,
    status,
    json: async () => body ?? { code: 'ERROR', message: `Error ${status}` },
  };
}

// ── Tests ──────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  mockAuthState.token = 'test-token-123';
  mockAuthState.user = { id: 'user-1' } as never;
  // Reset library limit to allow imports by default
  mockLibraryLimitState.canAddBook = true;
  mockLibraryLimitState.libraryLimit = null;
  mockLibraryLimitState.currentCount = 0;
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('useCatalogImport', () => {
  describe('initial state', () => {
    it('should return idle state for unknown book IDs', () => {
      const { result } = renderHook(() => useCatalogImport());
      expect(result.current.getImportState('unknown-id')).toEqual({ status: 'idle' });
    });

    it('should return empty importStates initially', () => {
      const { result } = renderHook(() => useCatalogImport());
      expect(result.current.importStates).toEqual({});
    });
  });

  describe('auth check', () => {
    it('should show warning toast when user is not authenticated', async () => {
      mockAuthState.token = null;
      mockAuthState.user = null as never;

      const { result } = renderHook(() => useCatalogImport());

      await act(async () => {
        await result.current.importBook('book-1');
      });

      expect(mockDispatch).toHaveBeenCalledWith('toast', {
        message: 'Sign in to add books to your library',
        type: 'warning',
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should not proceed when token is null', async () => {
      mockAuthState.token = null;

      const { result } = renderHook(() => useCatalogImport());

      await act(async () => {
        await result.current.importBook('book-1');
      });

      expect(result.current.getImportState('book-1')).toEqual({ status: 'idle' });
    });
  });

  describe('local book import (cached)', () => {
    it('should import a cached book and transition to ready state', async () => {
      fetchMock.mockResolvedValueOnce(
        mockImportResponse('ready', {
          book_id: 'lib-book-1',
          book_hash: 'catalog:catalog-1',
          download_url: 'https://example.com/book.epub',
        }),
      );

      const { result } = renderHook(() => useCatalogImport());

      await act(async () => {
        await result.current.importBook('catalog-1');
      });

      // Verify fetch was called with correct endpoint
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0]!;
      expect(url).toContain('/api/catalog/books/catalog-1/import');
      expect(options.method).toBe('POST');
      expect(options.headers.Authorization).toBe('Bearer test-token-123');

      // Verify state
      const state = result.current.getImportState('catalog-1');
      expect(state.status).toBe('ready');
      expect(state.progress).toBe(100);
      expect(state.bookId).toBe('lib-book-1');
      expect(state.bookHash).toBe('catalog:catalog-1');
      expect(state.downloadUrl).toBe('https://example.com/book.epub');

      // Verify success toast
      expect(mockDispatch).toHaveBeenCalledWith('toast', {
        message: 'Book added to your library',
        type: 'success',
      });
    });

    it('should trigger library sync on successful import', async () => {
      const { syncWorker } = await import('@/services/sync/syncWorker');

      fetchMock.mockResolvedValueOnce(
        mockImportResponse('ready', {
          book_id: 'lib-book-sync',
          book_hash: 'catalog:sync-1',
          download_url: 'https://example.com/sync.epub',
        }),
      );

      const { result } = renderHook(() => useCatalogImport());

      await act(async () => {
        await result.current.importBook('sync-1');
      });

      expect(syncWorker.pullNow).toHaveBeenCalledWith('books');
    });
  });

  describe('IA book import', () => {
    it('should use /ia/import endpoint with ia_identifier', async () => {
      fetchMock.mockResolvedValueOnce(
        mockImportResponse('ready', {
          book_id: 'lib-book-ia',
          book_hash: 'catalog:ia-cat-id',
          download_url: 'https://example.com/ia.epub',
        }),
      );

      const { result } = renderHook(() => useCatalogImport());

      await act(async () => {
        await result.current.importBook('catalog-ia-1', 'thegreatgatsby');
      });

      const [url, options] = fetchMock.mock.calls[0]!;
      expect(url).toContain('/api/catalog/ia/import');
      expect(options.method).toBe('POST');
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(JSON.parse(options.body)).toEqual({ ia_identifier: 'thegreatgatsby' });

      const state = result.current.getImportState('catalog-ia-1');
      expect(state.status).toBe('ready');
      expect(state.bookId).toBe('lib-book-ia');
      expect(state.bookHash).toBe('catalog:ia-cat-id');
    });
  });

  describe('import with polling', () => {
    it('should poll status when import returns preparing', async () => {
      // Initial import returns 'preparing'
      fetchMock.mockResolvedValueOnce(mockImportResponse('preparing'));

      // First poll: still caching
      fetchMock.mockResolvedValueOnce(mockStatusResponse('caching'));

      // Second poll: cached
      fetchMock.mockResolvedValueOnce(mockStatusResponse('cached'));

      // Re-import after cached: returns ready
      fetchMock.mockResolvedValueOnce(
        mockImportResponse('ready', {
          book_id: 'lib-polled',
          book_hash: 'catalog:catalog-poll',
          download_url: 'https://example.com/polled.epub',
        }),
      );

      const { result } = renderHook(() => useCatalogImport());

      // Start import (don't await — it will poll asynchronously)
      let importPromise: Promise<void>;
      act(() => {
        importPromise = result.current.importBook('catalog-poll');
      });

      // Should be in importing state
      expect(result.current.getImportState('catalog-poll').status).toBe('importing');

      // Advance past first poll interval (2s)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2100);
      });

      // Advance past second poll interval (2s)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2100);
      });

      // Wait for import to complete
      await act(async () => {
        await importPromise!;
      });

      const state = result.current.getImportState('catalog-poll');
      expect(state.status).toBe('ready');
      expect(state.bookId).toBe('lib-polled');
    });
  });

  describe('error handling', () => {
    it('should handle API error response', async () => {
      fetchMock.mockResolvedValueOnce(
        mockErrorResponse(409, {
          code: 'CONFLICT',
          message: 'Title currently unavailable. Please check back later.',
        }),
      );

      const { result } = renderHook(() => useCatalogImport());

      await act(async () => {
        await result.current.importBook('catalog-err');
      });

      const state = result.current.getImportState('catalog-err');
      expect(state.status).toBe('error');
      expect(state.error).toBe('Title currently unavailable. Please check back later.');

      // Verify error toast
      expect(mockDispatch).toHaveBeenCalledWith('toast', {
        message: 'Title currently unavailable. Please check back later.',
        type: 'error',
      });
    });

    it('should handle network failure', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      const { result } = renderHook(() => useCatalogImport());

      await act(async () => {
        await result.current.importBook('catalog-net-err');
      });

      const state = result.current.getImportState('catalog-net-err');
      expect(state.status).toBe('error');
      expect(state.error).toBe('Network error');
    });

    it('should handle 404 not found error', async () => {
      fetchMock.mockResolvedValueOnce(
        mockErrorResponse(404, { code: 'NOT_FOUND', message: 'Catalog book not found' }),
      );

      const { result } = renderHook(() => useCatalogImport());

      await act(async () => {
        await result.current.importBook('catalog-missing');
      });

      const state = result.current.getImportState('catalog-missing');
      expect(state.status).toBe('error');
      expect(state.error).toBe('Catalog book not found');
    });
  });

  describe('concurrent imports', () => {
    it('should track multiple books independently', async () => {
      fetchMock
        .mockResolvedValueOnce(
          mockImportResponse('ready', {
            book_id: 'lib-a',
            download_url: 'https://example.com/a.epub',
          }),
        )
        .mockResolvedValueOnce(
          mockImportResponse('ready', {
            book_id: 'lib-b',
            download_url: 'https://example.com/b.epub',
          }),
        );

      const { result } = renderHook(() => useCatalogImport());

      await act(async () => {
        await Promise.all([
          result.current.importBook('book-a'),
          result.current.importBook('book-b'),
        ]);
      });

      expect(result.current.getImportState('book-a').status).toBe('ready');
      expect(result.current.getImportState('book-a').bookId).toBe('lib-a');
      expect(result.current.getImportState('book-b').status).toBe('ready');
      expect(result.current.getImportState('book-b').bookId).toBe('lib-b');
    });
  });

  describe('duplicate prevention', () => {
    it('should not start a new import if already importing', async () => {
      // First call returns 'preparing' and will start polling
      fetchMock.mockResolvedValueOnce(mockImportResponse('preparing'));

      const { result } = renderHook(() => useCatalogImport());

      // Start first import
      act(() => {
        result.current.importBook('dup-book');
      });

      // Try starting a second import for the same book — should be a no-op
      await act(async () => {
        await result.current.importBook('dup-book');
      });

      // Only one fetch call for the initial import
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('resetImportState', () => {
    it('should reset a book import state to idle', async () => {
      fetchMock.mockResolvedValueOnce(
        mockImportResponse('ready', {
          book_id: 'lib-reset',
          download_url: 'https://example.com/reset.epub',
        }),
      );

      const { result } = renderHook(() => useCatalogImport());

      await act(async () => {
        await result.current.importBook('reset-book');
      });

      expect(result.current.getImportState('reset-book').status).toBe('ready');

      act(() => {
        result.current.resetImportState('reset-book');
      });

      expect(result.current.getImportState('reset-book')).toEqual({ status: 'idle' });
    });
  });

  describe('import state persistence', () => {
    it('should preserve import states across re-renders', async () => {
      fetchMock.mockResolvedValueOnce(
        mockImportResponse('ready', {
          book_id: 'lib-persist',
          download_url: 'https://example.com/persist.epub',
        }),
      );

      const { result, rerender } = renderHook(() => useCatalogImport());

      await act(async () => {
        await result.current.importBook('persist-book');
      });

      expect(result.current.getImportState('persist-book').status).toBe('ready');

      // Re-render the hook
      rerender();

      // State should persist
      expect(result.current.getImportState('persist-book').status).toBe('ready');
    });
  });

  describe('library limit check', () => {
    it('should block import when library limit is reached', async () => {
      mockLibraryLimitState.canAddBook = false;
      mockLibraryLimitState.libraryLimit = 10;
      mockLibraryLimitState.currentCount = 10;

      const { result } = renderHook(() => useCatalogImport());

      await act(async () => {
        await result.current.importBook('limit-book');
      });

      // Should show warning toast, not make any API call
      expect(mockDispatch).toHaveBeenCalledWith('toast', {
        message: 'Library full (10 books). Upgrade for unlimited.',
        type: 'warning',
      });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(result.current.getImportState('limit-book')).toEqual({ status: 'idle' });
    });

    it('should allow import when library limit is not reached', async () => {
      mockLibraryLimitState.canAddBook = true;
      mockLibraryLimitState.libraryLimit = 10;
      mockLibraryLimitState.currentCount = 5;

      fetchMock.mockResolvedValueOnce(
        mockImportResponse('ready', {
          book_id: 'lib-ok',
          book_hash: 'catalog:ok-1',
          download_url: 'https://example.com/ok.epub',
        }),
      );

      const { result } = renderHook(() => useCatalogImport());

      await act(async () => {
        await result.current.importBook('ok-book');
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result.current.getImportState('ok-book').status).toBe('ready');
    });
  });
});
