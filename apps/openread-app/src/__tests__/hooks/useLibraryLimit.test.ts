import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// ── Hoisted mocks ──────────────────────────────────────

const { mockAuthState, mockQuotaState, mockLibraryStoreState } = vi.hoisted(() => {
  const mockAuthState = {
    token: 'test-token',
    user: { id: 'user-1' },
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
  };
  const mockQuotaState = {
    quotas: [],
    userProfilePlan: 'free' as 'free' | 'reader' | 'pro' | undefined,
  };
  const mockLibraryStoreState = {
    library: [] as Array<{ hash: string; deletedAt?: number | null }>,
  };
  return { mockAuthState, mockQuotaState, mockLibraryStoreState };
});

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => mockAuthState,
}));

vi.mock('@/hooks/useQuotaStats', () => ({
  useQuotaStats: () => mockQuotaState,
}));

vi.mock('@/store/libraryStore', () => {
  const useLibraryStoreMock = (selector: (state: typeof mockLibraryStoreState) => unknown) =>
    selector(mockLibraryStoreState);
  useLibraryStoreMock.getState = () => mockLibraryStoreState;
  return { useLibraryStore: useLibraryStoreMock };
});

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ── Import SUT after mocks ─────────────────────────────

import {
  useLibraryLimit,
  checkLibraryLimit,
  getLibraryLimitForPlan,
} from '@/hooks/useLibraryLimit';
import { getFallbackConfig } from '@/lib/tier-config';

// ── Helpers ────────────────────────────────────────────

function createMockBooks(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    hash: `hash-${i}`,
    deletedAt: null,
  }));
}

// ── Tests ──────────────────────────────────────────────

describe('useLibraryLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthState.token = 'test-token';
    mockAuthState.user = { id: 'user-1' } as never;
    mockQuotaState.userProfilePlan = 'free';
    mockLibraryStoreState.library = [];
  });

  describe('getLibraryLimitForPlan (pure function)', () => {
    it('returns 10 for free plan', () => {
      const limit = getLibraryLimitForPlan('free');
      expect(limit).toBe(10);
    });

    it('returns null (unlimited) for reader plan', () => {
      const limit = getLibraryLimitForPlan('reader');
      expect(limit).toBeNull();
    });

    it('returns null (unlimited) for pro plan', () => {
      const limit = getLibraryLimitForPlan('pro');
      expect(limit).toBeNull();
    });

    it('reads from tier-config fallback, not hardcoded', () => {
      const config = getFallbackConfig();
      expect(getLibraryLimitForPlan('free')).toBe(config.tiers.free.library_limit);
      expect(getLibraryLimitForPlan('reader')).toBe(config.tiers.reader.library_limit);
      expect(getLibraryLimitForPlan('pro')).toBe(config.tiers.pro.library_limit);
    });
  });

  describe('checkLibraryLimit (pure function)', () => {
    it('allows Free user with 9 books to add 1 more', () => {
      const result = checkLibraryLimit(9, 'free');
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(10);
    });

    it('blocks Free user with 10 books', () => {
      const result = checkLibraryLimit(10, 'free');
      expect(result.allowed).toBe(false);
      expect(result.limit).toBe(10);
    });

    it('blocks Free user with 15 books (legacy overage)', () => {
      const result = checkLibraryLimit(15, 'free');
      expect(result.allowed).toBe(false);
      expect(result.limit).toBe(10);
    });

    it('allows Reader user with 100 books (no limit)', () => {
      const result = checkLibraryLimit(100, 'reader');
      expect(result.allowed).toBe(true);
      expect(result.limit).toBeNull();
    });

    it('allows Pro user with 1000 books (no limit)', () => {
      const result = checkLibraryLimit(1000, 'pro');
      expect(result.allowed).toBe(true);
      expect(result.limit).toBeNull();
    });

    it('allows Free user with 0 books', () => {
      const result = checkLibraryLimit(0, 'free');
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(10);
    });
  });

  describe('useLibraryLimit hook', () => {
    it('Free user with 9 books can add a book', () => {
      mockQuotaState.userProfilePlan = 'free';
      mockLibraryStoreState.library = createMockBooks(9);

      const { result } = renderHook(() => useLibraryLimit());

      expect(result.current.canAddBook).toBe(true);
      expect(result.current.libraryLimit).toBe(10);
      expect(result.current.currentCount).toBe(9);
      expect(result.current.plan).toBe('free');
    });

    it('Free user with 10 books is blocked', () => {
      mockQuotaState.userProfilePlan = 'free';
      mockLibraryStoreState.library = createMockBooks(10);

      const { result } = renderHook(() => useLibraryLimit());

      expect(result.current.canAddBook).toBe(false);
      expect(result.current.libraryLimit).toBe(10);
      expect(result.current.currentCount).toBe(10);
    });

    it('Reader user with 100 books has no limit', () => {
      mockQuotaState.userProfilePlan = 'reader';
      mockLibraryStoreState.library = createMockBooks(100);

      const { result } = renderHook(() => useLibraryLimit());

      expect(result.current.canAddBook).toBe(true);
      expect(result.current.libraryLimit).toBeNull();
      expect(result.current.currentCount).toBe(100);
      expect(result.current.plan).toBe('reader');
    });

    it('Pro user has no limit', () => {
      mockQuotaState.userProfilePlan = 'pro';
      mockLibraryStoreState.library = createMockBooks(500);

      const { result } = renderHook(() => useLibraryLimit());

      expect(result.current.canAddBook).toBe(true);
      expect(result.current.libraryLimit).toBeNull();
      expect(result.current.plan).toBe('pro');
    });

    it('Free user with 15 books (legacy) can read but not add', () => {
      mockQuotaState.userProfilePlan = 'free';
      mockLibraryStoreState.library = createMockBooks(15);

      const { result } = renderHook(() => useLibraryLimit());

      expect(result.current.canAddBook).toBe(false);
      expect(result.current.libraryLimit).toBe(10);
      expect(result.current.currentCount).toBe(15);
      // Legacy users keep their books — currentCount > limit is valid
    });

    it('excludes deleted books from the count', () => {
      mockQuotaState.userProfilePlan = 'free';
      mockLibraryStoreState.library = [
        ...createMockBooks(9),
        { hash: 'deleted-book', deletedAt: Date.now() },
        { hash: 'deleted-book-2', deletedAt: Date.now() - 100000 },
      ];

      const { result } = renderHook(() => useLibraryLimit());

      // Only 9 non-deleted books
      expect(result.current.currentCount).toBe(9);
      expect(result.current.canAddBook).toBe(true);
    });

    it('returns upgrade info for CTA', () => {
      mockQuotaState.userProfilePlan = 'free';
      mockLibraryStoreState.library = createMockBooks(10);

      const { result } = renderHook(() => useLibraryLimit());

      expect(result.current.upgradeTierName).toBe('Reader');
      expect(result.current.upgradePriceCents).toBe(999);
    });

    it('defaults to free plan when user is not logged in', () => {
      mockAuthState.user = null as never;
      mockQuotaState.userProfilePlan = undefined;
      mockLibraryStoreState.library = createMockBooks(10);

      const { result } = renderHook(() => useLibraryLimit());

      expect(result.current.plan).toBe('free');
      expect(result.current.canAddBook).toBe(false);
    });

    it('returns isLoading true when user is undefined', () => {
      mockAuthState.user = undefined as never;

      const { result } = renderHook(() => useLibraryLimit());

      expect(result.current.isLoading).toBe(true);
    });

    it('returns isLoading false when user is resolved', () => {
      mockAuthState.user = { id: 'user-1' } as never;

      const { result } = renderHook(() => useLibraryLimit());

      expect(result.current.isLoading).toBe(false);
    });
  });
});
