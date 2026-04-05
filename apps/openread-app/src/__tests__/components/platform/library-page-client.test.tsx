import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { LibraryPageClient } from '@/app/(platform)/library/client';
import type { Book } from '@/types/book';
import type { GridSize } from '@/store/libraryViewStore';

// Hoisted mocks (available inside vi.mock factories)
const { mockSetLibrary } = vi.hoisted(() => ({
  mockSetLibrary: vi.fn(),
}));

// Mock functions
const mockSyncBooks = vi.fn().mockResolvedValue(undefined);
const mockSelectFiles = vi.fn().mockResolvedValue({ files: [] });
const mockImportBook = vi.fn().mockResolvedValue({ hash: 'new-book', title: 'New Book' });
const mockSaveLibraryBooks = vi.fn().mockResolvedValue(undefined);
const mockSetSelectMode = vi.fn();
const mockSelectAll = vi.fn();
const mockClearSelection = vi.fn();

// Mock libraryViewStore state
const mockLibraryViewState = {
  searchQuery: '',
  isSelectMode: false,
  selectedBooks: [] as string[],
  gridSize: 'medium' as GridSize,
  groupBy: 'manual' as const,
  setSearchQuery: vi.fn(),
  setGridSize: vi.fn(),
  setGroupBy: vi.fn(),
  setSelectMode: mockSetSelectMode,
  toggleBookSelection: vi.fn(),
  selectAll: mockSelectAll,
  clearSelection: mockClearSelection,
};

// Mock books
const mockBooks: Book[] = [
  {
    hash: 'book-1',
    title: 'Alpha Book',
    author: 'Author A',
    format: 'epub',
    createdAt: 1000,
    updatedAt: 1000,
    coverImageUrl: null,
  },
  {
    hash: 'book-2',
    title: 'Beta Book',
    author: 'Author B',
    format: 'pdf',
    createdAt: 2000,
    updatedAt: 2000,
    coverImageUrl: null,
  },
  {
    hash: 'book-3',
    title: 'Gamma Book',
    author: 'Author A',
    format: 'epub',
    createdAt: 3000,
    updatedAt: 3000,
    readingStatus: 'finished',
    coverImageUrl: null,
  },
];

// Mock next/link
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// Mock useLibrary (initializes library store)
vi.mock('@/hooks/useLibrary', () => ({
  useLibrary: vi.fn(() => ({ libraryLoaded: true })),
}));

// Mock useLibraryBooks
vi.mock('@/hooks/useLibraryBooks', () => ({
  useLibraryBooks: vi.fn(() => ({
    books: mockBooks,
    isLoading: false,
  })),
  getBookProgressPercentage: vi.fn(() => 0),
}));

// Mock useTranslation
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

// Mock useEnv
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    appService: {
      importBook: mockImportBook,
      saveLibraryBooks: mockSaveLibraryBooks,
    },
  }),
}));

// Mock useLibraryStore — must be callable (Zustand stores are functions that accept selectors)
// AND have a .getState() method for imperative access.
vi.mock('@/store/libraryStore', () => {
  const state = {
    library: [] as Book[],
    libraryLoaded: true,
    setLibrary: mockSetLibrary,
    getVisibleLibrary: () => state.library,
  };

  const store = Object.assign(
    (selector?: (s: typeof state) => unknown) => {
      if (selector) return selector(state);
      return state;
    },
    { getState: () => state },
  );

  return { useLibraryStore: store };
});

// Mock DropIndicator
vi.mock('@/components/DropIndicator', () => ({
  default: () => <div data-testid='drop-indicator'>Drop to Import Books</div>,
}));

// Mock constants — spread original to preserve exports used by transitive imports
vi.mock('@/services/constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/constants')>();
  return {
    ...actual,
    SUPPORTED_BOOK_EXTS: ['epub', 'mobi', 'azw', 'azw3', 'fb2', 'zip', 'cbz', 'pdf', 'txt'],
    BOOK_ACCEPT_FORMATS: '.epub, .mobi, .azw, .azw3, .fb2, .zip, .cbz, .pdf, .txt',
  };
});

// Mock useAuth
const mockUser = { id: 'user-1', email: 'test@example.com' };
vi.mock('@/context/AuthContext', () => ({
  useAuth: vi.fn(() => ({
    user: null,
    token: null,
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
  })),
}));

// Mock useFileSelector
vi.mock('@/hooks/useFileSelector', () => ({
  useFileSelector: () => ({
    selectFiles: mockSelectFiles,
  }),
}));

// Mock useSync
vi.mock('@/hooks/useSync', () => ({
  useSync: vi.fn(() => ({
    syncBooks: mockSyncBooks,
    useSyncInited: true,
    syncing: false,
    syncError: null,
  })),
}));

// Mock useLibraryLimit — prevent jwtDecode crash from fake token strings
vi.mock('@/hooks/useLibraryLimit', () => ({
  useLibraryLimit: vi.fn(() => ({
    canAddBook: true,
    libraryLimit: null,
    currentCount: 0,
    plan: 'free',
    upgradeTierName: 'Reader',
    upgradePriceCents: 499,
    isLoading: false,
  })),
}));

// Mock useWelcomeScreen — prevent welcome screen from hiding BookGrid
vi.mock('@/hooks/useWelcomeScreen', () => ({
  useWelcomeScreen: vi.fn(() => ({
    showWelcome: false,
    dismissWelcome: vi.fn(),
  })),
}));

// Mock useOnboarding — prevent onboarding dialog from appearing
vi.mock('@/hooks/useOnboarding', () => ({
  useOnboarding: vi.fn(() => ({
    showOnboarding: false,
    completeOnboarding: vi.fn(),
  })),
}));

// Mock useLibraryViewStore
vi.mock('@/store/libraryViewStore', () => ({
  useLibraryViewStore: vi.fn((selector?: (state: typeof mockLibraryViewState) => unknown) => {
    if (selector) {
      return selector(mockLibraryViewState);
    }
    return mockLibraryViewState;
  }),
}));

// Mock BookGrid
vi.mock('@/components/platform/book-grid', () => ({
  BookGrid: ({
    books,
    isLoading,
    emptyMessage,
  }: {
    books: Book[];
    isLoading?: boolean;
    emptyMessage?: string;
  }) => (
    <div data-testid='book-grid' data-loading={isLoading} data-empty-message={emptyMessage}>
      {books.map((book) => (
        <div key={book.hash} data-testid={`book-${book.hash}`}>
          {book.title}
        </div>
      ))}
    </div>
  ),
}));

// Mock LibraryHeader
vi.mock('@/components/platform/library-header', () => ({
  LibraryHeader: ({
    title,
    bookCount,
    onImport,
  }: {
    title: string;
    bookCount: number;
    onImport: () => void;
  }) => (
    <div data-testid='library-header'>
      <span data-testid='header-title'>{title}</span>
      <span data-testid='book-count'>{bookCount}</span>
      <button data-testid='import-button' onClick={onImport}>
        Import
      </button>
    </div>
  ),
}));

// Mock SelectionToolbar
vi.mock('@/components/platform/selection-toolbar', () => ({
  SelectionToolbar: ({
    totalCount,
    allBookHashes,
  }: {
    totalCount: number;
    allBookHashes: string[];
  }) => (
    <div
      data-testid='selection-toolbar'
      data-total-count={totalCount}
      data-all-hashes={allBookHashes.join(',')}
    >
      Selection Toolbar
    </div>
  ),
}));

// Import mocks for modification in tests
import { useLibraryBooks } from '@/hooks/useLibraryBooks';
import { useLibraryViewStore } from '@/store/libraryViewStore';
import { useAuth } from '@/context/AuthContext';

describe('LibraryPageClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock state
    mockLibraryViewState.searchQuery = '';
    mockLibraryViewState.isSelectMode = false;
    mockLibraryViewState.selectedBooks = [];

    // Reset importBook to default success behavior
    mockImportBook.mockResolvedValue({ hash: 'new-book', title: 'New Book' });

    vi.mocked(useLibraryBooks).mockReturnValue({
      books: mockBooks,
      isLoading: false,
    });

    vi.mocked(useAuth).mockReturnValue({
      user: null,
      token: null,
      login: vi.fn(),
      logout: vi.fn(),
      refresh: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
  });

  describe('Rendering', () => {
    it('should render the library header with title', () => {
      render(<LibraryPageClient filter='all' title='All Books' />);
      expect(screen.getByTestId('header-title').textContent).toBe('All Books');
    });

    it('should render the book grid', () => {
      render(<LibraryPageClient filter='all' title='All Books' />);
      expect(screen.getByTestId('book-grid')).toBeTruthy();
    });

    it('should display correct book count', () => {
      render(<LibraryPageClient filter='all' title='All Books' />);
      expect(screen.getByTestId('book-count').textContent).toBe('3');
    });

    it('should render all books in the grid', () => {
      render(<LibraryPageClient filter='all' title='All Books' />);
      expect(screen.getByTestId('book-book-1')).toBeTruthy();
      expect(screen.getByTestId('book-book-2')).toBeTruthy();
      expect(screen.getByTestId('book-book-3')).toBeTruthy();
    });
  });

  describe('Search Filtering', () => {
    it('should filter books by title (case-insensitive)', () => {
      mockLibraryViewState.searchQuery = 'alpha';
      vi.mocked(useLibraryViewStore).mockImplementation(
        (selector?: (state: typeof mockLibraryViewState) => unknown) => {
          if (selector) {
            return selector(mockLibraryViewState);
          }
          return mockLibraryViewState;
        },
      );

      render(<LibraryPageClient filter='all' title='All Books' />);
      // The book count should be 1 (only Alpha Book matches)
      expect(screen.getByTestId('book-count').textContent).toBe('1');
      expect(screen.getByTestId('book-book-1')).toBeTruthy();
      expect(screen.queryByTestId('book-book-2')).toBeNull();
      expect(screen.queryByTestId('book-book-3')).toBeNull();
    });

    it('should filter books by author (case-insensitive)', () => {
      mockLibraryViewState.searchQuery = 'author a';
      vi.mocked(useLibraryViewStore).mockImplementation(
        (selector?: (state: typeof mockLibraryViewState) => unknown) => {
          if (selector) {
            return selector(mockLibraryViewState);
          }
          return mockLibraryViewState;
        },
      );

      render(<LibraryPageClient filter='all' title='All Books' />);
      // Books 1 and 3 have "Author A"
      expect(screen.getByTestId('book-count').textContent).toBe('2');
      expect(screen.getByTestId('book-book-1')).toBeTruthy();
      expect(screen.queryByTestId('book-book-2')).toBeNull();
      expect(screen.getByTestId('book-book-3')).toBeTruthy();
    });

    it('should show search-specific empty message when no results', () => {
      mockLibraryViewState.searchQuery = 'nonexistent';
      vi.mocked(useLibraryViewStore).mockImplementation(
        (selector?: (state: typeof mockLibraryViewState) => unknown) => {
          if (selector) {
            return selector(mockLibraryViewState);
          }
          return mockLibraryViewState;
        },
      );

      render(<LibraryPageClient filter='all' title='All Books' />);
      const grid = screen.getByTestId('book-grid');
      expect(grid.getAttribute('data-empty-message')).toBe('No books match your search.');
    });

    it('should search client-side without API calls', () => {
      mockLibraryViewState.searchQuery = 'beta';
      vi.mocked(useLibraryViewStore).mockImplementation(
        (selector?: (state: typeof mockLibraryViewState) => unknown) => {
          if (selector) {
            return selector(mockLibraryViewState);
          }
          return mockLibraryViewState;
        },
      );

      render(<LibraryPageClient filter='all' title='All Books' />);
      // Verify books are filtered without additional API calls
      expect(screen.getByTestId('book-book-2')).toBeTruthy();
      expect(screen.queryByTestId('book-book-1')).toBeNull();
    });
  });

  describe('Auto-sync', () => {
    it('should auto-sync on load for logged-in users', async () => {
      vi.mocked(useAuth).mockReturnValue({
        user: mockUser as unknown as ReturnType<typeof useAuth>['user'],
        token: 'test-token',
        login: vi.fn(),
        logout: vi.fn(),
        refresh: vi.fn(),
      });

      render(<LibraryPageClient filter='all' title='All Books' />);

      await waitFor(() => {
        expect(mockSyncBooks).toHaveBeenCalledWith(undefined, 'pull');
      });
    });

    it('should not auto-sync when user is not logged in', async () => {
      vi.mocked(useAuth).mockReturnValue({
        user: null,
        token: null,
        login: vi.fn(),
        logout: vi.fn(),
        refresh: vi.fn(),
      });

      render(<LibraryPageClient filter='all' title='All Books' />);

      // Wait a bit and verify syncBooks was not called
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(mockSyncBooks).not.toHaveBeenCalled();
    });

    it('should only sync once on initial load', async () => {
      vi.mocked(useAuth).mockReturnValue({
        user: mockUser as unknown as ReturnType<typeof useAuth>['user'],
        token: 'test-token',
        login: vi.fn(),
        logout: vi.fn(),
        refresh: vi.fn(),
      });

      const { rerender } = render(<LibraryPageClient filter='all' title='All Books' />);

      await waitFor(() => {
        expect(mockSyncBooks).toHaveBeenCalledTimes(1);
      });

      // Re-render and verify no additional sync
      rerender(<LibraryPageClient filter='all' title='All Books' />);

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(mockSyncBooks).toHaveBeenCalledTimes(1);
    });
  });

  describe('Selection Mode', () => {
    it('should not show selection toolbar when not in select mode', () => {
      mockLibraryViewState.isSelectMode = false;
      vi.mocked(useLibraryViewStore).mockImplementation(
        (selector?: (state: typeof mockLibraryViewState) => unknown) => {
          if (selector) {
            return selector(mockLibraryViewState);
          }
          return mockLibraryViewState;
        },
      );

      render(<LibraryPageClient filter='all' title='All Books' />);
      expect(screen.queryByTestId('selection-toolbar')).toBeNull();
    });

    it('should show selection toolbar when in select mode', () => {
      mockLibraryViewState.isSelectMode = true;
      vi.mocked(useLibraryViewStore).mockImplementation(
        (selector?: (state: typeof mockLibraryViewState) => unknown) => {
          if (selector) {
            return selector(mockLibraryViewState);
          }
          return mockLibraryViewState;
        },
      );

      render(<LibraryPageClient filter='all' title='All Books' />);
      expect(screen.getByTestId('selection-toolbar')).toBeTruthy();
    });

    it('should pass correct totalCount to selection toolbar', () => {
      mockLibraryViewState.isSelectMode = true;
      vi.mocked(useLibraryViewStore).mockImplementation(
        (selector?: (state: typeof mockLibraryViewState) => unknown) => {
          if (selector) {
            return selector(mockLibraryViewState);
          }
          return mockLibraryViewState;
        },
      );

      render(<LibraryPageClient filter='all' title='All Books' />);
      const toolbar = screen.getByTestId('selection-toolbar');
      expect(toolbar.getAttribute('data-total-count')).toBe('3');
    });

    it('should pass correct allBookHashes to selection toolbar', () => {
      mockLibraryViewState.isSelectMode = true;
      vi.mocked(useLibraryViewStore).mockImplementation(
        (selector?: (state: typeof mockLibraryViewState) => unknown) => {
          if (selector) {
            return selector(mockLibraryViewState);
          }
          return mockLibraryViewState;
        },
      );

      render(<LibraryPageClient filter='all' title='All Books' />);
      const toolbar = screen.getByTestId('selection-toolbar');
      const hashes = toolbar.getAttribute('data-all-hashes');
      expect(hashes).toContain('book-1');
      expect(hashes).toContain('book-2');
      expect(hashes).toContain('book-3');
    });

    it('should add bottom padding when toolbar is visible', () => {
      mockLibraryViewState.isSelectMode = true;
      vi.mocked(useLibraryViewStore).mockImplementation(
        (selector?: (state: typeof mockLibraryViewState) => unknown) => {
          if (selector) {
            return selector(mockLibraryViewState);
          }
          return mockLibraryViewState;
        },
      );

      const { container } = render(<LibraryPageClient filter='all' title='All Books' />);
      const paddingDiv = container.querySelector('.h-20');
      expect(paddingDiv).toBeTruthy();
      expect(paddingDiv?.getAttribute('aria-hidden')).toBe('true');
    });

    it('should not add bottom padding when not in select mode', () => {
      mockLibraryViewState.isSelectMode = false;
      vi.mocked(useLibraryViewStore).mockImplementation(
        (selector?: (state: typeof mockLibraryViewState) => unknown) => {
          if (selector) {
            return selector(mockLibraryViewState);
          }
          return mockLibraryViewState;
        },
      );

      const { container } = render(<LibraryPageClient filter='all' title='All Books' />);
      const paddingDiv = container.querySelector('.h-20');
      expect(paddingDiv).toBeNull();
    });
  });

  describe('Filter Types', () => {
    it('should pass filter to useLibraryBooks for books filter', () => {
      render(<LibraryPageClient filter='books' title='Books' />);
      expect(useLibraryBooks).toHaveBeenCalledWith({ filter: 'books' });
    });

    it('should pass filter to useLibraryBooks for pdfs filter', () => {
      render(<LibraryPageClient filter='pdfs' title='PDFs' />);
      expect(useLibraryBooks).toHaveBeenCalledWith({ filter: 'pdfs' });
    });

    it('should pass filter to useLibraryBooks for want-to-read filter', () => {
      render(<LibraryPageClient filter='want-to-read' title='Want to Read' />);
      expect(useLibraryBooks).toHaveBeenCalledWith({ filter: 'want-to-read' });
    });

    it('should pass filter to useLibraryBooks for finished filter', () => {
      render(<LibraryPageClient filter='finished' title='Finished' />);
      expect(useLibraryBooks).toHaveBeenCalledWith({ filter: 'finished' });
    });
  });

  describe('Empty States', () => {
    beforeEach(() => {
      vi.mocked(useLibraryBooks).mockReturnValue({
        books: [],
        isLoading: false,
      });

      // Restore default useLibraryViewStore mock (previous tests may override searchQuery)
      mockLibraryViewState.searchQuery = '';
      vi.mocked(useLibraryViewStore).mockImplementation(
        (selector?: (state: typeof mockLibraryViewState) => unknown) => {
          if (selector) {
            return selector(mockLibraryViewState);
          }
          return mockLibraryViewState;
        },
      );
    });

    it('should show correct empty message for all filter', () => {
      render(<LibraryPageClient filter='all' title='All Books' />);
      const grid = screen.getByTestId('book-grid');
      expect(grid.getAttribute('data-empty-message')).toBe(
        'Your library is empty. Import some books to get started!',
      );
    });

    it('should show correct empty message for want-to-read filter', () => {
      render(<LibraryPageClient filter='want-to-read' title='Want to Read' />);
      const grid = screen.getByTestId('book-grid');
      expect(grid.getAttribute('data-empty-message')).toBe(
        "No books marked as 'Want to Read'. Mark books from your library.",
      );
    });

    it('should show correct empty message for finished filter', () => {
      render(<LibraryPageClient filter='finished' title='Finished' />);
      const grid = screen.getByTestId('book-grid');
      expect(grid.getAttribute('data-empty-message')).toBe(
        "You haven't finished any books yet. Keep reading!",
      );
    });

    it('should show correct empty message for books filter', () => {
      render(<LibraryPageClient filter='books' title='Books' />);
      const grid = screen.getByTestId('book-grid');
      expect(grid.getAttribute('data-empty-message')).toBe(
        'No EPUB books in your library. Import some EPUB files.',
      );
    });

    it('should show correct empty message for pdfs filter', () => {
      render(<LibraryPageClient filter='pdfs' title='PDFs' />);
      const grid = screen.getByTestId('book-grid');
      expect(grid.getAttribute('data-empty-message')).toBe(
        'No PDFs in your library. Import some PDF files.',
      );
    });
  });

  describe('Loading State', () => {
    it('should pass isLoading to BookGrid', () => {
      vi.mocked(useLibraryBooks).mockReturnValue({
        books: [],
        isLoading: true,
      });

      render(<LibraryPageClient filter='all' title='All Books' />);
      const grid = screen.getByTestId('book-grid');
      expect(grid.getAttribute('data-loading')).toBe('true');
    });
  });

  describe('Import Handling', () => {
    it('should have import button in header', () => {
      render(<LibraryPageClient filter='all' title='All Books' />);
      expect(screen.getByTestId('import-button')).toBeTruthy();
    });

    it('should call selectFiles when import button clicked', async () => {
      render(<LibraryPageClient filter='all' title='All Books' />);
      const importButton = screen.getByTestId('import-button');
      importButton.click();

      await waitFor(() => {
        expect(mockSelectFiles).toHaveBeenCalledWith({ type: 'books', multiple: true });
      });
    });

    it('should call appService.importBook for each selected file', async () => {
      const mockFile1 = new File(['content1'], 'book1.epub', { type: 'application/epub+zip' });
      const mockFile2 = new File(['content2'], 'book2.pdf', { type: 'application/pdf' });
      mockSelectFiles.mockResolvedValueOnce({
        files: [{ file: mockFile1 }, { file: mockFile2 }],
      });

      render(<LibraryPageClient filter='all' title='All Books' />);
      const importButton = screen.getByTestId('import-button');
      importButton.click();

      await waitFor(() => {
        expect(mockImportBook).toHaveBeenCalledTimes(2);
        expect(mockImportBook).toHaveBeenCalledWith(mockFile1, expect.any(Array));
        expect(mockImportBook).toHaveBeenCalledWith(mockFile2, expect.any(Array));
      });
    });

    it('should update library store after successful import', async () => {
      const mockFile = new File(['content'], 'book.epub', { type: 'application/epub+zip' });
      mockSelectFiles.mockResolvedValueOnce({
        files: [{ file: mockFile }],
      });

      render(<LibraryPageClient filter='all' title='All Books' />);
      const importButton = screen.getByTestId('import-button');
      importButton.click();

      await waitFor(() => {
        expect(mockSetLibrary).toHaveBeenCalled();
        expect(mockSaveLibraryBooks).toHaveBeenCalled();
      });
    });

    it('should handle import failure gracefully', async () => {
      const mockFile = new File(['content'], 'bad-book.epub', { type: 'application/epub+zip' });
      mockSelectFiles.mockResolvedValueOnce({
        files: [{ file: mockFile }],
      });
      mockImportBook.mockRejectedValueOnce(new Error('Parse error'));

      render(<LibraryPageClient filter='all' title='All Books' />);
      const importButton = screen.getByTestId('import-button');
      importButton.click();

      // Should not throw - error is handled internally
      await waitFor(() => {
        expect(mockImportBook).toHaveBeenCalledTimes(1);
        // Library store should still be updated (with whatever succeeded)
        expect(mockSetLibrary).toHaveBeenCalled();
      });
    });

    it('should handle mixed success/failure imports', async () => {
      const goodFile = new File(['content'], 'good.epub', { type: 'application/epub+zip' });
      const badFile = new File(['content'], 'bad.epub', { type: 'application/epub+zip' });
      mockSelectFiles.mockResolvedValueOnce({
        files: [{ file: goodFile }, { file: badFile }],
      });
      mockImportBook.mockResolvedValueOnce({ hash: 'good', title: 'Good Book' });
      mockImportBook.mockRejectedValueOnce(new Error('Parse error'));

      render(<LibraryPageClient filter='all' title='All Books' />);
      const importButton = screen.getByTestId('import-button');
      importButton.click();

      await waitFor(() => {
        expect(mockImportBook).toHaveBeenCalledTimes(2);
        expect(mockSetLibrary).toHaveBeenCalled();
      });
    });

    it('should import Tauri files via path', async () => {
      mockSelectFiles.mockResolvedValueOnce({
        files: [{ path: '/home/user/books/novel.epub' }],
      });

      render(<LibraryPageClient filter='all' title='All Books' />);
      const importButton = screen.getByTestId('import-button');
      importButton.click();

      await waitFor(() => {
        expect(mockImportBook).toHaveBeenCalledWith(
          '/home/user/books/novel.epub',
          expect.any(Array),
        );
      });
    });
  });

  describe('Drag and Drop', () => {
    it('should show drop indicator when dragging files over', () => {
      const { container } = render(<LibraryPageClient filter='all' title='All Books' />);
      const dropZone = container.firstChild as HTMLElement;

      fireEvent.dragEnter(dropZone);

      expect(screen.getByTestId('drop-indicator')).toBeTruthy();
    });

    it('should hide drop indicator when dragging leaves', () => {
      const { container } = render(<LibraryPageClient filter='all' title='All Books' />);
      const dropZone = container.firstChild as HTMLElement;

      fireEvent.dragEnter(dropZone);
      expect(screen.getByTestId('drop-indicator')).toBeTruthy();

      fireEvent.dragLeave(dropZone);
      expect(screen.queryByTestId('drop-indicator')).toBeNull();
    });

    it('should import supported files on drop', async () => {
      const epubFile = new File(['content'], 'test.epub', { type: 'application/epub+zip' });
      const pdfFile = new File(['content'], 'test.pdf', { type: 'application/pdf' });

      const { container } = render(<LibraryPageClient filter='all' title='All Books' />);
      const dropZone = container.firstChild as HTMLElement;

      fireEvent.drop(dropZone, {
        dataTransfer: {
          files: [epubFile, pdfFile],
        },
      });

      await waitFor(() => {
        expect(mockImportBook).toHaveBeenCalledTimes(2);
      });
    });

    it('should filter out unsupported file types on drop', async () => {
      const epubFile = new File(['content'], 'test.epub', { type: 'application/epub+zip' });
      const jpgFile = new File(['content'], 'image.jpg', { type: 'image/jpeg' });
      const docFile = new File(['content'], 'doc.docx', {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });

      const { container } = render(<LibraryPageClient filter='all' title='All Books' />);
      const dropZone = container.firstChild as HTMLElement;

      fireEvent.drop(dropZone, {
        dataTransfer: {
          files: [epubFile, jpgFile, docFile],
        },
      });

      await waitFor(() => {
        // Only epub should be imported, jpg and docx are unsupported
        expect(mockImportBook).toHaveBeenCalledTimes(1);
        expect(mockImportBook).toHaveBeenCalledWith(epubFile, expect.any(Array));
      });
    });

    it('should hide drop indicator after drop', async () => {
      const epubFile = new File(['content'], 'test.epub', { type: 'application/epub+zip' });

      const { container } = render(<LibraryPageClient filter='all' title='All Books' />);
      const dropZone = container.firstChild as HTMLElement;

      // First drag in to show indicator
      fireEvent.dragEnter(dropZone);
      expect(screen.getByTestId('drop-indicator')).toBeTruthy();

      // Then drop
      fireEvent.drop(dropZone, {
        dataTransfer: {
          files: [epubFile],
        },
      });

      // Drop indicator should be hidden
      expect(screen.queryByTestId('drop-indicator')).toBeNull();
    });

    it('should have drop-zone class on container', () => {
      const { container } = render(<LibraryPageClient filter='all' title='All Books' />);
      const dropZone = container.firstChild as HTMLElement;
      expect(dropZone.className).toContain('drop-zone');
    });
  });
});
