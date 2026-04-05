import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { deduplicateIA, _clearQueryCache } from '@/hooks/useExploreBooks';
import type { CatalogBook } from '@/hooks/useExploreBooks';

// ── Mock fetch globally ───────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Must re-import useExploreBooks after stubbing fetch
const { useExploreBooks } = await import('@/hooks/useExploreBooks');

// ── Helpers ───────────────────────────────────────────

function makeLocalBook(overrides: Partial<CatalogBook> = {}): CatalogBook {
  return {
    id: 'local-1',
    title: 'Local Book',
    author_name: 'Local Author',
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

function makeIABook(overrides: Partial<CatalogBook> = {}): CatalogBook {
  return {
    id: '',
    title: 'IA Book',
    author_name: 'IA Author',
    language: 'en',
    format_type: 'epub',
    cover_image_key: null,
    cover_is_generated: false,
    is_cached: false,
    import_count: 50,
    page_count: null,
    file_size_bytes: null,
    source: 'internet-archive',
    source_id: 'ia-id-1',
    ia_identifier: 'ia-id-1',
    cover_url: 'https://archive.org/services/img/ia-id-1',
    ...overrides,
  };
}

/** Route fetch calls to different mocks based on URL pattern */
function setupFetchRouter(opts: {
  local: { books: CatalogBook[]; total: number };
  ia?: { books: CatalogBook[]; total: number; error?: string } | 'fail';
}) {
  mockFetch.mockImplementation((url: string) => {
    if (url.includes('/catalog/ia/search')) {
      if (opts.ia === 'fail') {
        return Promise.resolve({ ok: false, status: 500 });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(opts.ia ?? { books: [], total: 0 }),
      });
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(opts.local),
    });
  });
}

// ── Setup ─────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockReset();
  _clearQueryCache();
});

// ── Pure unit tests for deduplicateIA ─────────────────

describe('deduplicateIA', () => {
  it('should remove IA books that match local books by title+author', () => {
    const local = [makeLocalBook({ title: 'Python Handbook', author_name: 'Guido' })];
    const ia = [
      makeIABook({ title: 'Python Handbook', author_name: 'Guido', ia_identifier: 'dup' }),
      makeIABook({ title: 'Different Book', author_name: 'Other', ia_identifier: 'unique' }),
    ];
    const result = deduplicateIA(local, ia);
    expect(result).toHaveLength(1);
    expect(result[0]!.ia_identifier).toBe('unique');
  });

  it('should handle case-insensitive matching', () => {
    const local = [makeLocalBook({ title: 'PYTHON handbook', author_name: 'GUIDO' })];
    const ia = [
      makeIABook({ title: 'python Handbook', author_name: 'guido', ia_identifier: 'dup' }),
    ];
    expect(deduplicateIA(local, ia)).toHaveLength(0);
  });

  it('should strip punctuation before comparing', () => {
    const local = [makeLocalBook({ title: "Python: A Beginner's Guide", author_name: 'J. Smith' })];
    const ia = [
      makeIABook({
        title: 'Python A Beginners Guide',
        author_name: 'J Smith',
        ia_identifier: 'dup',
      }),
    ];
    expect(deduplicateIA(local, ia)).toHaveLength(0);
  });

  it('should keep IA books with no local match', () => {
    const local = [makeLocalBook({ title: 'Book A', author_name: 'Author A' })];
    const ia = [makeIABook({ title: 'Book B', author_name: 'Author B' })];
    expect(deduplicateIA(local, ia)).toHaveLength(1);
  });

  it('should handle empty local books', () => {
    const ia = [makeIABook()];
    expect(deduplicateIA([], ia)).toHaveLength(1);
  });

  it('should handle empty IA books', () => {
    const local = [makeLocalBook()];
    expect(deduplicateIA(local, [])).toHaveLength(0);
  });
});

// ── Hook integration tests ────────────────────────────

describe('useExploreBooks', () => {
  describe('return value shape', () => {
    it('should return all expected fields including IA fields', () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ books: [], total: 0 }),
      });
      const { result } = renderHook(() => useExploreBooks());

      expect(result.current).toHaveProperty('books');
      expect(result.current).toHaveProperty('total');
      expect(result.current).toHaveProperty('isLoading');
      expect(result.current).toHaveProperty('isStale');
      expect(result.current).toHaveProperty('error');
      expect(result.current).toHaveProperty('loadMore');
      expect(result.current).toHaveProperty('hasMore');
      expect(result.current).toHaveProperty('refresh');
      expect(result.current).toHaveProperty('iaBooks');
      expect(result.current).toHaveProperty('iaTotal');
      expect(result.current).toHaveProperty('iaLoading');
      expect(result.current).toHaveProperty('iaError');
      expect(result.current).toHaveProperty('iaLoadMore');
      expect(result.current).toHaveProperty('iaHasMore');
    });

    it('should start with empty IA state', () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ books: [], total: 0 }),
      });
      const { result } = renderHook(() => useExploreBooks());

      expect(result.current.iaBooks).toEqual([]);
      expect(result.current.iaTotal).toBe(0);
      expect(result.current.iaLoading).toBe(false);
      expect(result.current.iaError).toBeNull();
      expect(result.current.iaHasMore).toBe(false);
    });
  });

  describe('local-only fetch (no search query)', () => {
    it('should fetch local books and NOT trigger IA search', async () => {
      setupFetchRouter({ local: { books: [makeLocalBook()], total: 1 } });

      const { result } = renderHook(() => useExploreBooks({ subject: 'Science' }));

      await waitFor(() => {
        expect(result.current.books).toHaveLength(1);
      });

      expect(result.current.iaBooks).toEqual([]);
      // All fetch calls should be to /catalog/books (not ia/search)
      const urls = mockFetch.mock.calls.map((c: unknown[]) => c[0] as string);
      expect(urls.every((u) => u.includes('/catalog/books'))).toBe(true);
    });
  });

  describe('blended search (with query)', () => {
    it('should fetch both local and IA results when query is provided', async () => {
      setupFetchRouter({
        local: { books: [makeLocalBook()], total: 1 },
        ia: { books: [makeIABook()], total: 100 },
      });

      const { result } = renderHook(() => useExploreBooks({ q: 'test-blend' }));

      await waitFor(() => {
        expect(result.current.iaBooks).toHaveLength(1);
      });

      expect(result.current.books).toHaveLength(1);
      expect(result.current.iaBooks[0]!.source).toBe('internet-archive');
      expect(result.current.iaTotal).toBe(100);
      expect(result.current.iaLoading).toBe(false);
    });

    it('should compute iaHasMore correctly', async () => {
      setupFetchRouter({
        local: { books: [makeLocalBook()], total: 1 },
        ia: { books: [makeIABook()], total: 50 },
      });

      const { result } = renderHook(() => useExploreBooks({ q: 'test-hasmore', limit: 20 }));

      await waitFor(() => {
        expect(result.current.iaBooks).toHaveLength(1);
      });

      expect(result.current.iaHasMore).toBe(true);
    });

    it('should set iaHasMore to false when total fits in one page', async () => {
      setupFetchRouter({
        local: { books: [makeLocalBook()], total: 1 },
        ia: { books: [makeIABook()], total: 1 },
      });

      const { result } = renderHook(() => useExploreBooks({ q: 'test-nomore', limit: 20 }));

      await waitFor(() => {
        expect(result.current.iaBooks).toHaveLength(1);
      });

      expect(result.current.iaHasMore).toBe(false);
    });

    it('should handle IA fetch failure gracefully', async () => {
      setupFetchRouter({
        local: { books: [makeLocalBook()], total: 1 },
        ia: 'fail',
      });

      const { result } = renderHook(() => useExploreBooks({ q: 'test-fail' }));

      await waitFor(() => {
        expect(result.current.books).toHaveLength(1);
        expect(result.current.iaLoading).toBe(false);
      });

      expect(result.current.iaError).toBe('ia_unavailable');
      expect(result.current.iaBooks).toEqual([]);
    });

    it('should handle IA graceful degradation (error in body)', async () => {
      setupFetchRouter({
        local: { books: [makeLocalBook()], total: 1 },
        ia: { books: [], total: 0, error: 'ia_unavailable' },
      });

      const { result } = renderHook(() => useExploreBooks({ q: 'test-degrade' }));

      await waitFor(() => {
        expect(result.current.iaError).toBe('ia_unavailable');
      });
    });

    it('should deduplicate IA results against local results', async () => {
      setupFetchRouter({
        local: {
          books: [makeLocalBook({ title: 'Same Book', author_name: 'Same Author' })],
          total: 1,
        },
        ia: {
          books: [
            makeIABook({ title: 'Same Book', author_name: 'Same Author', ia_identifier: 'dup' }),
            makeIABook({ title: 'Unique IA', author_name: 'IA Only', ia_identifier: 'uniq' }),
          ],
          total: 2,
        },
      });

      const { result } = renderHook(() => useExploreBooks({ q: 'test-dedup' }));

      await waitFor(() => {
        expect(result.current.iaBooks).toHaveLength(1);
      });

      expect(result.current.iaBooks[0]!.ia_identifier).toBe('uniq');
    });

    it('should clear IA state when query is removed', async () => {
      setupFetchRouter({
        local: { books: [makeLocalBook()], total: 1 },
        ia: { books: [makeIABook()], total: 100 },
      });

      const { result, rerender } = renderHook(({ q }: { q?: string }) => useExploreBooks({ q }), {
        initialProps: { q: 'test-clear' as string | undefined },
      });

      await waitFor(() => {
        expect(result.current.iaBooks).toHaveLength(1);
      });

      // Switch to browse mode (no query)
      rerender({ q: undefined });

      await waitFor(() => {
        expect(result.current.iaBooks).toEqual([]);
        expect(result.current.iaTotal).toBe(0);
      });
    });
  });
});
