'use client';

/**
 * @module hooks/useLibraryLimit
 *
 * Client-side hook for checking whether the current user can add books
 * to their library, based on the tier-config library_limit.
 *
 * Uses getFallbackConfig() for client-safe access to tier definitions.
 * The fallback config mirrors the DB tier_config table defaults, so
 * limits stay configurable without hardcoding magic numbers.
 */

import { useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useQuotaStats } from '@/hooks/useQuotaStats';
import { useLibraryStore } from '@/store/libraryStore';
import { getFallbackConfig } from '@/lib/tier-config';
import type { UserPlan } from '@/types/quota';

export interface LibraryLimitInfo {
  /** Whether the user can add at least one more book */
  canAddBook: boolean;
  /** The library_limit for the user's tier, or null if unlimited */
  libraryLimit: number | null;
  /** Current number of non-deleted books in the library */
  currentCount: number;
  /** Current user plan */
  plan: UserPlan;
  /** Display name of the next paid tier (for upgrade CTA) */
  upgradeTierName: string;
  /** Monthly price in cents of the cheapest paid tier (for upgrade CTA) */
  upgradePriceCents: number;
  /** Whether the hook data is still loading */
  isLoading: boolean;
}

/**
 * Get the library_limit for a given plan from the fallback config.
 * Returns null for unlimited (paid tiers).
 */
export function getLibraryLimitForPlan(plan: UserPlan): number | null {
  const config = getFallbackConfig();
  const tier = config.tiers[plan] ?? config.tiers.free;
  return tier.library_limit;
}

/**
 * Check whether a user with the given plan and book count can add a book.
 * Pure function — no hooks, safe to call anywhere.
 */
export function checkLibraryLimit(
  currentBookCount: number,
  plan: UserPlan,
): { allowed: boolean; limit: number | null } {
  const limit = getLibraryLimitForPlan(plan);
  if (limit === null) return { allowed: true, limit: null };
  return { allowed: currentBookCount < limit, limit };
}

/**
 * React hook for library limit state.
 *
 * @example
 * ```tsx
 * const { canAddBook, libraryLimit, upgradePriceCents } = useLibraryLimit();
 * if (!canAddBook) {
 *   return <LibraryLimitBanner limit={libraryLimit} priceCents={upgradePriceCents} />;
 * }
 * ```
 */
export function useLibraryLimit(): LibraryLimitInfo {
  const { user } = useAuth();
  const { userProfilePlan } = useQuotaStats();
  const library = useLibraryStore((state) => state.library);

  const isLoading = user === undefined;

  const plan: UserPlan = useMemo(() => {
    if (!user) return 'free';
    return userProfilePlan || 'free';
  }, [user, userProfilePlan]);

  const currentCount = useMemo(() => {
    return library.filter((b) => !b.deletedAt).length;
  }, [library]);

  const { canAddBook, libraryLimit, upgradeTierName, upgradePriceCents } = useMemo(() => {
    const config = getFallbackConfig();
    const { allowed, limit } = checkLibraryLimit(currentCount, plan);
    const readerTier = config.tiers.reader;
    return {
      canAddBook: allowed,
      libraryLimit: limit,
      upgradeTierName: readerTier.display_name,
      upgradePriceCents: readerTier.display_price_cents,
    };
  }, [currentCount, plan]);

  return {
    canAddBook,
    libraryLimit,
    currentCount,
    plan,
    upgradeTierName,
    upgradePriceCents,
    isLoading,
  };
}
