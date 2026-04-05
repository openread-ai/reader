'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { CATALOG_API_BASE_URL } from '@/services/constants';
import { getPlatformFetch } from '@/utils/fetch';
import { createLogger } from '@/utils/logger';
import type { CatalogBook } from '@/types/catalog';

const logger = createLogger('wishlist');

type WishlistBook = CatalogBook & { wishlisted_at: string };

interface UseWishlistReturn {
  wishlistBooks: WishlistBook[];
  wishlistedIds: Set<string>;
  isLoading: boolean;
  toggle: (catalogBookId: string) => Promise<void>;
  isWishlisted: (catalogBookId: string) => boolean;
  refresh: () => void;
}

export function useWishlist(): UseWishlistReturn {
  const { token } = useAuth();
  const [wishlistBooks, setWishlistBooks] = useState<WishlistBook[]>([]);
  const [wishlistedIds, setWishlistedIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);

  const fetchWishlist = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    try {
      const platformFetch = await getPlatformFetch();
      const res = await platformFetch(`${CATALOG_API_BASE_URL}/api/catalog/wishlist`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const data = await res.json();
      setWishlistBooks(data.books);
      setWishlistedIds(new Set(data.books.map((b: WishlistBook) => b.id)));
    } catch (err) {
      logger.warn('Failed to fetch wishlist', { error: err });
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchWishlist();
  }, [fetchWishlist]);

  const toggle = useCallback(
    async (catalogBookId: string) => {
      if (!token) return;

      const wasWishlisted = wishlistedIds.has(catalogBookId);
      const method = wasWishlisted ? 'DELETE' : 'POST';

      // Optimistic update
      setWishlistedIds((prev) => {
        const next = new Set(prev);
        if (wasWishlisted) {
          next.delete(catalogBookId);
        } else {
          next.add(catalogBookId);
        }
        return next;
      });

      if (wasWishlisted) {
        setWishlistBooks((prev) => prev.filter((b) => b.id !== catalogBookId));
      }

      try {
        const platformFetch = await getPlatformFetch();
        const res = await platformFetch(
          `${CATALOG_API_BASE_URL}/api/catalog/books/${catalogBookId}/wishlist`,
          {
            method,
            headers: { Authorization: `Bearer ${token}` },
          },
        );
        if (!res.ok) throw new Error(`API error: ${res.status}`);

        // Refresh full list after add (to get the new book data)
        if (!wasWishlisted) {
          fetchWishlist();
        }
      } catch (err) {
        logger.error('Failed to toggle wishlist', { catalogBookId, error: err });
        // Revert optimistic update on failure
        setWishlistedIds((prev) => {
          const next = new Set(prev);
          if (wasWishlisted) {
            next.add(catalogBookId);
          } else {
            next.delete(catalogBookId);
          }
          return next;
        });
        if (wasWishlisted) {
          fetchWishlist();
        }
      }
    },
    [token, wishlistedIds, fetchWishlist],
  );

  const isWishlisted = useCallback(
    (catalogBookId: string) => wishlistedIds.has(catalogBookId),
    [wishlistedIds],
  );

  return { wishlistBooks, wishlistedIds, isLoading, toggle, isWishlisted, refresh: fetchWishlist };
}
