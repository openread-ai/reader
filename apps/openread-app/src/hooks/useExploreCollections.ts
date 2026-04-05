'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { CATALOG_API_BASE_URL } from '@/services/constants';
import { getPlatformFetch } from '@/utils/fetch';
import { createLogger } from '@/utils/logger';
import type { CatalogBook, CatalogCollection, CollectionWithBooks } from '@/types/catalog';

export type { CatalogCollection, CollectionWithBooks } from '@/types/catalog';

const logger = createLogger('explore-collections');

interface UseExploreCollectionsReturn {
  collections: CollectionWithBooks[];
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

// ── Client-side cache ──────────────────────────────────

interface CollectionsCacheEntry {
  collections: CollectionWithBooks[];
  timestamp: number;
}

let collectionsCache: CollectionsCacheEntry | null = null;
const CACHE_TTL = 60_000; // 60 seconds

function getCachedCollections(): CollectionWithBooks[] | null {
  if (!collectionsCache) return null;
  if (Date.now() - collectionsCache.timestamp > CACHE_TTL) {
    collectionsCache = null;
    return null;
  }
  return collectionsCache.collections;
}

function setCachedCollections(collections: CollectionWithBooks[]) {
  collectionsCache = { collections, timestamp: Date.now() };
}

/** Reset module-level cache (for testing) */
export function _resetCollectionsCache() {
  collectionsCache = null;
}

// ── Hook ───────────────────────────────────────────────

export function useExploreCollections(booksPerCollection = 10): UseExploreCollectionsReturn {
  const [collections, setCollections] = useState<CollectionWithBooks[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController>(null);

  const fetchCollections = useCallback(
    async (skipCache = false) => {
      // Check cache first
      if (!skipCache) {
        const cached = getCachedCollections();
        if (cached) {
          setCollections(cached);
          setIsLoading(false);
          setError(null);
          return;
        }
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setIsLoading(true);
      setError(null);

      try {
        const platformFetch = await getPlatformFetch();

        // Step 1: Fetch the list of collections
        const listRes = await platformFetch(`${CATALOG_API_BASE_URL}/catalog/collections`, {
          signal: controller.signal,
        });

        if (!listRes.ok) {
          throw new Error(`API error: ${listRes.status}`);
        }

        const listData: { collections: CatalogCollection[] } = await listRes.json();

        // Filter out empty collections (book_count === 0)
        const nonEmpty = listData.collections.filter((c) => c.book_count > 0);

        // Step 2: Fetch books for each collection in parallel
        const withBooks = await Promise.all(
          nonEmpty.map(async (collection) => {
            try {
              const booksRes = await platformFetch(
                `${CATALOG_API_BASE_URL}/catalog/collections/${collection.slug}/books?limit=${booksPerCollection}`,
                { signal: controller.signal },
              );

              if (!booksRes.ok) {
                return { ...collection, books: [] as CatalogBook[] };
              }

              const booksData: { books: CatalogBook[] } = await booksRes.json();
              return { ...collection, books: booksData.books };
            } catch {
              // If individual collection fetch fails, return empty books
              return { ...collection, books: [] as CatalogBook[] };
            }
          }),
        );

        // Filter out collections that ended up with 0 books after fetch
        const result = withBooks.filter((c) => c.books.length > 0);

        if (!controller.signal.aborted) {
          setCollections(result);
          setCachedCollections(result);
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        logger.error('Failed to load collections', { error: err });
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : 'Failed to load collections');
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    },
    [booksPerCollection],
  );

  useEffect(() => {
    fetchCollections();
    return () => {
      abortRef.current?.abort();
    };
  }, [fetchCollections]);

  const refresh = useCallback(() => {
    collectionsCache = null;
    fetchCollections(true);
  }, [fetchCollections]);

  return { collections, isLoading, error, refresh };
}
