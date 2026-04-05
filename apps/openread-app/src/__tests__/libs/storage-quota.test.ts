import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks ---

const mockSupabase = {
  from: vi.fn(),
  rpc: vi.fn(),
};

vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: vi.fn(() => mockSupabase),
}));

vi.mock('@/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock('@/lib/tier-config', () => ({
  getTierDefinition: vi.fn((plan: string) => {
    const tiers: Record<string, { storage_gb: number }> = {
      free: { storage_gb: 0 },
      reader: { storage_gb: 2 },
      pro: { storage_gb: 5 },
    };
    return Promise.resolve(tiers[plan] || tiers.free);
  }),
}));

// --- Helpers ---

const BYTES_PER_GB = 1024 * 1024 * 1024;

function setupAddonsQuery(data: Array<{ gb_amount: number }> | null, error: unknown = null) {
  const mockEqStatus = vi.fn().mockResolvedValue({ data, error });
  const mockEqUser = vi.fn().mockReturnValue({ eq: mockEqStatus });
  const mockSelect = vi.fn().mockReturnValue({ eq: mockEqUser });
  return { select: mockSelect };
}

function setupActiveAddonsQuery(data: unknown[] | null, error: unknown = null) {
  const mockOrder = vi.fn().mockResolvedValue({ data, error });
  const mockEqStatus = vi.fn().mockReturnValue({ order: mockOrder });
  const mockEqUser = vi.fn().mockReturnValue({ eq: mockEqStatus });
  const mockSelect = vi.fn().mockReturnValue({ eq: mockEqUser });
  return { select: mockSelect };
}

function setupPlanQuery(data: { storage_used_bytes: number } | null, error: unknown = null) {
  const mockSingle = vi.fn().mockResolvedValue({ data, error });
  const mockEq = vi.fn().mockReturnValue({ single: mockSingle });
  const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
  return { select: mockSelect };
}

function setupInsertQuery(data: unknown = null, error: unknown = null) {
  const mockSingle = vi.fn().mockResolvedValue({ data, error });
  const mockSelect = vi.fn().mockReturnValue({ single: mockSingle });
  const mockInsert = vi.fn().mockReturnValue({ select: mockSelect });
  return { insert: mockInsert };
}

function setupUpdateQuery(error: unknown = null) {
  const mockEq = vi.fn().mockResolvedValue({ error });
  const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq });
  return { update: mockUpdate };
}

// --- Tests ---

describe('storage-quota', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getStorageQuota', () => {
    it('should calculate quota for a user with no add-ons and no usage', async () => {
      const addonsResult = setupAddonsQuery([]);
      const planResult = setupPlanQuery({ storage_used_bytes: 0 });

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'storage_addons') return addonsResult;
        if (table === 'plans') return planResult;
        return {};
      });

      const { getStorageQuota } = await import('@/lib/storage-quota');
      const quota = await getStorageQuota('user-1', 'reader');

      expect(quota.baseGb).toBe(2);
      expect(quota.addonGb).toBe(0);
      expect(quota.totalBytes).toBe(2 * BYTES_PER_GB);
      expect(quota.usedBytes).toBe(0);
      expect(quota.availableBytes).toBe(2 * BYTES_PER_GB);
      expect(quota.percentUsed).toBe(0);
      expect(quota.isOverLimit).toBe(false);
    });

    it('should include add-on storage in total', async () => {
      const addonsResult = setupAddonsQuery([{ gb_amount: 5 }, { gb_amount: 10 }]);
      const planResult = setupPlanQuery({ storage_used_bytes: 0 });

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'storage_addons') return addonsResult;
        if (table === 'plans') return planResult;
        return {};
      });

      const { getStorageQuota } = await import('@/lib/storage-quota');
      const quota = await getStorageQuota('user-1', 'pro');

      expect(quota.baseGb).toBe(5);
      expect(quota.addonGb).toBe(15);
      expect(quota.totalBytes).toBe(20 * BYTES_PER_GB);
    });

    it('should calculate percentUsed correctly', async () => {
      const usedBytes = BYTES_PER_GB; // 1 GB used
      const addonsResult = setupAddonsQuery([]);
      const planResult = setupPlanQuery({ storage_used_bytes: usedBytes });

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'storage_addons') return addonsResult;
        if (table === 'plans') return planResult;
        return {};
      });

      const { getStorageQuota } = await import('@/lib/storage-quota');
      const quota = await getStorageQuota('user-1', 'reader');

      // 1 GB used of 2 GB total = 50%
      expect(quota.percentUsed).toBe(50);
      expect(quota.isOverLimit).toBe(false);
      expect(quota.availableBytes).toBe(BYTES_PER_GB);
    });

    it('should detect over-limit usage', async () => {
      const usedBytes = 3 * BYTES_PER_GB; // 3 GB used, only 2 GB base
      const addonsResult = setupAddonsQuery([]);
      const planResult = setupPlanQuery({ storage_used_bytes: usedBytes });

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'storage_addons') return addonsResult;
        if (table === 'plans') return planResult;
        return {};
      });

      const { getStorageQuota } = await import('@/lib/storage-quota');
      const quota = await getStorageQuota('user-1', 'reader');

      expect(quota.isOverLimit).toBe(true);
      expect(quota.percentUsed).toBe(150); // 3/2 * 100
      expect(quota.availableBytes).toBe(0); // clamped to 0
    });

    it('should handle free tier with 0 GB', async () => {
      const addonsResult = setupAddonsQuery([]);
      const planResult = setupPlanQuery({ storage_used_bytes: 0 });

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'storage_addons') return addonsResult;
        if (table === 'plans') return planResult;
        return {};
      });

      const { getStorageQuota } = await import('@/lib/storage-quota');
      const quota = await getStorageQuota('user-1', 'free');

      expect(quota.baseGb).toBe(0);
      expect(quota.totalBytes).toBe(0);
      expect(quota.percentUsed).toBe(0); // 0/0 = 0 (guarded)
      expect(quota.isOverLimit).toBe(false);
    });

    it('should handle DB errors gracefully for add-ons', async () => {
      const addonsResult = setupAddonsQuery(null, { message: 'DB error' });
      const planResult = setupPlanQuery({ storage_used_bytes: 0 });

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'storage_addons') return addonsResult;
        if (table === 'plans') return planResult;
        return {};
      });

      const { getStorageQuota } = await import('@/lib/storage-quota');
      const quota = await getStorageQuota('user-1', 'reader');

      // Should still work with 0 add-on GB
      expect(quota.addonGb).toBe(0);
      expect(quota.baseGb).toBe(2);
    });

    it('should handle DB errors gracefully for plan data', async () => {
      const addonsResult = setupAddonsQuery([]);
      const planResult = setupPlanQuery(null, { message: 'DB error' });

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'storage_addons') return addonsResult;
        if (table === 'plans') return planResult;
        return {};
      });

      const { getStorageQuota } = await import('@/lib/storage-quota');
      const quota = await getStorageQuota('user-1', 'reader');

      // Should still work with 0 bytes used
      expect(quota.usedBytes).toBe(0);
    });
  });

  describe('getActiveAddons', () => {
    it('should return active add-ons ordered by created_at', async () => {
      const mockAddons = [
        {
          id: 'addon-1',
          user_id: 'user-1',
          gb_amount: 5,
          price_cents: 199,
          source: 'stripe',
          source_subscription_id: 'sub_123',
          status: 'active',
          created_at: '2026-03-01T00:00:00Z',
          canceled_at: null,
        },
        {
          id: 'addon-2',
          user_id: 'user-1',
          gb_amount: 10,
          price_cents: 299,
          source: 'stripe',
          source_subscription_id: 'sub_456',
          status: 'active',
          created_at: '2026-03-15T00:00:00Z',
          canceled_at: null,
        },
      ];

      const result = setupActiveAddonsQuery(mockAddons);
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'storage_addons') return result;
        return {};
      });

      const { getActiveAddons } = await import('@/lib/storage-quota');
      const addons = await getActiveAddons('user-1');

      expect(addons).toHaveLength(2);
      expect(addons[0]!.id).toBe('addon-1');
      expect(addons[1]!.id).toBe('addon-2');
    });

    it('should return empty array when no active add-ons', async () => {
      const result = setupActiveAddonsQuery([]);
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'storage_addons') return result;
        return {};
      });

      const { getActiveAddons } = await import('@/lib/storage-quota');
      const addons = await getActiveAddons('user-1');

      expect(addons).toHaveLength(0);
    });

    it('should return empty array on DB error', async () => {
      const result = setupActiveAddonsQuery(null, { message: 'DB error' });
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'storage_addons') return result;
        return {};
      });

      const { getActiveAddons } = await import('@/lib/storage-quota');
      const addons = await getActiveAddons('user-1');

      expect(addons).toHaveLength(0);
    });
  });

  describe('getAddonStorageGb', () => {
    it('should sum gb_amount across all active add-ons', async () => {
      const mockAddons = [
        {
          id: 'addon-1',
          user_id: 'user-1',
          gb_amount: 5,
          price_cents: 199,
          source: 'stripe',
          source_subscription_id: 'sub_123',
          status: 'active',
          created_at: '2026-03-01T00:00:00Z',
          canceled_at: null,
        },
        {
          id: 'addon-2',
          user_id: 'user-1',
          gb_amount: 25,
          price_cents: 499,
          source: 'stripe',
          source_subscription_id: 'sub_456',
          status: 'active',
          created_at: '2026-03-15T00:00:00Z',
          canceled_at: null,
        },
      ];

      const result = setupActiveAddonsQuery(mockAddons);
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'storage_addons') return result;
        return {};
      });

      const { getAddonStorageGb } = await import('@/lib/storage-quota');
      const total = await getAddonStorageGb('user-1');

      expect(total).toBe(30); // 5 + 25
    });

    it('should return 0 when no active add-ons', async () => {
      const result = setupActiveAddonsQuery([]);
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'storage_addons') return result;
        return {};
      });

      const { getAddonStorageGb } = await import('@/lib/storage-quota');
      const total = await getAddonStorageGb('user-1');

      expect(total).toBe(0);
    });
  });

  describe('incrementStorageUsed', () => {
    it('should call RPC and return true on success', async () => {
      mockSupabase.rpc.mockResolvedValue({ error: null });

      const { incrementStorageUsed } = await import('@/lib/storage-quota');
      const result = await incrementStorageUsed('user-1', 1024);

      expect(result).toBe(true);
      expect(mockSupabase.rpc).toHaveBeenCalledWith('increment_storage_used', {
        p_user_id: 'user-1',
        p_bytes: 1024,
      });
    });

    it('should return false on RPC error', async () => {
      mockSupabase.rpc.mockResolvedValue({ error: { message: 'RPC failed' } });

      const { incrementStorageUsed } = await import('@/lib/storage-quota');
      const result = await incrementStorageUsed('user-1', 1024);

      expect(result).toBe(false);
    });
  });

  describe('decrementStorageUsed', () => {
    it('should call RPC and return true on success', async () => {
      mockSupabase.rpc.mockResolvedValue({ error: null });

      const { decrementStorageUsed } = await import('@/lib/storage-quota');
      const result = await decrementStorageUsed('user-1', 512);

      expect(result).toBe(true);
      expect(mockSupabase.rpc).toHaveBeenCalledWith('decrement_storage_used', {
        p_user_id: 'user-1',
        p_bytes: 512,
      });
    });

    it('should return false on RPC error', async () => {
      mockSupabase.rpc.mockResolvedValue({ error: { message: 'RPC failed' } });

      const { decrementStorageUsed } = await import('@/lib/storage-quota');
      const result = await decrementStorageUsed('user-1', 512);

      expect(result).toBe(false);
    });
  });

  describe('createStorageAddon', () => {
    it('should insert a storage add-on and return the record', async () => {
      const mockData = {
        id: 'new-addon',
        user_id: 'user-1',
        gb_amount: 10,
        price_cents: 299,
        source: 'stripe',
        source_subscription_id: 'sub_test',
        status: 'active',
        created_at: '2026-04-02T00:00:00Z',
        canceled_at: null,
      };

      const result = setupInsertQuery(mockData);
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'storage_addons') return result;
        return {};
      });

      const { createStorageAddon } = await import('@/lib/storage-quota');
      const addon = await createStorageAddon('user-1', 10, 299, 'sub_test');

      expect(addon).toEqual(mockData);
      expect(mockSupabase.from).toHaveBeenCalledWith('storage_addons');
    });

    it('should return null on DB error', async () => {
      const result = setupInsertQuery(null, { message: 'insert failed' });
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'storage_addons') return result;
        return {};
      });

      const { createStorageAddon } = await import('@/lib/storage-quota');
      const addon = await createStorageAddon('user-1', 10, 299, 'sub_test');

      expect(addon).toBeNull();
    });

    it('should use custom source when provided', async () => {
      const mockData = {
        id: 'new-addon',
        user_id: 'user-1',
        gb_amount: 5,
        price_cents: 299,
        source: 'apple_iap',
        source_subscription_id: 'iap_123',
        status: 'active',
        created_at: '2026-04-02T00:00:00Z',
        canceled_at: null,
      };

      const result = setupInsertQuery(mockData);
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'storage_addons') return result;
        return {};
      });

      const { createStorageAddon } = await import('@/lib/storage-quota');
      const addon = await createStorageAddon('user-1', 5, 299, 'iap_123', 'apple_iap');

      expect(addon).toEqual(mockData);
    });
  });

  describe('cancelStorageAddon', () => {
    it('should update status to canceled and return true', async () => {
      const result = setupUpdateQuery(null);
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'storage_addons') return result;
        return {};
      });

      const { cancelStorageAddon } = await import('@/lib/storage-quota');
      const success = await cancelStorageAddon('addon-1');

      expect(success).toBe(true);
      expect(mockSupabase.from).toHaveBeenCalledWith('storage_addons');
    });

    it('should return false on DB error', async () => {
      const result = setupUpdateQuery({ message: 'update failed' });
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'storage_addons') return result;
        return {};
      });

      const { cancelStorageAddon } = await import('@/lib/storage-quota');
      const success = await cancelStorageAddon('addon-1');

      expect(success).toBe(false);
    });
  });
});
