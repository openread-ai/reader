import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useSampleBook } from '@/hooks/useSampleBook';
import { SAMPLE_BOOK_ATTEMPTED_KEY } from '@/lib/sample-book';
import type { Book } from '@/types/book';

// ── Mocks ───────────────────────────────────────────────

const mockImportSampleBook = vi.fn().mockResolvedValue(true);
const mockPullNow = vi.fn().mockResolvedValue(undefined);

// Mock sample-book module
vi.mock('@/lib/sample-book', () => ({
  SAMPLE_BOOK_ATTEMPTED_KEY: 'sample_book_attempted',
  importSampleBook: (...args: unknown[]) => mockImportSampleBook(...args),
}));

// Mock syncWorker
vi.mock('@/services/sync/syncWorker', () => ({
  syncWorker: {
    pullNow: (...args: unknown[]) => mockPullNow(...args),
  },
}));

// Mock logger
vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock useAuth
const mockAuthReturn = { user: null as unknown, token: null as string | null };
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => mockAuthReturn,
}));

// Mock useLibraryStore
const mockLibraryState = {
  libraryLoaded: true,
  library: [] as Book[],
};

vi.mock('@/store/libraryStore', () => {
  const store = Object.assign(
    (selector?: (s: typeof mockLibraryState) => unknown) => {
      if (selector) return selector(mockLibraryState);
      return mockLibraryState;
    },
    {
      getState: () => mockLibraryState,
    },
  );
  return { useLibraryStore: store };
});

describe('useSampleBook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockAuthReturn.user = null;
    mockAuthReturn.token = null;
    mockLibraryState.libraryLoaded = true;
    mockLibraryState.library = [];
    mockImportSampleBook.mockResolvedValue(true);
    mockPullNow.mockResolvedValue(undefined);
  });

  it('should not import when user is not logged in', async () => {
    mockAuthReturn.user = null;
    mockAuthReturn.token = null;

    renderHook(() => useSampleBook());

    // Wait a bit and verify no import
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockImportSampleBook).not.toHaveBeenCalled();
  });

  it('should not import when library is not loaded', async () => {
    mockAuthReturn.user = { id: 'user-1' };
    mockAuthReturn.token = 'test-token';
    mockLibraryState.libraryLoaded = false;

    renderHook(() => useSampleBook());

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockImportSampleBook).not.toHaveBeenCalled();
  });

  it('should not import when already attempted (localStorage flag set)', async () => {
    mockAuthReturn.user = { id: 'user-1' };
    mockAuthReturn.token = 'test-token';
    localStorage.setItem(SAMPLE_BOOK_ATTEMPTED_KEY, '2024-01-01T00:00:00.000Z');

    renderHook(() => useSampleBook());

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockImportSampleBook).not.toHaveBeenCalled();
  });

  it('should not import when library has books', async () => {
    mockAuthReturn.user = { id: 'user-1' };
    mockAuthReturn.token = 'test-token';
    mockLibraryState.library = [{ hash: 'book-1', title: 'Existing Book' } as Book];

    renderHook(() => useSampleBook());

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockImportSampleBook).not.toHaveBeenCalled();
  });

  it('should not import when library has only deleted books', async () => {
    mockAuthReturn.user = { id: 'user-1' };
    mockAuthReturn.token = 'test-token';
    mockLibraryState.library = [{ hash: 'book-1', title: 'Deleted Book', deletedAt: 1000 } as Book];

    renderHook(() => useSampleBook());

    await waitFor(() => {
      expect(mockImportSampleBook).toHaveBeenCalledWith('test-token');
    });
  });

  it('should import sample book on first login with empty library', async () => {
    mockAuthReturn.user = { id: 'user-1' };
    mockAuthReturn.token = 'test-token';
    mockLibraryState.library = [];

    renderHook(() => useSampleBook());

    await waitFor(() => {
      expect(mockImportSampleBook).toHaveBeenCalledWith('test-token');
    });
  });

  it('should trigger pullNow after successful import', async () => {
    mockAuthReturn.user = { id: 'user-1' };
    mockAuthReturn.token = 'test-token';
    mockImportSampleBook.mockResolvedValue(true);

    renderHook(() => useSampleBook());

    await waitFor(() => {
      expect(mockPullNow).toHaveBeenCalledWith('books');
    });
  });

  it('should not trigger pullNow after failed import', async () => {
    mockAuthReturn.user = { id: 'user-1' };
    mockAuthReturn.token = 'test-token';
    mockImportSampleBook.mockResolvedValue(false);

    renderHook(() => useSampleBook());

    await waitFor(() => {
      expect(mockImportSampleBook).toHaveBeenCalled();
    });

    // Wait a bit more and verify pullNow was NOT called
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockPullNow).not.toHaveBeenCalled();
  });

  it('should only attempt import once per mount', async () => {
    mockAuthReturn.user = { id: 'user-1' };
    mockAuthReturn.token = 'test-token';

    const { rerender } = renderHook(() => useSampleBook());

    await waitFor(() => {
      expect(mockImportSampleBook).toHaveBeenCalledTimes(1);
    });

    // Re-render
    rerender();

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockImportSampleBook).toHaveBeenCalledTimes(1);
  });
});
