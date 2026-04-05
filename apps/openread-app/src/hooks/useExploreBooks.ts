'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { CATALOG_API_BASE_URL } from '@/services/constants';
import { getPlatformFetch } from '@/utils/fetch';
import { createLogger } from '@/utils/logger';
import type { CatalogBook } from '@/types/catalog';

export type { CatalogBook } from '@/types/catalog';

const logger = createLogger('explore-books');

interface UseExploreBooksParams {
  q?: string;
  subject?: string;
  language?: string;
  languages?: string[];
  region?: string;
  sort?: 'popularity' | 'relevance' | 'title_asc' | 'title_desc' | 'added_desc';
  limit?: number;
}

interface UseExploreBooksReturn {
  books: CatalogBook[];
  total: number;
  isLoading: boolean;
  isStale: boolean;
  error: string | null;
  loadMore: () => void;
  hasMore: boolean;
  refresh: () => void;
  // IA blended search fields
  iaBooks: CatalogBook[];
  iaTotal: number;
  iaLoading: boolean;
  iaError: string | null;
  iaLoadMore: () => void;
  iaHasMore: boolean;
}

interface CacheEntry {
  books: CatalogBook[];
  total: number;
  timestamp: number;
}

// Client-side query cache — survives re-renders, shared across hook instances
const queryCache = new Map<string, CacheEntry>();
const CACHE_TTL = 60_000; // 1 minute

/** Clear the module-level query cache. Exported for use in tests only. */
export function _clearQueryCache() {
  queryCache.clear();
}

function getCached(key: string): CacheEntry | null {
  const entry = queryCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    queryCache.delete(key);
    return null;
  }
  return entry;
}

function setCache(key: string, books: CatalogBook[], total: number) {
  queryCache.set(key, { books, total, timestamp: Date.now() });
  // Evict old entries if cache grows too large
  if (queryCache.size > 50) {
    const oldest = [...queryCache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
    for (let i = 0; i < 10; i++) queryCache.delete(oldest[i]![0]);
  }
}

/**
 * Dedup IA books against local books by normalized title+author.
 * Returns only IA books that do NOT have a local match.
 */
export function deduplicateIA(localBooks: CatalogBook[], iaBooks: CatalogBook[]): CatalogBook[] {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const localKeys = new Set(
    localBooks.map((b) => `${normalize(b.title)}::${normalize(b.author_name)}`),
  );
  return iaBooks.filter(
    (b) => !localKeys.has(`${normalize(b.title)}::${normalize(b.author_name)}`),
  );
}

export function useExploreBooks(params: UseExploreBooksParams = {}): UseExploreBooksReturn {
  const [books, setBooks] = useState<CatalogBook[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [isStale, setIsStale] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // IA search state
  const [iaBooks, setIaBooks] = useState<CatalogBook[]>([]);
  const [iaTotal, setIaTotal] = useState(0);
  const [iaPage, setIaPage] = useState(1);
  const [iaLoading, setIaLoading] = useState(false);
  const [iaError, setIaError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const abortRef = useRef<AbortController>(null);
  const iaAbortRef = useRef<AbortController>(null);

  const limit = params.limit ?? 20;

  // Whether we should also search IA (only when actively searching by query, not browsing/filtering)
  const shouldSearchIA = !!params.q;

  // Stable serialized key for params (excluding page)
  const paramsKey = useMemo(
    () =>
      JSON.stringify({
        q: params.q,
        subject: params.subject,
        language: params.language,
        languages: params.languages,
        region: params.region,
        sort: params.sort,
        limit,
      }),
    [
      params.q,
      params.subject,
      params.language,
      params.languages,
      params.region,
      params.sort,
      limit,
    ],
  );

  const buildSearchParams = useCallback(
    (fetchPage: number) => {
      const searchParams = new URLSearchParams();
      if (params.q) searchParams.set('q', params.q);
      if (params.subject) searchParams.set('subject', params.subject);
      if (params.language) searchParams.set('language', params.language);
      if (params.languages?.length) searchParams.set('languages', params.languages.join(','));
      if (params.region) searchParams.set('region', params.region);
      if (params.sort) searchParams.set('sort', params.sort);
      searchParams.set('page', String(fetchPage));
      searchParams.set('limit', String(limit));
      return searchParams;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [paramsKey],
  );

  // ── Fetch IA results ──────────────────────────────────
  const fetchIA = useCallback(
    async (query: string, fetchPage: number, append: boolean, localBooks: CatalogBook[]) => {
      iaAbortRef.current?.abort();
      const controller = new AbortController();
      iaAbortRef.current = controller;

      setIaLoading(true);
      setIaError(null);

      try {
        const iaParams = new URLSearchParams();
        iaParams.set('q', query);
        iaParams.set('page', String(fetchPage));
        iaParams.set('limit', String(limit));

        const platformFetch = await getPlatformFetch();
        const res = await platformFetch(`${CATALOG_API_BASE_URL}/catalog/ia/search?${iaParams}`, {
          signal: controller.signal,
        });

        if (!res.ok) {
          throw new Error('ia_unavailable');
        }

        const data = await res.json();

        if (!controller.signal.aborted) {
          const rawIaBooks: CatalogBook[] = data.books || [];
          const deduped = deduplicateIA(localBooks, rawIaBooks);

          if (append) {
            setIaBooks((prev) => {
              const combined = [...prev, ...deduped];
              return deduplicateIA(localBooks, combined);
            });
          } else {
            setIaBooks(deduped);
          }
          setIaTotal(data.total || 0);

          // If the API returned an error field (graceful degradation)
          if (data.error) {
            setIaError(data.error);
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        // IA errors are non-fatal — local results still show
        logger.error('IA search failed', err);
        setIaError(err instanceof Error ? err.message : 'ia_unavailable');
      } finally {
        if (!controller.signal.aborted) {
          setIaLoading(false);
        }
      }
    },
    [limit],
  );

  // ── Fetch local catalog results ───────────────────────
  const fetchBooks = useCallback(
    async (fetchPage: number, append: boolean) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const cacheKey = `${paramsKey}:${fetchPage}`;

      // Check cache first — if hit, show cached data immediately
      if (!append) {
        const cached = getCached(cacheKey);
        if (cached) {
          setBooks(cached.books);
          setTotal(cached.total);
          setIsStale(false);
          setIsLoading(false);
          setError(null);
          // Trigger IA search for cached local results too
          if (shouldSearchIA && params.q) {
            fetchIA(params.q, 1, false, cached.books);
          }
          return;
        }
        // Mark as stale (keep showing old data while loading)
        setIsStale(true);
      }

      setIsLoading(true);
      setError(null);

      try {
        const searchParams = buildSearchParams(fetchPage);
        const platformFetch = await getPlatformFetch();
        const res = await platformFetch(`${CATALOG_API_BASE_URL}/catalog/books?${searchParams}`, {
          signal: controller.signal,
        });

        if (!res.ok) {
          throw new Error(`API error: ${res.status}`);
        }

        const data = await res.json();

        if (!controller.signal.aborted) {
          const newBooks = append ? [...books, ...data.books] : data.books;
          setBooks(newBooks);
          setTotal(data.total);
          setIsStale(false);

          // Cache the result
          if (!append) {
            setCache(cacheKey, data.books, data.total);
          }

          // After local results arrive, also fetch IA results
          if (shouldSearchIA && params.q && !append) {
            setIaPage(1);
            fetchIA(params.q, 1, false, newBooks);
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        logger.error('Failed to fetch catalog books', err);
        setError(err instanceof Error ? err.message : 'Failed to load books');
        setIsStale(false);
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [paramsKey, buildSearchParams, shouldSearchIA, fetchIA],
  );

  // Reset and fetch when params change (debounced for search only)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    // Clear IA state when params change
    if (!shouldSearchIA) {
      iaAbortRef.current?.abort();
      setIaBooks([]);
      setIaTotal(0);
      setIaError(null);
      setIaLoading(false);
    }

    // Fetch immediately — debouncing is handled by ExploreSearchBar (300ms)
    setPage(1);
    fetchBooks(1, false);
  }, [fetchBooks, params.q, shouldSearchIA]);

  const loadMore = useCallback(() => {
    if (isLoading) return;
    const nextPage = page + 1;
    if ((nextPage - 1) * limit >= total) return;
    setPage(nextPage);
    fetchBooks(nextPage, true);
  }, [isLoading, page, limit, total, fetchBooks]);

  const iaLoadMore = useCallback(() => {
    if (iaLoading || !params.q) return;
    const nextPage = iaPage + 1;
    if ((nextPage - 1) * limit >= iaTotal) return;
    setIaPage(nextPage);
    fetchIA(params.q, nextPage, true, books);
  }, [iaLoading, iaPage, limit, iaTotal, fetchIA, params.q, books]);

  const refresh = useCallback(() => {
    // Clear cache for current params to force fresh fetch
    queryCache.delete(`${paramsKey}:1`);
    setPage(1);
    fetchBooks(1, false);
  }, [fetchBooks, paramsKey]);

  const hasMore = page * limit < total;
  const iaHasMore = iaPage * limit < iaTotal;

  return {
    books,
    total,
    isLoading,
    isStale,
    error,
    loadMore,
    hasMore,
    refresh,
    iaBooks,
    iaTotal,
    iaLoading,
    iaError,
    iaLoadMore,
    iaHasMore,
  };
}
