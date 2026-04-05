import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';
import ExploreClient from '@/app/(platform)/explore/client';
import type { CatalogBook } from '@/types/catalog';

// ── Mock Next.js navigation ───────────────────────────
const mockRouterPush = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockRouterPush,
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/explore',
  useSearchParams: () => mockSearchParams,
}));

// ── Mock useCatalogImport ─────────────────────────────
const mockImportBook = vi.fn();
let mockGetImportState = vi.fn(
  (_bookId: string): { status: string; progress: number; bookHash?: string; bookId?: string } => ({
    status: 'idle',
    progress: 0,
  }),
);

vi.mock('@/hooks/useCatalogImport', () => ({
  useCatalogImport: () => ({
    importBook: mockImportBook,
    getImportState: (...args: unknown[]) => mockGetImportState(...(args as [string])),
  }),
}));

// ── Mock navigateToReader ─────────────────────────────
const mockNavigateToReader = vi.fn();
vi.mock('@/utils/nav', () => ({
  navigateToReader: (...args: unknown[]) => mockNavigateToReader(...args),
}));

// ── Mock stores and hooks ──────────────────────────────

let mockSearchQuery = '';
let mockSelectedCategory = '';
let mockLanguages: string[] = ['en'];

const mockSetSearchQuery = vi.fn((q: string) => {
  mockSearchQuery = q;
});
const mockSetSelectedCategory = vi.fn((c: string) => {
  mockSelectedCategory = c;
});

vi.mock('@/store/exploreStore', () => ({
  useExploreStore: () => ({
    searchQuery: mockSearchQuery,
    setSearchQuery: mockSetSearchQuery,
    selectedCategory: mockSelectedCategory,
    setSelectedCategory: mockSetSelectedCategory,
    languages: mockLanguages,
    setLanguages: vi.fn(),
    region: '',
    setRegion: vi.fn(),
    resetFilters: vi.fn(),
  }),
}));

// Mock useTranslation
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

// ── Mock useExploreBooks ───────────────────────────────

const mockBooks: CatalogBook[] = [
  {
    id: 'search-1',
    title: 'Search Result 1',
    author_name: 'Author A',
    language: 'en',
    format_type: 'epub',
    cover_image_key: null,
    cover_is_generated: false,
    is_cached: true,
    import_count: 10,
    page_count: 200,
    file_size_bytes: 3000000,
  },
  {
    id: 'search-2',
    title: 'Search Result 2',
    author_name: 'Author B',
    language: 'en',
    format_type: 'pdf',
    cover_image_key: null,
    cover_is_generated: false,
    is_cached: true,
    import_count: 5,
    page_count: 150,
    file_size_bytes: 2000000,
  },
];

let mockExploreBooksReturn = {
  books: [] as CatalogBook[],
  total: 0,
  isLoading: false,
  isStale: false,
  error: null as string | null,
  hasMore: false,
  loadMore: vi.fn(),
  refresh: vi.fn(),
  iaBooks: [] as CatalogBook[],
  iaTotal: 0,
  iaLoading: false,
  iaError: null as string | null,
  iaLoadMore: vi.fn(),
  iaHasMore: false,
};

vi.mock('@/hooks/useExploreBooks', () => ({
  CATALOG_API_BASE: 'http://localhost:3001',
  useExploreBooks: () => mockExploreBooksReturn,
}));

// ── Mock useExploreCollections ─────────────────────────

const mockCollectionBooks: CatalogBook[] = [
  {
    id: 'col-book-1',
    title: 'Collection Book 1',
    author_name: 'Col Author 1',
    language: 'en',
    format_type: 'epub',
    cover_image_key: null,
    cover_is_generated: false,
    is_cached: true,
    import_count: 50,
    page_count: 300,
    file_size_bytes: 4000000,
  },
];

let mockCollectionsReturn = {
  collections: [
    {
      id: 'col-1',
      slug: 'trending',
      name: 'Trending',
      description: 'Top trending books',
      sort_order: 1,
      book_count: 10,
      books: mockCollectionBooks,
    },
    {
      id: 'col-2',
      slug: 'staff-picks',
      name: 'Staff Picks',
      description: 'Curated by our team',
      sort_order: 2,
      book_count: 5,
      books: mockCollectionBooks,
    },
  ],
  isLoading: false,
  error: null as string | null,
  refresh: vi.fn(),
};

vi.mock('@/hooks/useExploreCollections', () => ({
  useExploreCollections: () => mockCollectionsReturn,
}));

// ── Mock V2 components ─────────────────────────────────

vi.mock('@/components/explore/ExploreSearchBar', () => ({
  ExploreSearchBar: ({
    value,
    onChange,
    onClear,
    placeholder,
    className,
  }: {
    value?: string;
    onChange?: (v: string) => void;
    onClear?: () => void;
    placeholder?: string;
    className?: string;
  }) => (
    <div data-testid='search-bar' className={className}>
      <input
        data-testid='search-input'
        value={value ?? ''}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
      />
      {value && (
        <button type='button' data-testid='search-clear' onClick={onClear}>
          Clear
        </button>
      )}
    </div>
  ),
}));

vi.mock('@/components/explore/CategoryPills', () => ({
  CategoryPills: ({
    onCategoryChange,
    onSelectionChange,
    className,
  }: {
    onCategoryChange?: (subjects: string[] | undefined) => void;
    onSelectionChange?: (cat: unknown, sub: unknown) => void;
    sticky?: boolean;
    className?: string;
  }) => (
    <div data-testid='category-pills' className={className}>
      <button
        type='button'
        data-testid='select-all-category'
        onClick={() => {
          onCategoryChange?.(undefined);
          onSelectionChange?.(null, null);
        }}
      >
        All
      </button>
      <button
        type='button'
        data-testid='select-science-category'
        onClick={() => {
          onCategoryChange?.(['Science', 'Physics', 'Chemistry']);
          onSelectionChange?.({ label: 'Science' }, null);
        }}
      >
        Science
      </button>
    </div>
  ),
}));

vi.mock('@/components/explore/CollectionRow', () => ({
  CollectionRow: ({
    title,
    books,
    isLoading,
    seeAllHref,
    icon,
    wishlistedIds,
    onWishlistToggle,
    onCardTap,
  }: {
    title: string;
    books: CatalogBook[];
    isLoading?: boolean;
    seeAllHref?: string;
    icon?: React.ReactNode;
    wishlistedIds?: Set<string>;
    onWishlistToggle?: (bookId: string) => void;
    onCardTap?: (bookId: string) => void;
  }) => (
    <div data-testid={`collection-row-${title.toLowerCase().replace(/\s+/g, '-')}`}>
      <span data-testid='collection-title'>{title}</span>
      {icon && <span data-testid='collection-icon'>icon</span>}
      {seeAllHref && <a href={seeAllHref}>See All</a>}
      {isLoading && <span data-testid='collection-loading'>Loading...</span>}
      {wishlistedIds !== undefined && <span data-testid='collection-has-wishlist-ids'>true</span>}
      {onWishlistToggle && (
        <button
          type='button'
          data-testid={`collection-wishlist-toggle-${title.toLowerCase().replace(/\s+/g, '-')}`}
          onClick={() => onWishlistToggle('col-book-1')}
        >
          Toggle Wishlist
        </button>
      )}
      {onCardTap && (
        <button
          type='button'
          data-testid={`collection-card-tap-${title.toLowerCase().replace(/\s+/g, '-')}`}
          onClick={() => onCardTap('col-book-1')}
        >
          Tap Card
        </button>
      )}
      {!isLoading &&
        books.map((b) => (
          <span key={b.id} data-testid={`collection-book-${b.id}`}>
            {b.title}
          </span>
        ))}
    </div>
  ),
}));

vi.mock('@/components/explore/ExploreBookCard', () => ({
  ExploreBookCard: ({
    book,
    isIA,
    isWishlisted,
    state,
    onWishlistToggle,
    onOpen,
    onCardTap,
  }: {
    book: CatalogBook;
    isIA?: boolean;
    isWishlisted?: boolean;
    state?: string;
    onWishlistToggle?: (bookId: string) => void;
    onOpen?: (bookId: string) => void;
    onCardTap?: (bookId: string) => void;
  }) => (
    <div
      data-testid={`book-card-${book.id || book.ia_identifier}`}
      data-is-ia={isIA ? 'true' : undefined}
    >
      {book.title}
      {isIA && <span data-testid={`book-ia-badge-${book.ia_identifier}`}>IA</span>}
      {isWishlisted !== undefined && (
        <span data-testid={`book-wishlisted-${book.id}`}>{String(isWishlisted)}</span>
      )}
      {state === 'in-library' && onOpen && (
        <button
          type='button'
          data-testid={`book-open-btn-${book.id}`}
          onClick={() => onOpen(book.id)}
        >
          Open
        </button>
      )}
      {onWishlistToggle && (
        <button
          type='button'
          data-testid={`book-wishlist-btn-${book.id}`}
          onClick={() => onWishlistToggle(book.id)}
        >
          Toggle
        </button>
      )}
      {onCardTap && (
        <button
          type='button'
          data-testid={`card-tap-${book.id || book.ia_identifier}`}
          onClick={() => onCardTap(book.id)}
        >
          Tap
        </button>
      )}
    </div>
  ),
}));

// ── Mock BookDetailSheet ─────────────────────────────
vi.mock('@/components/explore/BookDetailSheet', () => ({
  BookDetailSheet: ({
    book,
    isOpen,
    onClose,
    isWishlisted,
    importState,
    onWishlistToggle,
    onImport,
    onRead,
  }: {
    book: CatalogBook | null;
    isOpen: boolean;
    onClose: () => void;
    isWishlisted?: boolean;
    importState?: string;
    importProgress?: number;
    onWishlistToggle?: () => void;
    onImport?: () => void;
    onRead?: () => void;
  }) =>
    isOpen && book ? (
      <div data-testid='book-detail-sheet'>
        <span data-testid='sheet-book-title'>{book.title}</span>
        <span data-testid='sheet-book-id'>{book.id}</span>
        <span data-testid='sheet-wishlisted'>{String(isWishlisted)}</span>
        <span data-testid='sheet-import-state'>{importState}</span>
        <button type='button' data-testid='sheet-close-btn' onClick={onClose}>
          Close
        </button>
        {onWishlistToggle && (
          <button type='button' data-testid='sheet-wishlist-btn' onClick={onWishlistToggle}>
            Wishlist
          </button>
        )}
        {onImport && (
          <button type='button' data-testid='sheet-import-btn' onClick={onImport}>
            Import
          </button>
        )}
        {onRead && (
          <button type='button' data-testid='sheet-read-btn' onClick={onRead}>
            Read
          </button>
        )}
      </div>
    ) : null,
}));

// ── Mock useAuth ──────────────────────────────────────
let mockToken: string | null = 'test-auth-token';
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    token: mockToken,
    user: mockToken ? { id: 'user-1', email: 'test@test.com' } : null,
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
  }),
}));

// ── Mock useWishlist ──────────────────────────────────
const mockWishlistedIds = new Set<string>();
const mockToggleWishlist = vi.fn();
const mockIsWishlisted = vi.fn((id: string) => mockWishlistedIds.has(id));

vi.mock('@/hooks/useWishlist', () => ({
  useWishlist: () => ({
    wishlistBooks: [],
    wishlistedIds: mockWishlistedIds,
    isLoading: false,
    toggle: mockToggleWishlist,
    isWishlisted: mockIsWishlisted,
    refresh: vi.fn(),
  }),
}));

// Mock ResizeObserver
class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  constructor(_callback: ResizeObserverCallback) {
    // no-op
  }
}
vi.stubGlobal('ResizeObserver', MockResizeObserver);

// Mock IntersectionObserver (used by useIntersectionLoader for infinite scroll sentinels)
class MockIntersectionObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  constructor(_callback: IntersectionObserverCallback, _options?: IntersectionObserverInit) {
    // no-op
  }
}
vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);

// ── Setup / Teardown ───────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockSearchQuery = '';
  mockSelectedCategory = '';
  mockLanguages = ['en'];
  mockToken = 'test-auth-token';
  mockWishlistedIds.clear();
  mockSearchParams = new URLSearchParams();
  mockRouterPush.mockClear();
  mockGetImportState = vi.fn(() => ({ status: 'idle', progress: 0 }));
  mockExploreBooksReturn = {
    books: [],
    total: 0,
    isLoading: false,
    isStale: false,
    error: null,
    hasMore: false,
    loadMore: vi.fn(),
    refresh: vi.fn(),
    iaBooks: [],
    iaTotal: 0,
    iaLoading: false,
    iaError: null,
    iaLoadMore: vi.fn(),
    iaHasMore: false,
  };
  mockCollectionsReturn = {
    collections: [
      {
        id: 'col-1',
        slug: 'trending',
        name: 'Trending',
        description: 'Top trending books',
        sort_order: 1,
        book_count: 10,
        books: mockCollectionBooks,
      },
      {
        id: 'col-2',
        slug: 'staff-picks',
        name: 'Staff Picks',
        description: 'Curated by our team',
        sort_order: 2,
        book_count: 5,
        books: mockCollectionBooks,
      },
    ],
    isLoading: false,
    error: null,
    refresh: vi.fn(),
  };
});

afterEach(() => {
  cleanup();
});

// ── Tests ──────────────────────────────────────────────

describe('ExploreClient', () => {
  describe('Browse Mode (no search, no category)', () => {
    it('should render collection rows when no search query or category', () => {
      render(<ExploreClient />);
      expect(screen.getByTestId('collection-rows')).toBeTruthy();
    });

    it('should render all collections from useExploreCollections', () => {
      render(<ExploreClient />);
      expect(screen.getByTestId('collection-row-trending')).toBeTruthy();
      expect(screen.getByTestId('collection-row-staff-picks')).toBeTruthy();
    });

    it('should render collection titles', () => {
      render(<ExploreClient />);
      const titles = screen.getAllByTestId('collection-title');
      expect(titles.some((t) => t.textContent === 'Trending')).toBe(true);
      expect(titles.some((t) => t.textContent === 'Staff Picks')).toBe(true);
    });

    it('should render See All links for collections', () => {
      render(<ExploreClient />);
      const links = screen.getAllByText('See All');
      expect(links.length).toBe(2);
      const hrefs = links.map((l) => l.getAttribute('href'));
      expect(hrefs).toContain('/explore/collection/trending');
      expect(hrefs).toContain('/explore/collection/staff-picks');
    });

    it('should not render search results grid in browse mode', () => {
      render(<ExploreClient />);
      expect(screen.queryByTestId('search-results-grid')).toBeNull();
    });

    it('should render icons for known collection slugs', () => {
      render(<ExploreClient />);
      const icons = screen.getAllByTestId('collection-icon');
      expect(icons.length).toBeGreaterThanOrEqual(1);
    });

    it('should render books within collection rows', () => {
      render(<ExploreClient />);
      // Each collection row has mockCollectionBooks (1 book: col-book-1)
      const collectionBooks = screen.getAllByTestId('collection-book-col-book-1');
      expect(collectionBooks.length).toBe(2); // One per collection
    });
  });

  describe('Browse Mode - Loading State', () => {
    it('should render skeleton collection rows when loading', () => {
      mockCollectionsReturn = {
        collections: [],
        isLoading: true,
        error: null,
        refresh: vi.fn(),
      };
      render(<ExploreClient />);
      // Should render 3 skeleton rows (Trending, Staff Picks, Recently Added)
      expect(screen.getByText('Trending')).toBeTruthy();
      expect(screen.getByText('Staff Picks')).toBeTruthy();
      expect(screen.getByText('Recently Added')).toBeTruthy();
    });
  });

  describe('Browse Mode - Error State', () => {
    it('should display error message when collections fetch fails', () => {
      mockCollectionsReturn = {
        collections: [],
        isLoading: false,
        error: 'Failed to load collections',
        refresh: vi.fn(),
      };
      render(<ExploreClient />);
      expect(screen.getByText('Failed to load collections')).toBeTruthy();
    });
  });

  describe('Browse Mode - Empty State', () => {
    it('should show empty state when no collections and not loading', () => {
      mockCollectionsReturn = {
        collections: [],
        isLoading: false,
        error: null,
        refresh: vi.fn(),
      };
      render(<ExploreClient />);
      expect(screen.getByText('Loading catalog...')).toBeTruthy();
    });
  });

  describe('Search Mode', () => {
    it('should show search results grid when search query is present', () => {
      mockSearchQuery = 'python';
      mockExploreBooksReturn = {
        ...mockExploreBooksReturn,
        books: mockBooks,
        total: 2,
      };
      render(<ExploreClient />);
      expect(screen.getByTestId('search-results-grid')).toBeTruthy();
      expect(screen.queryByTestId('collection-rows')).toBeNull();
    });

    it('should render ExploreBookCard for each search result', () => {
      mockSearchQuery = 'python';
      mockExploreBooksReturn = {
        ...mockExploreBooksReturn,
        books: mockBooks,
        total: 2,
      };
      render(<ExploreClient />);
      expect(screen.getByTestId('book-card-search-1')).toBeTruthy();
      expect(screen.getByTestId('book-card-search-2')).toBeTruthy();
    });

    it('should show empty state with search query message when no results', () => {
      mockSearchQuery = 'nonexistent';
      mockExploreBooksReturn = {
        ...mockExploreBooksReturn,
        books: [],
        total: 0,
        isLoading: false,
      };
      render(<ExploreClient />);
      expect(screen.getByText('No books found for')).toBeTruthy();
    });

    it('should show Browse All Books button on empty search results', () => {
      mockSearchQuery = 'nonexistent';
      mockExploreBooksReturn = {
        ...mockExploreBooksReturn,
        books: [],
        total: 0,
        isLoading: false,
      };
      render(<ExploreClient />);
      expect(screen.getByText('Browse All Books')).toBeTruthy();
    });

    it('should show Load more button when hasMore is true', () => {
      mockSearchQuery = 'python';
      mockExploreBooksReturn = {
        ...mockExploreBooksReturn,
        books: mockBooks,
        total: 50,
        hasMore: true,
      };
      const { container } = render(<ExploreClient />);
      // Now uses an IntersectionObserver sentinel div instead of a button
      const sentinel = container.querySelector('.flex.justify-center.py-8');
      expect(sentinel).toBeTruthy();
    });

    it('should show Loading... text when loading more', () => {
      mockSearchQuery = 'python';
      mockExploreBooksReturn = {
        ...mockExploreBooksReturn,
        books: mockBooks,
        total: 50,
        hasMore: true,
        isLoading: true,
      };
      const { container } = render(<ExploreClient />);
      // Now uses a Loader2 spinner in the sentinel div instead of "Loading..." text
      const sentinel = container.querySelector('.flex.justify-center.py-8');
      expect(sentinel).toBeTruthy();
      const spinner = sentinel?.querySelector('.animate-spin');
      expect(spinner).toBeTruthy();
    });

    it('should show skeleton cards on initial load', () => {
      mockSearchQuery = 'python';
      mockExploreBooksReturn = {
        ...mockExploreBooksReturn,
        books: [],
        total: 0,
        isLoading: true,
        isStale: false,
      };
      const { container } = render(<ExploreClient />);
      const skeletons = container.querySelectorAll('.animate-pulse');
      expect(skeletons.length).toBe(8);
    });

    it('should display error message in search mode', () => {
      mockSearchQuery = 'python';
      mockExploreBooksReturn = {
        ...mockExploreBooksReturn,
        error: 'API error: 500',
      };
      render(<ExploreClient />);
      expect(screen.getByText('API error: 500')).toBeTruthy();
    });
  });

  describe('Category Filter Mode', () => {
    it('should show search results grid when category is selected', () => {
      mockSelectedCategory = 'Science,Physics,Chemistry';
      mockExploreBooksReturn = {
        ...mockExploreBooksReturn,
        books: mockBooks,
        total: 2,
      };
      render(<ExploreClient />);
      expect(screen.getByTestId('search-results-grid')).toBeTruthy();
      expect(screen.queryByTestId('collection-rows')).toBeNull();
    });

    it('should show empty category message when no books in category', () => {
      mockSelectedCategory = 'Religion';
      mockExploreBooksReturn = {
        ...mockExploreBooksReturn,
        books: [],
        total: 0,
        isLoading: false,
      };
      render(<ExploreClient />);
      expect(screen.getByText('No books in this category')).toBeTruthy();
    });
  });

  describe('Components Integration', () => {
    it('should render ExploreSearchBar', () => {
      render(<ExploreClient />);
      expect(screen.getByTestId('search-bar')).toBeTruthy();
    });

    it('should render CategoryPills', () => {
      render(<ExploreClient />);
      expect(screen.getByTestId('category-pills')).toBeTruthy();
    });

    it('should render mobile header', () => {
      render(<ExploreClient />);
      expect(screen.getByText('Explore')).toBeTruthy();
    });
  });

  describe('Mode Transitions', () => {
    it('should switch from browse to search when category is selected via pills', () => {
      // Start in browse mode
      render(<ExploreClient />);
      expect(screen.getByTestId('collection-rows')).toBeTruthy();

      // Simulate selecting a category
      fireEvent.click(screen.getByTestId('select-science-category'));

      // The mock sets selectedCategory via the callback
      expect(mockSetSelectedCategory).toHaveBeenCalledWith('Science,Physics,Chemistry');
    });

    it('should switch back to browse when category is cleared', () => {
      // Start in browse mode
      render(<ExploreClient />);

      // Click science then all
      fireEvent.click(screen.getByTestId('select-science-category'));
      fireEvent.click(screen.getByTestId('select-all-category'));

      expect(mockSetSelectedCategory).toHaveBeenLastCalledWith('');
    });
  });

  describe('Grid Responsiveness', () => {
    it('should render grid with responsive column classes', () => {
      mockSearchQuery = 'python';
      mockExploreBooksReturn = {
        ...mockExploreBooksReturn,
        books: mockBooks,
        total: 2,
      };
      const { container } = render(<ExploreClient />);
      const grid = container.querySelector('.grid');
      expect(grid?.className).toContain('grid-cols-2');
      expect(grid?.className).toContain('sm:grid-cols-3');
      expect(grid?.className).toContain('lg:grid-cols-4');
      expect(grid?.className).toContain('xl:grid-cols-5');
    });

    it('should apply stale opacity when isStale', () => {
      mockSearchQuery = 'python';
      mockExploreBooksReturn = {
        ...mockExploreBooksReturn,
        books: mockBooks,
        total: 2,
        isStale: true,
      };
      const { container } = render(<ExploreClient />);
      const grid = container.querySelector('.grid');
      expect(grid?.className).toContain('opacity-50');
    });
  });

  describe('IA Blended Search', () => {
    const mockIaBooks: CatalogBook[] = [
      {
        id: '',
        title: 'IA Book 1',
        author_name: 'IA Author',
        language: 'en',
        format_type: 'epub',
        cover_image_key: null,
        cover_is_generated: false,
        is_cached: false,
        import_count: 100,
        page_count: null,
        file_size_bytes: null,
        source: 'internet-archive',
        source_id: 'ia-book-1',
        ia_identifier: 'ia-book-1',
        cover_url: 'https://archive.org/services/img/ia-book-1',
      },
      {
        id: '',
        title: 'IA Book 2',
        author_name: 'IA Author 2',
        language: 'en',
        format_type: 'epub',
        cover_image_key: null,
        cover_is_generated: false,
        is_cached: false,
        import_count: 50,
        page_count: null,
        file_size_bytes: null,
        source: 'internet-archive',
        source_id: 'ia-book-2',
        ia_identifier: 'ia-book-2',
        cover_url: 'https://archive.org/services/img/ia-book-2',
      },
    ];

    it('should show IA section when searching and IA results exist', () => {
      mockSearchQuery = 'python';
      mockExploreBooksReturn = {
        ...mockExploreBooksReturn,
        books: mockBooks,
        total: 2,
        iaBooks: mockIaBooks,
        iaTotal: 500,
        iaLoading: false,
      };
      render(<ExploreClient />);
      expect(screen.getByTestId('ia-results-section')).toBeTruthy();
      expect(screen.getByText('500+ more from Internet Archive')).toBeTruthy();
    });

    it('should show IA loading state with spinner text', () => {
      mockSearchQuery = 'python';
      mockExploreBooksReturn = {
        ...mockExploreBooksReturn,
        books: mockBooks,
        total: 2,
        iaBooks: [],
        iaTotal: 0,
        iaLoading: true,
      };
      render(<ExploreClient />);
      expect(screen.getByTestId('ia-results-section')).toBeTruthy();
      expect(screen.getByText('Searching Internet Archive...')).toBeTruthy();
    });

    it('should show IA skeleton cards while loading with no IA books yet', () => {
      mockSearchQuery = 'python';
      mockExploreBooksReturn = {
        ...mockExploreBooksReturn,
        books: mockBooks,
        total: 2,
        iaBooks: [],
        iaTotal: 0,
        iaLoading: true,
      };
      render(<ExploreClient />);
      const iaSection = screen.getByTestId('ia-results-section');
      const skeletons = iaSection.querySelectorAll('.animate-pulse');
      expect(skeletons.length).toBe(4);
    });

    it('should render IA book cards with isIA prop', () => {
      mockSearchQuery = 'python';
      mockExploreBooksReturn = {
        ...mockExploreBooksReturn,
        books: mockBooks,
        total: 2,
        iaBooks: mockIaBooks,
        iaTotal: 500,
        iaLoading: false,
      };
      render(<ExploreClient />);
      expect(screen.getByTestId('book-card-ia-book-1')).toBeTruthy();
      expect(screen.getByTestId('book-card-ia-book-2')).toBeTruthy();
      expect(screen.getByTestId('book-ia-badge-ia-book-1')).toBeTruthy();
    });

    it('should show Load More from IA button when iaHasMore is true', () => {
      mockSearchQuery = 'python';
      mockExploreBooksReturn = {
        ...mockExploreBooksReturn,
        books: mockBooks,
        total: 2,
        iaBooks: mockIaBooks,
        iaTotal: 500,
        iaLoading: false,
        iaHasMore: true,
      };
      render(<ExploreClient />);
      // Now uses an IntersectionObserver sentinel div instead of a button
      const iaSection = screen.getByTestId('ia-results-section');
      const sentinel = iaSection.querySelector('.flex.justify-center.py-8');
      expect(sentinel).toBeTruthy();
    });

    it('should show IA loading spinner when iaLoading and iaHasMore', () => {
      mockSearchQuery = 'python';
      mockExploreBooksReturn = {
        ...mockExploreBooksReturn,
        books: mockBooks,
        total: 2,
        iaBooks: mockIaBooks,
        iaTotal: 500,
        iaLoading: true,
        iaHasMore: true,
      };
      render(<ExploreClient />);
      // The IA sentinel div shows a Loader2 spinner when loading
      const iaSection = screen.getByTestId('ia-results-section');
      const sentinel = iaSection.querySelector('.flex.justify-center.py-8');
      expect(sentinel).toBeTruthy();
      const spinner = sentinel?.querySelector('.animate-spin');
      expect(spinner).toBeTruthy();
    });

    it('should not show IA section in browse mode', () => {
      mockExploreBooksReturn = {
        ...mockExploreBooksReturn,
        iaBooks: mockIaBooks,
        iaTotal: 500,
      };
      render(<ExploreClient />);
      expect(screen.queryByTestId('ia-results-section')).toBeNull();
    });

    it('should not show IA section in category filter mode', () => {
      mockSelectedCategory = 'Science';
      mockExploreBooksReturn = {
        ...mockExploreBooksReturn,
        books: mockBooks,
        total: 2,
        iaBooks: mockIaBooks,
        iaTotal: 500,
      };
      render(<ExploreClient />);
      // Category mode is not "searching" so IA section should not appear
      expect(screen.queryByTestId('ia-results-section')).toBeNull();
    });

    it('should show "No results in OpenRead library" when local is empty but IA has results', () => {
      mockSearchQuery = 'obscure-topic';
      mockExploreBooksReturn = {
        ...mockExploreBooksReturn,
        books: [],
        total: 0,
        isLoading: false,
        iaBooks: mockIaBooks,
        iaTotal: 500,
        iaLoading: false,
      };
      render(<ExploreClient />);
      expect(screen.getByText('No results in OpenRead library')).toBeTruthy();
      // Should NOT show the full empty state
      expect(screen.queryByText('No books found for')).toBeNull();
      // Should still show IA section
      expect(screen.getByTestId('ia-results-section')).toBeTruthy();
    });

    it('should show "No results in OpenRead library" when local is empty and IA is still loading', () => {
      mockSearchQuery = 'obscure-topic';
      mockExploreBooksReturn = {
        ...mockExploreBooksReturn,
        books: [],
        total: 0,
        isLoading: false,
        iaBooks: [],
        iaTotal: 0,
        iaLoading: true,
      };
      render(<ExploreClient />);
      expect(screen.getByText('No results in OpenRead library')).toBeTruthy();
      expect(screen.getByText('Searching Internet Archive...')).toBeTruthy();
    });

    it('should show full empty state when both local and IA return nothing', () => {
      mockSearchQuery = 'totally-nonexistent';
      mockExploreBooksReturn = {
        ...mockExploreBooksReturn,
        books: [],
        total: 0,
        isLoading: false,
        iaBooks: [],
        iaTotal: 0,
        iaLoading: false,
      };
      render(<ExploreClient />);
      expect(screen.getByText('No books found for')).toBeTruthy();
      expect(screen.queryByTestId('ia-results-section')).toBeNull();
    });

    it('should not show Load More from IA button when not loading and iaHasMore is false', () => {
      mockSearchQuery = 'python';
      mockExploreBooksReturn = {
        ...mockExploreBooksReturn,
        books: mockBooks,
        total: 2,
        iaBooks: mockIaBooks,
        iaTotal: 2,
        iaLoading: false,
        iaHasMore: false,
      };
      render(<ExploreClient />);
      // No sentinel div when iaHasMore is false
      const iaSection = screen.getByTestId('ia-results-section');
      const sentinel = iaSection.querySelector('.flex.justify-center.py-8');
      expect(sentinel).toBeNull();
    });
  });

  describe('Wishlist Wiring', () => {
    it('should pass isWishlisted=false to search result cards when not wishlisted', () => {
      mockSearchQuery = 'python';
      mockExploreBooksReturn = {
        ...mockExploreBooksReturn,
        books: mockBooks,
        total: 2,
      };
      render(<ExploreClient />);
      expect(screen.getByTestId('book-wishlisted-search-1').textContent).toBe('false');
      expect(screen.getByTestId('book-wishlisted-search-2').textContent).toBe('false');
    });

    it('should pass isWishlisted=true to search result cards when wishlisted', () => {
      mockSearchQuery = 'python';
      mockWishlistedIds.add('search-1');
      mockIsWishlisted.mockImplementation((id: string) => mockWishlistedIds.has(id));
      mockExploreBooksReturn = {
        ...mockExploreBooksReturn,
        books: mockBooks,
        total: 2,
      };
      render(<ExploreClient />);
      expect(screen.getByTestId('book-wishlisted-search-1').textContent).toBe('true');
      expect(screen.getByTestId('book-wishlisted-search-2').textContent).toBe('false');
    });

    it('should pass onWishlistToggle to search result cards', () => {
      mockSearchQuery = 'python';
      mockExploreBooksReturn = {
        ...mockExploreBooksReturn,
        books: mockBooks,
        total: 2,
      };
      render(<ExploreClient />);
      const btn = screen.getByTestId('book-wishlist-btn-search-1');
      expect(btn).toBeTruthy();
    });

    it('should call toggleWishlist when card wishlist button is clicked', () => {
      mockSearchQuery = 'python';
      mockExploreBooksReturn = {
        ...mockExploreBooksReturn,
        books: mockBooks,
        total: 2,
      };
      render(<ExploreClient />);
      fireEvent.click(screen.getByTestId('book-wishlist-btn-search-1'));
      expect(mockToggleWishlist).toHaveBeenCalledWith('search-1');
    });

    it('should pass wishlistedIds to CollectionRow in browse mode', () => {
      render(<ExploreClient />);
      const markers = screen.getAllByTestId('collection-has-wishlist-ids');
      expect(markers.length).toBe(2); // One per collection row
    });

    it('should pass onWishlistToggle to CollectionRow in browse mode', () => {
      render(<ExploreClient />);
      const btn = screen.getByTestId('collection-wishlist-toggle-trending');
      expect(btn).toBeTruthy();
    });

    it('should call toggleWishlist when CollectionRow wishlist toggle is clicked', () => {
      render(<ExploreClient />);
      fireEvent.click(screen.getByTestId('collection-wishlist-toggle-trending'));
      expect(mockToggleWishlist).toHaveBeenCalledWith('col-book-1');
    });

    it('should redirect to /auth when not authenticated and wishlist toggled', () => {
      mockToken = null;
      mockSearchQuery = 'python';
      mockExploreBooksReturn = {
        ...mockExploreBooksReturn,
        books: mockBooks,
        total: 2,
      };

      // Mock window.location
      const originalLocation = window.location;
      Object.defineProperty(window, 'location', {
        writable: true,
        value: { ...originalLocation, href: '' },
      });

      render(<ExploreClient />);
      fireEvent.click(screen.getByTestId('book-wishlist-btn-search-1'));

      expect(window.location.href).toBe('/auth');
      expect(mockToggleWishlist).not.toHaveBeenCalled();

      // Restore
      Object.defineProperty(window, 'location', {
        writable: true,
        value: originalLocation,
      });
    });
  });

  describe('Reader Handoff (S3.3)', () => {
    it('should navigate to reader with bookHash when Open is clicked on an imported book', () => {
      // Set up: book is imported and in-library state
      mockGetImportState = vi.fn((bookId: string) => {
        if (bookId === 'search-1') {
          return {
            status: 'ready',
            progress: 100,
            bookHash: 'catalog:search-1',
            bookId: 'db-uuid-1',
          };
        }
        return { status: 'idle', progress: 0 };
      });

      mockSearchQuery = 'python';
      mockExploreBooksReturn = {
        ...mockExploreBooksReturn,
        books: mockBooks,
        total: 2,
      };
      render(<ExploreClient />);

      // Click the Open button on the imported book
      fireEvent.click(screen.getByTestId('book-open-btn-search-1'));

      // Verify navigateToReader was called with the book hash (not the DB UUID)
      expect(mockNavigateToReader).toHaveBeenCalledTimes(1);
      expect(mockNavigateToReader).toHaveBeenCalledWith(
        expect.anything(), // router
        ['catalog:search-1'],
      );
    });

    it('should not navigate when bookHash is not available', () => {
      // Set up: book is imported but no hash (edge case)
      mockGetImportState = vi.fn(() => ({
        status: 'ready',
        progress: 100,
        bookId: 'db-uuid-1',
        // no bookHash
      }));

      mockSearchQuery = 'python';
      mockExploreBooksReturn = {
        ...mockExploreBooksReturn,
        books: mockBooks,
        total: 2,
      };
      render(<ExploreClient />);

      // The Open button should still render since state is 'in-library'
      fireEvent.click(screen.getByTestId('book-open-btn-search-1'));

      // navigateToReader should NOT have been called since there's no bookHash
      expect(mockNavigateToReader).not.toHaveBeenCalled();
    });
  });

  describe('Book Detail Sheet (S3.2)', () => {
    it('should not render BookDetailSheet when no book is selected', () => {
      render(<ExploreClient />);
      expect(screen.queryByTestId('book-detail-sheet')).toBeNull();
    });

    it('should render BookDetailSheet when URL has ?book= param matching a search result', () => {
      mockSearchQuery = 'python';
      mockSearchParams = new URLSearchParams('book=search-1');
      mockExploreBooksReturn = {
        ...mockExploreBooksReturn,
        books: mockBooks,
        total: 2,
      };
      render(<ExploreClient />);
      expect(screen.getByTestId('book-detail-sheet')).toBeTruthy();
      expect(screen.getByTestId('sheet-book-title').textContent).toBe('Search Result 1');
      expect(screen.getByTestId('sheet-book-id').textContent).toBe('search-1');
    });

    it('should render BookDetailSheet when URL has ?book= param matching a collection book', () => {
      mockSearchParams = new URLSearchParams('book=col-book-1');
      render(<ExploreClient />);
      expect(screen.getByTestId('book-detail-sheet')).toBeTruthy();
      expect(screen.getByTestId('sheet-book-title').textContent).toBe('Collection Book 1');
    });

    it('should not render BookDetailSheet when ?book= param does not match any book', () => {
      mockSearchParams = new URLSearchParams('book=nonexistent-id');
      render(<ExploreClient />);
      expect(screen.queryByTestId('book-detail-sheet')).toBeNull();
    });

    it('should call router.push with ?book= param when card is tapped in search mode', () => {
      mockSearchQuery = 'python';
      mockExploreBooksReturn = {
        ...mockExploreBooksReturn,
        books: mockBooks,
        total: 2,
      };
      render(<ExploreClient />);
      fireEvent.click(screen.getByTestId('card-tap-search-1'));
      expect(mockRouterPush).toHaveBeenCalledWith(expect.stringContaining('book=search-1'), {
        scroll: false,
      });
    });

    it('should call router.push with ?book= param when card is tapped in collection row', () => {
      render(<ExploreClient />);
      fireEvent.click(screen.getByTestId('collection-card-tap-trending'));
      expect(mockRouterPush).toHaveBeenCalledWith(expect.stringContaining('book=col-book-1'), {
        scroll: false,
      });
    });

    it('should remove ?book= param from URL when sheet close is clicked', () => {
      mockSearchQuery = 'python';
      mockSearchParams = new URLSearchParams('book=search-1');
      mockExploreBooksReturn = {
        ...mockExploreBooksReturn,
        books: mockBooks,
        total: 2,
      };
      render(<ExploreClient />);
      expect(screen.getByTestId('book-detail-sheet')).toBeTruthy();

      fireEvent.click(screen.getByTestId('sheet-close-btn'));
      expect(mockRouterPush).toHaveBeenCalledWith('/explore', { scroll: false });
    });

    it('should pass isWishlisted to BookDetailSheet based on wishlist state', () => {
      mockSearchQuery = 'python';
      mockSearchParams = new URLSearchParams('book=search-1');
      mockWishlistedIds.add('search-1');
      mockIsWishlisted.mockImplementation((id: string) => mockWishlistedIds.has(id));
      mockExploreBooksReturn = {
        ...mockExploreBooksReturn,
        books: mockBooks,
        total: 2,
      };
      render(<ExploreClient />);
      expect(screen.getByTestId('sheet-wishlisted').textContent).toBe('true');
    });

    it('should pass importState to BookDetailSheet', () => {
      mockSearchQuery = 'python';
      mockSearchParams = new URLSearchParams('book=search-1');
      mockGetImportState = vi.fn((bookId: string) => {
        if (bookId === 'search-1') {
          return { status: 'importing', progress: 50 };
        }
        return { status: 'idle', progress: 0 };
      });
      mockExploreBooksReturn = {
        ...mockExploreBooksReturn,
        books: mockBooks,
        total: 2,
      };
      render(<ExploreClient />);
      expect(screen.getByTestId('sheet-import-state').textContent).toBe('importing');
    });

    it('should call handleWishlistToggle when sheet wishlist button is clicked', () => {
      mockSearchQuery = 'python';
      mockSearchParams = new URLSearchParams('book=search-1');
      mockExploreBooksReturn = {
        ...mockExploreBooksReturn,
        books: mockBooks,
        total: 2,
      };
      render(<ExploreClient />);
      fireEvent.click(screen.getByTestId('sheet-wishlist-btn'));
      expect(mockToggleWishlist).toHaveBeenCalledWith('search-1');
    });

    it('should call importBook when sheet import button is clicked', () => {
      mockSearchQuery = 'python';
      mockSearchParams = new URLSearchParams('book=search-1');
      mockExploreBooksReturn = {
        ...mockExploreBooksReturn,
        books: mockBooks,
        total: 2,
      };
      render(<ExploreClient />);
      fireEvent.click(screen.getByTestId('sheet-import-btn'));
      expect(mockImportBook).toHaveBeenCalledWith('search-1', undefined);
    });

    it('should call navigateToReader when sheet read button is clicked', () => {
      mockSearchQuery = 'python';
      mockSearchParams = new URLSearchParams('book=search-1');
      mockGetImportState = vi.fn((bookId: string) => {
        if (bookId === 'search-1') {
          return { status: 'ready', progress: 100, bookHash: 'catalog:search-1' };
        }
        return { status: 'idle', progress: 0 };
      });
      mockExploreBooksReturn = {
        ...mockExploreBooksReturn,
        books: mockBooks,
        total: 2,
      };
      render(<ExploreClient />);
      fireEvent.click(screen.getByTestId('sheet-read-btn'));
      expect(mockNavigateToReader).toHaveBeenCalledWith(expect.anything(), ['catalog:search-1']);
    });

    it('should preserve other query params when opening/closing sheet', () => {
      // Simulate ?book= param being added while other params exist
      mockSearchParams = new URLSearchParams('someParam=value');
      mockSearchQuery = 'python';
      mockExploreBooksReturn = {
        ...mockExploreBooksReturn,
        books: mockBooks,
        total: 2,
      };
      render(<ExploreClient />);

      // Tap a card - should preserve existing params
      fireEvent.click(screen.getByTestId('card-tap-search-1'));
      const pushCall = mockRouterPush.mock.calls[0]?.[0] as string;
      expect(pushCall).toContain('someParam=value');
      expect(pushCall).toContain('book=search-1');
    });
  });
});
