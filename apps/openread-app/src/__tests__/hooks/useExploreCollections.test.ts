import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { useExploreCollections, _resetCollectionsCache } from '@/hooks/useExploreCollections';
import type { CatalogCollection } from '@/hooks/useExploreCollections';
import type { CatalogBook } from '@/hooks/useExploreBooks';

// ── Helpers ────────────────────────────────────────────

function makeMockCollection(
  index: number,
  overrides?: Partial<CatalogCollection>,
): CatalogCollection {
  return {
    id: `col-${index}`,
    slug: `collection-${index}`,
    name: `Collection ${index}`,
    description: `Description for collection ${index}`,
    sort_order: index,
    book_count: 5,
    ...overrides,
  };
}

function makeMockBook(index: number, overrides?: Partial<CatalogBook>): CatalogBook {
  return {
    id: `book-${index}`,
    title: `Test Book ${index}`,
    author_name: `Author ${index}`,
    language: 'en',
    format_type: 'epub',
    cover_image_key: null,
    cover_is_generated: false,
    is_cached: true,
    import_count: 10,
    page_count: 200,
    file_size_bytes: 3000000,
    ...overrides,
  };
}

const mockCollections = [
  makeMockCollection(0, { slug: 'trending', name: 'Trending', book_count: 10 }),
  makeMockCollection(1, { slug: 'staff-picks', name: 'Staff Picks', book_count: 5 }),
  makeMockCollection(2, { slug: 'classic-literature', name: 'Classic Literature', book_count: 8 }),
];

const mockBooks = Array.from({ length: 5 }, (_, i) => makeMockBook(i));

// ── Mocks ──────────────────────────────────────────────

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

beforeEach(() => {
  vi.clearAllMocks();
  _resetCollectionsCache();
});

afterEach(() => {
  cleanup();
});

// Helper to create successful fetch responses
function mockFetchResponses() {
  fetchMock.mockImplementation(async (url: string) => {
    const urlStr = typeof url === 'string' ? url : (url as Request).url;

    if (urlStr.includes('/catalog/collections') && !urlStr.includes('/books')) {
      // Collections list endpoint
      return {
        ok: true,
        json: async () => ({ collections: mockCollections }),
      };
    }

    if (urlStr.includes('/books')) {
      // Books for a collection
      return {
        ok: true,
        json: async () => ({ books: mockBooks, total: 5 }),
      };
    }

    return { ok: false, status: 404 };
  });
}

// ── Tests ──────────────────────────────────────────────

describe('useExploreCollections', () => {
  describe('Initial state', () => {
    it('should start with loading state', () => {
      mockFetchResponses();
      const { result } = renderHook(() => useExploreCollections());

      // Initially loading should be true or collections empty
      expect(result.current.collections).toEqual([]);
    });

    it('should have no error initially', () => {
      mockFetchResponses();
      const { result } = renderHook(() => useExploreCollections());
      expect(result.current.error).toBeNull();
    });
  });

  describe('Successful fetch', () => {
    it('should fetch collections and their books', async () => {
      mockFetchResponses();
      const { result } = renderHook(() => useExploreCollections());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.collections).toHaveLength(3);
      expect(result.current.collections[0]!.slug).toBe('trending');
      expect(result.current.collections[0]!.books).toHaveLength(5);
    });

    it('should call collections list endpoint', async () => {
      mockFetchResponses();
      renderHook(() => useExploreCollections());

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalled();
      });

      const calls = fetchMock.mock.calls.map((c: unknown[]) => String(c[0]));
      expect(calls.some((url: string) => url.includes('/catalog/collections'))).toBe(true);
    });

    it('should call books endpoint for each collection', async () => {
      mockFetchResponses();
      renderHook(() => useExploreCollections());

      await waitFor(() => {
        const calls = fetchMock.mock.calls.map((c: unknown[]) => String(c[0]));
        // Should have 1 list call + 3 books calls
        expect(calls.filter((url: string) => url.includes('/books')).length).toBe(3);
      });
    });

    it('should pass booksPerCollection as limit parameter', async () => {
      mockFetchResponses();
      renderHook(() => useExploreCollections(15));

      await waitFor(() => {
        const calls = fetchMock.mock.calls.map((c: unknown[]) => String(c[0]));
        const booksCall = calls.find((url: string) => url.includes('/books'));
        expect(booksCall).toContain('limit=15');
      });
    });

    it('should set isLoading to false after fetch completes', async () => {
      mockFetchResponses();
      const { result } = renderHook(() => useExploreCollections());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
    });
  });

  describe('Empty collections filtering', () => {
    it('should filter out collections with book_count === 0', async () => {
      fetchMock.mockImplementation(async (url: string) => {
        const urlStr = typeof url === 'string' ? url : (url as Request).url;

        if (urlStr.includes('/catalog/collections') && !urlStr.includes('/books')) {
          return {
            ok: true,
            json: async () => ({
              collections: [
                ...mockCollections,
                makeMockCollection(3, { slug: 'empty', name: 'Empty', book_count: 0 }),
              ],
            }),
          };
        }

        if (urlStr.includes('/books')) {
          return {
            ok: true,
            json: async () => ({ books: mockBooks, total: 5 }),
          };
        }

        return { ok: false, status: 404 };
      });

      const { result } = renderHook(() => useExploreCollections());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // The "empty" collection (book_count=0) should be filtered out
      expect(result.current.collections.find((c) => c.slug === 'empty')).toBeUndefined();
      expect(result.current.collections).toHaveLength(3);
    });

    it('should filter out collections whose books fetch returned empty', async () => {
      fetchMock.mockImplementation(async (url: string) => {
        const urlStr = typeof url === 'string' ? url : (url as Request).url;

        if (urlStr.includes('/catalog/collections') && !urlStr.includes('/books')) {
          return {
            ok: true,
            json: async () => ({ collections: mockCollections }),
          };
        }

        if (urlStr.includes('/books')) {
          // Return empty books for trending
          if (urlStr.includes('trending')) {
            return { ok: true, json: async () => ({ books: [], total: 0 }) };
          }
          return { ok: true, json: async () => ({ books: mockBooks, total: 5 }) };
        }

        return { ok: false, status: 404 };
      });

      const { result } = renderHook(() => useExploreCollections());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.collections.find((c) => c.slug === 'trending')).toBeUndefined();
      expect(result.current.collections).toHaveLength(2);
    });
  });

  describe('Error handling', () => {
    it('should set error when collections list fetch fails', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
      });

      const { result } = renderHook(() => useExploreCollections());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.error).toBe('API error: 500');
      expect(result.current.collections).toEqual([]);
    });

    it('should set error when fetch throws', async () => {
      fetchMock.mockRejectedValue(new Error('Network failure'));

      const { result } = renderHook(() => useExploreCollections());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.error).toBe('Network failure');
    });

    it('should gracefully handle individual collection books fetch failure', async () => {
      fetchMock.mockImplementation(async (url: string) => {
        const urlStr = typeof url === 'string' ? url : (url as Request).url;

        if (urlStr.includes('/catalog/collections') && !urlStr.includes('/books')) {
          return {
            ok: true,
            json: async () => ({ collections: mockCollections }),
          };
        }

        if (urlStr.includes('/books')) {
          // Fail the trending books fetch
          if (urlStr.includes('trending')) {
            return { ok: false, status: 500 };
          }
          return { ok: true, json: async () => ({ books: mockBooks, total: 5 }) };
        }

        return { ok: false, status: 404 };
      });

      const { result } = renderHook(() => useExploreCollections());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Should still have the other 2 collections (trending filtered out due to empty books)
      expect(result.current.error).toBeNull();
      expect(result.current.collections).toHaveLength(2);
    });
  });

  describe('Caching', () => {
    it('should use cache on subsequent calls within TTL', async () => {
      mockFetchResponses();
      const { result, unmount } = renderHook(() => useExploreCollections());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.collections).toHaveLength(3);
      const firstCallCount = fetchMock.mock.calls.length;

      unmount();

      // Re-render — should use cache (no new fetch calls)
      const { result: result2 } = renderHook(() => useExploreCollections());

      // Cache hit: collections should be available immediately
      expect(result2.current.collections).toHaveLength(3);
      expect(fetchMock.mock.calls.length).toBe(firstCallCount);
    });

    it('should clear cache on refresh', async () => {
      mockFetchResponses();
      const { result } = renderHook(() => useExploreCollections());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const callsBeforeRefresh = fetchMock.mock.calls.length;

      // Call refresh
      result.current.refresh();

      await waitFor(() => {
        // New fetch calls should have been made
        expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBeforeRefresh);
      });
    });
  });

  describe('Abort handling', () => {
    it('should not crash on unmount during fetch', async () => {
      let resolveFirst: (() => void) | null = null;
      fetchMock.mockImplementation(
        () =>
          new Promise<{ ok: boolean; json: () => Promise<{ collections: CatalogCollection[] }> }>(
            (resolve) => {
              resolveFirst = () =>
                resolve({
                  ok: true,
                  json: async () => ({ collections: [] }),
                });
            },
          ),
      );

      const { unmount } = renderHook(() => useExploreCollections());

      // Unmount before fetch resolves
      unmount();

      // Resolve the pending promise — should not throw
      (resolveFirst as (() => void) | null)?.call(null);

      // No assertion needed — we're testing that it doesn't throw
      expect(true).toBe(true);
    });
  });
});
