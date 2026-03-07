import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBookActions } from '@/hooks/useBookActions';
import type { Book } from '@/types/book';

// Use vi.hoisted so these variables are available inside vi.mock factories (which are hoisted)
const {
  mockLibraryStoreState,
  mockPlatformSidebarStoreState,
  mockLibraryViewStoreState,
  mockDispatch,
} = vi.hoisted(() => {
  const mockLibraryStoreState = {
    library: [] as Book[],
    updateBook: vi.fn().mockResolvedValue(undefined),
    setLibrary: vi.fn(),
  };
  const mockPlatformSidebarStoreState = {
    addBookToCollection: vi.fn(),
  };
  const mockLibraryViewStoreState = {
    clearSelection: vi.fn(),
    setSelectMode: vi.fn(),
  };
  const mockDispatch = vi.fn();
  return {
    mockLibraryStoreState,
    mockPlatformSidebarStoreState,
    mockLibraryViewStoreState,
    mockDispatch,
  };
});

// Mock environment config
vi.mock('@/services/environment', () => ({
  default: {
    getAppService: vi.fn().mockResolvedValue({
      deleteBook: vi.fn().mockResolvedValue(undefined),
      deleteDir: vi.fn().mockResolvedValue(undefined),
      saveLibraryBooks: vi.fn().mockResolvedValue(undefined),
    }),
  },
  getAPIBaseUrl: vi.fn(() => 'http://localhost:3000/api'),
}));

// Mock event dispatcher
vi.mock('@/utils/event', () => ({
  eventDispatcher: {
    dispatch: (...args: unknown[]) => mockDispatch(...args),
  },
}));

// Mock stores - useLibraryStore also needs getState for optimistic rollback
vi.mock('@/store/libraryStore', () => {
  const useLibraryStoreMock = (selector: (state: typeof mockLibraryStoreState) => unknown) =>
    selector(mockLibraryStoreState);
  useLibraryStoreMock.getState = () => mockLibraryStoreState;
  return { useLibraryStore: useLibraryStoreMock };
});

vi.mock('@/store/platformSidebarStore', () => ({
  usePlatformSidebarStore: (selector: (state: typeof mockPlatformSidebarStoreState) => unknown) =>
    selector(mockPlatformSidebarStoreState),
}));

vi.mock('@/store/libraryViewStore', () => ({
  useLibraryViewStore: (selector: (state: typeof mockLibraryViewStoreState) => unknown) =>
    selector(mockLibraryViewStoreState),
}));

vi.mock('@/store/bookDataStore', () => {
  const mockBookDataStore = {
    getConfig: vi.fn(),
    setConfig: vi.fn(),
  };
  const useBookDataStoreMock = (selector: (state: typeof mockBookDataStore) => unknown) =>
    selector(mockBookDataStore);
  useBookDataStoreMock.getState = () => mockBookDataStore;
  return { useBookDataStore: useBookDataStoreMock };
});

vi.mock('@/utils/access', () => ({
  getAccessToken: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/services/sync/helpers', () => ({
  enqueueAndSync: vi.fn(),
  enqueueBatchAndSync: vi.fn(),
}));

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

const createMockBook = (overrides: Partial<Book> = {}): Book => ({
  hash: `hash-${Math.random().toString(36).substring(7)}`,
  title: 'Test Book',
  author: 'Test Author',
  format: 'epub',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  coverImageUrl: null,
  ...overrides,
});

describe('useBookActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLibraryStoreState.library = [];
    mockLibraryStoreState.updateBook = vi.fn().mockResolvedValue(undefined);
    mockLibraryStoreState.setLibrary = vi.fn();
    mockPlatformSidebarStoreState.addBookToCollection = vi.fn();
    mockLibraryViewStoreState.clearSelection = vi.fn();
    mockLibraryViewStoreState.setSelectMode = vi.fn();
  });

  describe('setReadingStatus', () => {
    it('updates book reading status', async () => {
      const mockBook = createMockBook({ hash: 'book-123' });
      const { result } = renderHook(() => useBookActions());

      await act(async () => {
        await result.current.setReadingStatus(mockBook, 'finished');
      });

      expect(mockLibraryStoreState.updateBook).toHaveBeenCalledTimes(1);
      const [, updatedBook] = mockLibraryStoreState.updateBook.mock.calls[0] as [unknown, Book];
      expect(updatedBook.hash).toBe('book-123');
      expect(updatedBook.readingStatus).toBe('finished');
      expect(updatedBook.updatedAt).toBeGreaterThan(0);
    });

    it('updates book reading status to unread', async () => {
      const mockBook = createMockBook({ hash: 'book-456', readingStatus: 'finished' });
      const { result } = renderHook(() => useBookActions());

      await act(async () => {
        await result.current.setReadingStatus(mockBook, 'unread');
      });

      const [, updatedBook] = mockLibraryStoreState.updateBook.mock.calls[0] as [unknown, Book];
      expect(updatedBook.readingStatus).toBe('unread');
    });

    it('updates book reading status to reading', async () => {
      const mockBook = createMockBook({ hash: 'book-789' });
      const { result } = renderHook(() => useBookActions());

      await act(async () => {
        await result.current.setReadingStatus(mockBook, 'reading');
      });

      const [, updatedBook] = mockLibraryStoreState.updateBook.mock.calls[0] as [unknown, Book];
      expect(updatedBook.readingStatus).toBe('reading');
    });
  });

  describe('renameBook', () => {
    it('updates book title', async () => {
      const mockBook = createMockBook({ hash: 'book-123', title: 'Old Title' });
      const { result } = renderHook(() => useBookActions());

      await act(async () => {
        await result.current.renameBook(mockBook, 'New Title');
      });

      expect(mockLibraryStoreState.updateBook).toHaveBeenCalledTimes(1);
      const [, updatedBook] = mockLibraryStoreState.updateBook.mock.calls[0] as [unknown, Book];
      expect(updatedBook.title).toBe('New Title');
    });

    it('trims whitespace from title', async () => {
      const mockBook = createMockBook({ hash: 'book-123' });
      const { result } = renderHook(() => useBookActions());

      await act(async () => {
        await result.current.renameBook(mockBook, '  Trimmed Title  ');
      });

      const [, updatedBook] = mockLibraryStoreState.updateBook.mock.calls[0] as [unknown, Book];
      expect(updatedBook.title).toBe('Trimmed Title');
    });

    it('does not update if title is empty', async () => {
      const mockBook = createMockBook({ hash: 'book-123' });
      const { result } = renderHook(() => useBookActions());

      await act(async () => {
        await result.current.renameBook(mockBook, '   ');
      });

      expect(mockLibraryStoreState.updateBook).not.toHaveBeenCalled();
    });

    it('does not update if title is empty string', async () => {
      const mockBook = createMockBook({ hash: 'book-123' });
      const { result } = renderHook(() => useBookActions());

      await act(async () => {
        await result.current.renameBook(mockBook, '');
      });

      expect(mockLibraryStoreState.updateBook).not.toHaveBeenCalled();
    });
  });

  describe('bulkSetReadingStatus', () => {
    it('updates multiple books and exits select mode', async () => {
      const books = [
        createMockBook({ hash: 'book-1' }),
        createMockBook({ hash: 'book-2' }),
        createMockBook({ hash: 'book-3' }),
      ];
      mockLibraryStoreState.library = books;
      const hashes = ['book-1', 'book-2', 'book-3'];
      const { result } = renderHook(() => useBookActions());

      await act(async () => {
        await result.current.bulkSetReadingStatus(hashes, 'finished');
      });

      expect(mockLibraryStoreState.updateBook).toHaveBeenCalledTimes(3);
      expect(mockLibraryViewStoreState.clearSelection).toHaveBeenCalled();
      expect(mockLibraryViewStoreState.setSelectMode).toHaveBeenCalledWith(false);
    });

    it('sets correct reading status for each book', async () => {
      const books = [createMockBook({ hash: 'book-1' }), createMockBook({ hash: 'book-2' })];
      mockLibraryStoreState.library = books;
      const { result } = renderHook(() => useBookActions());

      await act(async () => {
        await result.current.bulkSetReadingStatus(['book-1', 'book-2'], 'unread');
      });

      const calls = mockLibraryStoreState.updateBook.mock.calls as [unknown, Book][];
      calls.forEach(([, book]) => {
        expect(book.readingStatus).toBe('unread');
      });
    });

    it('skips books that are not found in library', async () => {
      const books = [createMockBook({ hash: 'book-1' })];
      mockLibraryStoreState.library = books;
      const { result } = renderHook(() => useBookActions());

      await act(async () => {
        await result.current.bulkSetReadingStatus(['book-1', 'nonexistent'], 'finished');
      });

      // Only the existing book should be updated
      expect(mockLibraryStoreState.updateBook).toHaveBeenCalledTimes(1);
    });
  });

  describe('bulkRemove', () => {
    it('clears selection and exits select mode', async () => {
      const books = [createMockBook({ hash: 'book-1' }), createMockBook({ hash: 'book-2' })];
      mockLibraryStoreState.library = books;
      const { result } = renderHook(() => useBookActions());

      await act(async () => {
        await result.current.bulkRemove(['book-1', 'book-2']);
      });

      expect(mockLibraryViewStoreState.clearSelection).toHaveBeenCalled();
      expect(mockLibraryViewStoreState.setSelectMode).toHaveBeenCalledWith(false);
    });

    it('skips books that are not found in library', async () => {
      const books = [createMockBook({ hash: 'book-1' })];
      mockLibraryStoreState.library = books;
      const { result } = renderHook(() => useBookActions());

      await act(async () => {
        await result.current.bulkRemove(['book-1', 'nonexistent']);
      });

      // Only one book should be processed
      expect(mockLibraryViewStoreState.clearSelection).toHaveBeenCalled();
    });

    it('does nothing for empty books', async () => {
      mockLibraryStoreState.library = [];
      const { result } = renderHook(() => useBookActions());

      await act(async () => {
        await result.current.bulkRemove(['nonexistent']);
      });

      expect(mockLibraryViewStoreState.clearSelection).not.toHaveBeenCalled();
    });
  });

  describe('bulkAddToCollection', () => {
    it('adds multiple books to collection and exits select mode', async () => {
      const { result } = renderHook(() => useBookActions());

      act(() => {
        result.current.bulkAddToCollection(['book-1', 'book-2'], 'collection-123');
      });

      expect(mockPlatformSidebarStoreState.addBookToCollection).toHaveBeenCalledTimes(2);
      expect(mockPlatformSidebarStoreState.addBookToCollection).toHaveBeenCalledWith(
        'collection-123',
        'book-1',
      );
      expect(mockPlatformSidebarStoreState.addBookToCollection).toHaveBeenCalledWith(
        'collection-123',
        'book-2',
      );
      expect(mockLibraryViewStoreState.clearSelection).toHaveBeenCalled();
      expect(mockLibraryViewStoreState.setSelectMode).toHaveBeenCalledWith(false);
    });

    it('handles empty hashes array', () => {
      const { result } = renderHook(() => useBookActions());

      act(() => {
        result.current.bulkAddToCollection([], 'collection-123');
      });

      expect(mockPlatformSidebarStoreState.addBookToCollection).not.toHaveBeenCalled();
      expect(mockLibraryViewStoreState.clearSelection).toHaveBeenCalled();
      expect(mockLibraryViewStoreState.setSelectMode).toHaveBeenCalledWith(false);
    });

    it('adds single book to collection', () => {
      const { result } = renderHook(() => useBookActions());

      act(() => {
        result.current.bulkAddToCollection(['book-1'], 'collection-456');
      });

      expect(mockPlatformSidebarStoreState.addBookToCollection).toHaveBeenCalledTimes(1);
      expect(mockPlatformSidebarStoreState.addBookToCollection).toHaveBeenCalledWith(
        'collection-456',
        'book-1',
      );
    });
  });

  describe('hook return value', () => {
    it('returns all expected actions', () => {
      const { result } = renderHook(() => useBookActions());

      expect(result.current).toHaveProperty('setReadingStatus');
      expect(result.current).toHaveProperty('renameBook');
      expect(result.current).toHaveProperty('permanentlyDeleteBook');
      expect(result.current).toHaveProperty('bulkSetReadingStatus');
      expect(result.current).toHaveProperty('bulkRemove');
      expect(result.current).toHaveProperty('bulkAddToCollection');

      expect(typeof result.current.setReadingStatus).toBe('function');
      expect(typeof result.current.renameBook).toBe('function');
      expect(typeof result.current.permanentlyDeleteBook).toBe('function');
      expect(typeof result.current.bulkSetReadingStatus).toBe('function');
      expect(typeof result.current.bulkRemove).toBe('function');
      expect(typeof result.current.bulkAddToCollection).toBe('function');
    });
  });
});
