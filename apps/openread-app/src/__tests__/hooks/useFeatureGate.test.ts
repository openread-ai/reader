import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { UserPlan } from '@/types/quota';

// Mock state
let mockUser: { id: string } | null = null;
let mockUserProfilePlan: UserPlan | undefined = undefined;

// Mock useAuth
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: mockUser,
    token: mockUser ? 'mock-token' : null,
  }),
}));

// Mock useQuotaStats
vi.mock('@/hooks/useQuotaStats', () => ({
  useQuotaStats: () => ({
    quotas: [],
    userProfilePlan: mockUserProfilePlan,
  }),
}));

// Mock tier-config transitive dependencies (supabase, logger)
vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: vi.fn(() => ({ from: vi.fn() })),
}));
vi.mock('@/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

import { useFeatureGate } from '@/hooks/useFeatureGate';

describe('useFeatureGate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = null;
    mockUserProfilePlan = undefined;
  });

  // ─── Free tier ─────────────────────────────────────────────────────

  describe('free tier', () => {
    beforeEach(() => {
      mockUser = { id: 'user-1' };
      mockUserProfilePlan = 'free';
    });

    it('should gate TTS for free users', async () => {
      const { result } = renderHook(() => useFeatureGate('tts'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.allowed).toBe(false);
      expect(result.current.requiredTier).toBe('reader');
      expect(result.current.requiredTierName).toBe('Reader');
      expect(result.current.message).toContain('Text-to-Speech');
      expect(result.current.message).toContain('Reader');
      expect(result.current.plan).toBe('free');
    });

    it('should gate sync for free users', async () => {
      const { result } = renderHook(() => useFeatureGate('sync'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.allowed).toBe(false);
      expect(result.current.requiredTier).toBe('reader');
      expect(result.current.message).toContain('Cloud Sync');
    });

    it('should gate translate for free users', async () => {
      const { result } = renderHook(() => useFeatureGate('translate'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.allowed).toBe(false);
      expect(result.current.requiredTier).toBe('pro');
      expect(result.current.requiredTierName).toBe('Pro');
      expect(result.current.message).toContain('Translation');
      expect(result.current.message).toContain('Pro');
    });

    it('should gate BYOK for free users', async () => {
      const { result } = renderHook(() => useFeatureGate('byok'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.allowed).toBe(false);
      expect(result.current.requiredTier).toBe('reader');
      expect(result.current.message).toContain('Bring Your Own Key');
    });

    it('should gate boost for free users', async () => {
      const { result } = renderHook(() => useFeatureGate('boost'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.allowed).toBe(false);
      expect(result.current.requiredTier).toBe('reader');
    });
  });

  // ─── Reader tier ───────────────────────────────────────────────────

  describe('reader tier', () => {
    beforeEach(() => {
      mockUser = { id: 'user-1' };
      mockUserProfilePlan = 'reader';
    });

    it('should allow TTS for reader users', async () => {
      const { result } = renderHook(() => useFeatureGate('tts'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.allowed).toBe(true);
      expect(result.current.message).toBe('');
      expect(result.current.plan).toBe('reader');
    });

    it('should allow sync for reader users', async () => {
      const { result } = renderHook(() => useFeatureGate('sync'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.allowed).toBe(true);
    });

    it('should gate translate for reader users (pro only)', async () => {
      const { result } = renderHook(() => useFeatureGate('translate'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.allowed).toBe(false);
      expect(result.current.requiredTier).toBe('pro');
      expect(result.current.message).toContain('Pro');
    });

    it('should allow BYOK for reader users', async () => {
      const { result } = renderHook(() => useFeatureGate('byok'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.allowed).toBe(true);
    });

    it('should allow boost for reader users', async () => {
      const { result } = renderHook(() => useFeatureGate('boost'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.allowed).toBe(true);
    });
  });

  // ─── Pro tier ──────────────────────────────────────────────────────

  describe('pro tier', () => {
    beforeEach(() => {
      mockUser = { id: 'user-1' };
      mockUserProfilePlan = 'pro';
    });

    it('should allow all features for pro users', async () => {
      const features = ['tts', 'sync', 'translate', 'byok', 'boost'] as const;

      for (const feature of features) {
        const { result } = renderHook(() => useFeatureGate(feature));

        await waitFor(() => {
          expect(result.current.isLoading).toBe(false);
        });

        expect(result.current.allowed).toBe(true);
        expect(result.current.message).toBe('');
        expect(result.current.plan).toBe('pro');
      }
    });
  });

  // ─── Unauthenticated user ─────────────────────────────────────────

  describe('unauthenticated user', () => {
    it('should gate all features (defaults to free)', async () => {
      mockUser = null;
      mockUserProfilePlan = undefined;

      const { result } = renderHook(() => useFeatureGate('tts'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.allowed).toBe(false);
      expect(result.current.plan).toBe('free');
    });
  });

  // ─── Unknown plan ──────────────────────────────────────────────────

  describe('unknown plan', () => {
    it('should fall back to free tier gates', async () => {
      mockUser = { id: 'user-1' };
      mockUserProfilePlan = 'unknown' as UserPlan;

      const { result } = renderHook(() => useFeatureGate('tts'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.allowed).toBe(false);
    });
  });

  // ─── S4.2: Price and CTA text ─────────────��───────────────────────

  describe('price display in gate result (S4.2)', () => {
    beforeEach(() => {
      mockUser = { id: 'user-1' };
      mockUserProfilePlan = 'free';
    });

    it('should include Reader price for TTS gate', async () => {
      const { result } = renderHook(() => useFeatureGate('tts'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.priceDisplay).toBe('$9.99/mo');
      expect(result.current.ctaText).toContain('Reader');
      expect(result.current.ctaText).toContain('$9.99/mo');
    });

    it('should include Pro price for translate gate', async () => {
      const { result } = renderHook(() => useFeatureGate('translate'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.priceDisplay).toBe('$19.99/mo');
      expect(result.current.ctaText).toContain('Pro');
      expect(result.current.ctaText).toContain('$19.99/mo');
    });

    it('should include Reader price for sync gate', async () => {
      const { result } = renderHook(() => useFeatureGate('sync'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.priceDisplay).toBe('$9.99/mo');
      expect(result.current.ctaText).toContain('Reader');
    });

    it('should include Reader price for BYOK gate', async () => {
      const { result } = renderHook(() => useFeatureGate('byok'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.priceDisplay).toBe('$9.99/mo');
      expect(result.current.ctaText).toContain('Reader');
    });

    it('reader user should see Pro price for translate', async () => {
      mockUserProfilePlan = 'reader';
      const { result } = renderHook(() => useFeatureGate('translate'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.priceDisplay).toBe('$19.99/mo');
      expect(result.current.ctaText).toContain('Pro');
    });

    it('reader user should have empty ctaText for allowed features', async () => {
      mockUserProfilePlan = 'reader';
      const { result } = renderHook(() => useFeatureGate('tts'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.allowed).toBe(true);
      expect(result.current.ctaText).toBe('');
    });
  });
});
