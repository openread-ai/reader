import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useLibraryBooks, getBookProgressPercentage } from '@/hooks/useLibraryBooks';
import type { Book } from '@/types/book';

// Create a mock store state
const mockStoreState = {
  library: [] as Book[],
  libraryLoaded: true,
};

// Mock the libraryStore
vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: (selector: (state: typeof mockStoreState) => unknown) =>
    selector(mockStoreState),
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

describe('useLibraryBooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStoreState.library = [];
    mockStoreState.libraryLoaded = true;
  });

  describe('Basic functionality', () => {
    it('should return empty array when no books', () => {
      mockStoreState.library = [];
      const { result } = renderHook(() => useLibraryBooks());
      expect(result.current.books).toEqual([]);
      expect(result.current.isLoading).toBe(false);
    });

    it('should return isLoading true when library not loaded', () => {
      mockStoreState.libraryLoaded = false;
      const { result } = renderHook(() => useLibraryBooks());
      expect(result.current.isLoading).toBe(true);
    });

    it('should return all visible books by default', () => {
      const books = [createMockBook({ hash: 'book-1' }), createMockBook({ hash: 'book-2' })];
      mockStoreState.library = books;
      const { result } = renderHook(() => useLibraryBooks());
      expect(result.current.books).toHaveLength(2);
    });

    it('should return all books in library', () => {
      const books = [
        createMockBook({ hash: 'book-1' }),
        createMockBook({ hash: 'book-2' }),
        createMockBook({ hash: 'book-3' }),
      ];
      mockStoreState.library = books;
      const { result } = renderHook(() => useLibraryBooks());
      expect(result.current.books).toHaveLength(3);
    });
  });

  describe('Reading filter', () => {
    it('should filter books with progress > 0 and < 100', () => {
      const books = [
        createMockBook({ hash: 'reading', progress: [50, 100] }),
        createMockBook({ hash: 'not-started', progress: [0, 100] }),
        createMockBook({ hash: 'finished', progress: [100, 100] }),
        createMockBook({ hash: 'no-progress' }),
      ];
      mockStoreState.library = books;
      const { result } = renderHook(() => useLibraryBooks({ filter: 'reading' }));
      expect(result.current.books).toHaveLength(1);
      expect(result.current.books[0]?.hash).toBe('reading');
    });

    it('should include books with readingStatus reading', () => {
      const books = [
        createMockBook({ hash: 'reading-status', readingStatus: 'reading' }),
        createMockBook({ hash: 'unread-status', readingStatus: 'unread' }),
      ];
      mockStoreState.library = books;
      const { result } = renderHook(() => useLibraryBooks({ filter: 'reading' }));
      expect(result.current.books).toHaveLength(1);
      expect(result.current.books[0]?.hash).toBe('reading-status');
    });
  });

  describe('Recent filter', () => {
    it('should sort by createdAt descending', () => {
      const books = [
        createMockBook({ hash: 'old', createdAt: 1000 }),
        createMockBook({ hash: 'new', createdAt: 3000 }),
        createMockBook({ hash: 'mid', createdAt: 2000 }),
      ];
      mockStoreState.library = books;
      const { result } = renderHook(() => useLibraryBooks({ filter: 'recent' }));
      expect(result.current.books[0]?.hash).toBe('new');
      expect(result.current.books[1]?.hash).toBe('mid');
      expect(result.current.books[2]?.hash).toBe('old');
    });
  });

  describe('Want to read filter', () => {
    it('should filter books with readingStatus unread', () => {
      const books = [
        createMockBook({ hash: 'unread', readingStatus: 'unread' }),
        createMockBook({ hash: 'reading', readingStatus: 'reading' }),
        createMockBook({ hash: 'finished', readingStatus: 'finished' }),
      ];
      mockStoreState.library = books;
      const { result } = renderHook(() => useLibraryBooks({ filter: 'want-to-read' }));
      expect(result.current.books).toHaveLength(1);
      expect(result.current.books[0]?.hash).toBe('unread');
    });

    it('should include books with no progress and no status', () => {
      const books = [
        createMockBook({ hash: 'no-progress' }),
        createMockBook({ hash: 'with-progress', progress: [10, 100] }),
      ];
      mockStoreState.library = books;
      const { result } = renderHook(() => useLibraryBooks({ filter: 'want-to-read' }));
      expect(result.current.books).toHaveLength(1);
      expect(result.current.books[0]?.hash).toBe('no-progress');
    });
  });

  describe('Finished filter', () => {
    it('should filter books with progress 100%', () => {
      const books = [
        createMockBook({ hash: 'finished', progress: [100, 100] }),
        createMockBook({ hash: 'not-finished', progress: [50, 100] }),
      ];
      mockStoreState.library = books;
      const { result } = renderHook(() => useLibraryBooks({ filter: 'finished' }));
      expect(result.current.books).toHaveLength(1);
      expect(result.current.books[0]?.hash).toBe('finished');
    });

    it('should include books with readingStatus finished', () => {
      const books = [
        createMockBook({ hash: 'finished-status', readingStatus: 'finished' }),
        createMockBook({ hash: 'reading-status', readingStatus: 'reading' }),
      ];
      mockStoreState.library = books;
      const { result } = renderHook(() => useLibraryBooks({ filter: 'finished' }));
      expect(result.current.books).toHaveLength(1);
      expect(result.current.books[0]?.hash).toBe('finished-status');
    });
  });

  describe('Format filters', () => {
    it('should filter EPUB and Kindle format books', () => {
      const books = [
        createMockBook({ hash: 'epub', format: 'epub' }),
        createMockBook({ hash: 'pdf', format: 'pdf' }),
        createMockBook({ hash: 'mobi', format: 'mobi' }),
        createMockBook({ hash: 'azw', format: 'azw' }),
        createMockBook({ hash: 'azw3', format: 'azw3' }),
      ];
      mockStoreState.library = books;
      const { result } = renderHook(() => useLibraryBooks({ filter: 'books' }));
      expect(result.current.books).toHaveLength(4);
      expect(result.current.books.map((b) => b.hash)).toContain('epub');
      expect(result.current.books.map((b) => b.hash)).toContain('mobi');
      expect(result.current.books.map((b) => b.hash)).toContain('azw');
      expect(result.current.books.map((b) => b.hash)).toContain('azw3');
    });

    it('should filter PDF books', () => {
      const books = [
        createMockBook({ hash: 'epub', format: 'epub' }),
        createMockBook({ hash: 'pdf', format: 'pdf' }),
      ];
      mockStoreState.library = books;
      const { result } = renderHook(() => useLibraryBooks({ filter: 'pdfs' }));
      expect(result.current.books).toHaveLength(1);
      expect(result.current.books[0]?.hash).toBe('pdf');
    });
  });

  describe('Limit', () => {
    it('should limit results when limit is specified', () => {
      const books = Array.from({ length: 10 }, (_, i) =>
        createMockBook({ hash: `book-${i}`, createdAt: i * 1000 }),
      );
      mockStoreState.library = books;
      const { result } = renderHook(() => useLibraryBooks({ limit: 5 }));
      expect(result.current.books).toHaveLength(5);
    });

    it('should return all books when limit is greater than count', () => {
      const books = [createMockBook({ hash: 'book-1' }), createMockBook({ hash: 'book-2' })];
      mockStoreState.library = books;
      const { result } = renderHook(() => useLibraryBooks({ limit: 10 }));
      expect(result.current.books).toHaveLength(2);
    });
  });
});

describe('getBookProgressPercentage', () => {
  it('should calculate correct percentage', () => {
    const book = createMockBook({ progress: [50, 100] });
    expect(getBookProgressPercentage(book)).toBe(50);
  });

  it('should return 0 when no progress', () => {
    const book = createMockBook({ progress: undefined });
    expect(getBookProgressPercentage(book)).toBe(0);
  });

  it('should return 0 when total is 0', () => {
    const book = createMockBook({ progress: [0, 0] });
    expect(getBookProgressPercentage(book)).toBe(0);
  });

  it('should calculate fractional progress', () => {
    const book = createMockBook({ progress: [33, 100] });
    expect(getBookProgressPercentage(book)).toBe(33);
  });
});
