import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import {
  useFeatureFlags,
  useCanSync,
  useCanAnalyze,
  useCanUseKnowledgeGraph,
} from '@/hooks/useFeatureFlags';
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

describe('useFeatureFlags', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = null;
    mockUserProfilePlan = undefined;
  });

  describe('unauthenticated user', () => {
    it('should return free tier flags when no user', async () => {
      mockUser = null;
      mockUserProfilePlan = undefined;

      const { result } = renderHook(() => useFeatureFlags());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.plan).toBe('free');
      expect(result.current.flags.maxBooks).toBe(50);
      expect(result.current.flags.aiAnalysis).toBe(false);
      expect(result.current.flags.knowledgeGraph).toBe(false);
    });
  });

  describe('free tier user', () => {
    beforeEach(() => {
      mockUser = { id: 'user-1' };
      mockUserProfilePlan = 'free';
    });

    it('should return free tier flags', async () => {
      const { result } = renderHook(() => useFeatureFlags());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.plan).toBe('free');
      // Tier-gate driven flags
      expect(result.current.flags.canTTS).toBe(false);
      expect(result.current.flags.cloudSync).toBe(false);
      expect(result.current.flags.canTranslate).toBe(false);
      expect(result.current.flags.canBYOK).toBe(false);
      expect(result.current.flags.canBoost).toBe(false);
      // Limit-based flags
      expect(result.current.flags.aiAnalysis).toBe(false);
      expect(result.current.flags.knowledgeGraph).toBe(false);
      expect(result.current.flags.marketplace).toBe(false);
      expect(result.current.flags.maxBooks).toBe(50);
      expect(result.current.flags.maxCloudStorage).toBe(500 * 1024 * 1024); // 500MB
    });

    it('should return false for canTTS', async () => {
      const { result } = renderHook(() => useFeatureFlags());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.canTTS()).toBe(false);
    });

    it('should return false for canTranslate', async () => {
      const { result } = renderHook(() => useFeatureFlags());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.canTranslate()).toBe(false);
    });

    it('should return false for canBYOK', async () => {
      const { result } = renderHook(() => useFeatureFlags());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.canBYOK()).toBe(false);
    });

    it('should return false for canSync (tier-gated, not just auth)', async () => {
      const { result } = renderHook(() => useFeatureFlags());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Free tier: can_sync is false, so canSync() is false even if authenticated
      expect(result.current.canSync()).toBe(false);
    });

    it('should return false for canAnalyze', async () => {
      const { result } = renderHook(() => useFeatureFlags());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.canAnalyze()).toBe(false);
    });

    it('should correctly check book limit', async () => {
      const { result } = renderHook(() => useFeatureFlags());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.canAddBook(49)).toBe(true);
      expect(result.current.canAddBook(50)).toBe(false);
      expect(result.current.canAddBook(51)).toBe(false);
    });
  });

  describe('reader tier user', () => {
    beforeEach(() => {
      mockUser = { id: 'user-1' };
      mockUserProfilePlan = 'reader';
    });

    it('should return reader tier flags', async () => {
      const { result } = renderHook(() => useFeatureFlags());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.plan).toBe('reader');
      // Tier-gate driven flags
      expect(result.current.flags.canTTS).toBe(true);
      expect(result.current.flags.cloudSync).toBe(true);
      expect(result.current.flags.canTranslate).toBe(false);
      expect(result.current.flags.canBYOK).toBe(true);
      expect(result.current.flags.canBoost).toBe(true);
      // Limit-based flags
      expect(result.current.flags.aiAnalysis).toBe(true);
      expect(result.current.flags.knowledgeGraph).toBe(false);
      expect(result.current.flags.marketplace).toBe(true);
      expect(result.current.flags.maxBooks).toBe(500);
      expect(result.current.flags.maxCloudStorage).toBe(5 * 1024 * 1024 * 1024); // 5GB
    });

    it('should return true for canTTS', async () => {
      const { result } = renderHook(() => useFeatureFlags());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.canTTS()).toBe(true);
    });

    it('should return false for canTranslate (reader has no translation)', async () => {
      const { result } = renderHook(() => useFeatureFlags());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.canTranslate()).toBe(false);
    });

    it('should return true for canBYOK', async () => {
      const { result } = renderHook(() => useFeatureFlags());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.canBYOK()).toBe(true);
    });

    it('should return true for canSync', async () => {
      const { result } = renderHook(() => useFeatureFlags());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.canSync()).toBe(true);
    });

    it('should return true for canAnalyze', async () => {
      const { result } = renderHook(() => useFeatureFlags());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.canAnalyze()).toBe(true);
    });
  });

  describe('pro tier user', () => {
    beforeEach(() => {
      mockUser = { id: 'user-1' };
      mockUserProfilePlan = 'pro';
    });

    it('should return pro tier flags', async () => {
      const { result } = renderHook(() => useFeatureFlags());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.plan).toBe('pro');
      // Tier-gate driven flags - all true for pro
      expect(result.current.flags.canTTS).toBe(true);
      expect(result.current.flags.cloudSync).toBe(true);
      expect(result.current.flags.canTranslate).toBe(true);
      expect(result.current.flags.canBYOK).toBe(true);
      expect(result.current.flags.canBoost).toBe(true);
      // Limit-based flags
      expect(result.current.flags.aiAnalysis).toBe(true);
      expect(result.current.flags.knowledgeGraph).toBe(true);
      expect(result.current.flags.marketplace).toBe(true);
      expect(result.current.flags.maxBooks).toBe(Infinity);
      expect(result.current.flags.maxCloudStorage).toBe(20 * 1024 * 1024 * 1024); // 20GB
      expect(result.current.flags.prioritySupport).toBe(true);
    });

    it('should return true for canTranslate (pro only)', async () => {
      const { result } = renderHook(() => useFeatureFlags());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.canTranslate()).toBe(true);
    });

    it('should return true for canUseKnowledgeGraph', async () => {
      const { result } = renderHook(() => useFeatureFlags());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.canUseKnowledgeGraph()).toBe(true);
    });

    it('should always allow adding books', async () => {
      const { result } = renderHook(() => useFeatureFlags());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.canAddBook(1000)).toBe(true);
      expect(result.current.canAddBook(10000)).toBe(true);
    });
  });

  describe('unknown plan falls back to free', () => {
    beforeEach(() => {
      mockUser = { id: 'user-1' };
      // Simulate an unknown plan value (e.g. legacy 'purchase') from token
      mockUserProfilePlan = 'bogus' as UserPlan;
    });

    it('should return free tier flags for unknown plan', async () => {
      const { result } = renderHook(() => useFeatureFlags());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.flags.aiAnalysis).toBe(false);
      expect(result.current.flags.knowledgeGraph).toBe(false);
      expect(result.current.flags.canTTS).toBe(false);
      expect(result.current.flags.cloudSync).toBe(false);
    });
  });

  describe('hasStorageQuota', () => {
    it('should return true when within quota', async () => {
      mockUser = { id: 'user-1' };
      mockUserProfilePlan = 'free';

      const { result } = renderHook(() => useFeatureFlags());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const currentUsage = 100 * 1024 * 1024; // 100MB
      const additional = 100 * 1024 * 1024; // 100MB

      expect(result.current.hasStorageQuota(currentUsage, additional)).toBe(true);
    });

    it('should return false when exceeding quota', async () => {
      mockUser = { id: 'user-1' };
      mockUserProfilePlan = 'free';

      const { result } = renderHook(() => useFeatureFlags());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const currentUsage = 400 * 1024 * 1024; // 400MB
      const additional = 200 * 1024 * 1024; // 200MB (total 600MB > 500MB limit)

      expect(result.current.hasStorageQuota(currentUsage, additional)).toBe(false);
    });
  });

  describe('hasTranslationQuota', () => {
    it('should return true when within quota', async () => {
      mockUser = { id: 'user-1' };
      mockUserProfilePlan = 'free';

      const { result } = renderHook(() => useFeatureFlags());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const currentUsage = 5 * 1024; // 5K chars
      const additional = 2 * 1024; // 2K chars

      expect(result.current.hasTranslationQuota(currentUsage, additional)).toBe(true);
    });

    it('should return false when exceeding quota', async () => {
      mockUser = { id: 'user-1' };
      mockUserProfilePlan = 'free';

      const { result } = renderHook(() => useFeatureFlags());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const currentUsage = 9 * 1024; // 9K chars
      const additional = 2 * 1024; // 2K chars (total 11K > 10K limit)

      expect(result.current.hasTranslationQuota(currentUsage, additional)).toBe(false);
    });
  });
});

describe('useCanSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = null;
    mockUserProfilePlan = undefined;
  });

  it('should return false when not authenticated', async () => {
    mockUser = null;

    const { result } = renderHook(() => useCanSync());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.canSync).toBe(false);
  });

  it('should return false for free authenticated user (tier-gated)', async () => {
    mockUser = { id: 'user-1' };
    mockUserProfilePlan = 'free';

    const { result } = renderHook(() => useCanSync());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Free tier: can_sync is false
    expect(result.current.canSync).toBe(false);
  });

  it('should return true for reader user', async () => {
    mockUser = { id: 'user-1' };
    mockUserProfilePlan = 'reader';

    const { result } = renderHook(() => useCanSync());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.canSync).toBe(true);
  });
});

describe('useCanAnalyze', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = null;
    mockUserProfilePlan = undefined;
  });

  it('should return false for free users', async () => {
    mockUser = { id: 'user-1' };
    mockUserProfilePlan = 'free';

    const { result } = renderHook(() => useCanAnalyze());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.canAnalyze).toBe(false);
  });

  it('should return true for pro users', async () => {
    mockUser = { id: 'user-1' };
    mockUserProfilePlan = 'pro';

    const { result } = renderHook(() => useCanAnalyze());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.canAnalyze).toBe(true);
  });
});

describe('useCanUseKnowledgeGraph', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = null;
    mockUserProfilePlan = undefined;
  });

  it('should return false for reader users', async () => {
    mockUser = { id: 'user-1' };
    mockUserProfilePlan = 'reader';

    const { result } = renderHook(() => useCanUseKnowledgeGraph());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.canUseKnowledgeGraph).toBe(false);
  });

  it('should return true for pro users', async () => {
    mockUser = { id: 'user-1' };
    mockUserProfilePlan = 'pro';

    const { result } = renderHook(() => useCanUseKnowledgeGraph());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.canUseKnowledgeGraph).toBe(true);
  });
});
