import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock Supabase ────────────────────────────────────────────────────

const mockSingle = vi.fn();
const mockLimit = vi.fn(() => ({ single: mockSingle }));
const mockOrder = vi.fn(() => ({ limit: mockLimit }));
const mockSelect = vi.fn(() => ({ order: mockOrder }));
const mockFrom = vi.fn(() => ({ select: mockSelect }));

vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: vi.fn(() => ({ from: mockFrom })),
}));

// ─── Mock logger (suppress console noise in tests) ──────────────────

vi.mock('@/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// ─── Import SUT after mocks ─────────────────────────────────────────

import {
  getTierConfig,
  getTierDefinition,
  getRegionalPricing,
  invalidateTierConfigCache,
  getFallbackConfig,
  type TierConfig,
} from '@/lib/tier-config';

// ─── Helpers ─────────────────────────────────────────────────────────

const MOCK_DB_CONFIG: TierConfig = {
  ...getFallbackConfig(),
  // Tweak one value so we can distinguish DB config from fallback
  ai_budget_ceiling: 99999,
};

function setupDbSuccess(config: TierConfig = MOCK_DB_CONFIG) {
  mockSingle.mockResolvedValue({ data: { config }, error: null });
}

function setupDbFailure(message = 'connection refused') {
  mockSingle.mockResolvedValue({ data: null, error: { message } });
}

function setupDbException(err: Error = new Error('network timeout')) {
  mockSingle.mockRejectedValue(err);
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('tier-config', () => {
  beforeEach(() => {
    invalidateTierConfigCache();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------
  // getTierConfig
  // -------------------------------------------------------------------
  describe('getTierConfig', () => {
    it('should return fallback when Supabase query fails', async () => {
      setupDbFailure();
      const config = await getTierConfig();
      expect(config).toEqual(getFallbackConfig());
    });

    it('should return DB config when Supabase query succeeds', async () => {
      setupDbSuccess();
      const config = await getTierConfig();
      expect(config.ai_budget_ceiling).toBe(99999);
      expect(config).toEqual(MOCK_DB_CONFIG);
    });

    it('should cache — second call within 5min does not query DB again', async () => {
      setupDbSuccess();
      const first = await getTierConfig();
      const second = await getTierConfig();

      expect(first).toBe(second); // same reference
      // createSupabaseAdminClient -> from should only be called once
      expect(mockFrom).toHaveBeenCalledTimes(1);
    });

    it('should return fallback when Supabase throws an exception', async () => {
      setupDbException();
      const config = await getTierConfig();
      expect(config).toEqual(getFallbackConfig());
    });

    it('should return fallback when data.config is null', async () => {
      mockSingle.mockResolvedValue({ data: { config: null }, error: null });
      const config = await getTierConfig();
      expect(config).toEqual(getFallbackConfig());
    });
  });

  // -------------------------------------------------------------------
  // getTierDefinition
  // -------------------------------------------------------------------
  describe('getTierDefinition', () => {
    beforeEach(() => {
      setupDbSuccess(getFallbackConfig());
    });

    it('should return correct free tier definition', async () => {
      const tier = await getTierDefinition('free');
      expect(tier.display_name).toBe('Free');
      expect(tier.ai_messages_per_window).toBe(10);
      expect(tier.ai_window_hours).toBe(24);
      expect(tier.ai_rate_limit).toBe(2);
      expect(tier.ai_rate_window_hours).toBe(2);
      expect(tier.ai_fallback_model).toBeNull();
      expect(tier.storage_gb).toBe(0);
      expect(tier.can_tts).toBe(false);
      expect(tier.can_byok).toBe(false);
      expect(tier.library_limit).toBe(10);
      expect(tier.ai_model_tier).toBe('basic');
    });

    it('should return correct reader tier definition', async () => {
      const tier = await getTierDefinition('reader');
      expect(tier.display_name).toBe('Reader');
      expect(tier.ai_messages_per_window).toBe(50);
      expect(tier.ai_window_hours).toBe(3);
      expect(tier.ai_fallback_model).toBe('openai/gpt-oss-20b');
      expect(tier.storage_gb).toBe(5);
      expect(tier.can_tts).toBe(true);
      expect(tier.can_sync).toBe(true);
      expect(tier.can_byok).toBe(true);
      expect(tier.display_price_cents).toBe(999);
    });

    it('should return correct pro tier definition', async () => {
      const tier = await getTierDefinition('pro');
      expect(tier.display_name).toBe('Pro');
      expect(tier.ai_messages_per_window).toBe(100);
      expect(tier.ai_window_hours).toBe(3);
      expect(tier.ai_fallback_model).toBe('openai/gpt-oss-120b');
      expect(tier.storage_gb).toBe(10);
      expect(tier.can_translate).toBe(true);
      expect(tier.early_access).toBe(true);
      expect(tier.ai_model_tier).toBe('premium');
      expect(tier.display_price_cents).toBe(1999);
    });

    it('should fall back to free tier for unknown plan', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tier = await getTierDefinition('unknown' as any);
      expect(tier.display_name).toBe('Free');
      expect(tier.ai_messages_per_window).toBe(10);
    });
  });

  // -------------------------------------------------------------------
  // getRegionalPricing
  // -------------------------------------------------------------------
  describe('getRegionalPricing', () => {
    beforeEach(() => {
      setupDbSuccess(getFallbackConfig());
    });

    it('should return Indian pricing for country code IN', async () => {
      const pricing = await getRegionalPricing('IN');
      expect(pricing.currency).toBe('INR');
      expect(pricing.symbol).toBe('\u20B9');
      expect(pricing.reader).toBe(349);
      expect(pricing.pro).toBe(699);
    });

    it('should return Brazilian pricing for country code BR', async () => {
      const pricing = await getRegionalPricing('BR');
      expect(pricing.currency).toBe('BRL');
      expect(pricing.symbol).toBe('R$');
      expect(pricing.reader).toBe(29.99);
      expect(pricing.pro).toBe(59.99);
    });

    it('should return USD default for unknown country code', async () => {
      const pricing = await getRegionalPricing('XX');
      expect(pricing.currency).toBe('USD');
      expect(pricing.symbol).toBe('$');
      // Derived from display_price_cents: reader=999 -> 9.99, pro=1999 -> 19.99
      expect(pricing.reader).toBe(9.99);
      expect(pricing.pro).toBe(19.99);
    });

    it('should be case-insensitive for country codes', async () => {
      const pricing = await getRegionalPricing('in');
      expect(pricing.currency).toBe('INR');
    });
  });

  // -------------------------------------------------------------------
  // invalidateTierConfigCache
  // -------------------------------------------------------------------
  describe('invalidateTierConfigCache', () => {
    it('should clear cache so next call queries DB again', async () => {
      setupDbSuccess();
      await getTierConfig(); // fills cache
      expect(mockFrom).toHaveBeenCalledTimes(1);

      invalidateTierConfigCache();
      await getTierConfig(); // should query again
      expect(mockFrom).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------
  // getFallbackConfig
  // -------------------------------------------------------------------
  describe('getFallbackConfig', () => {
    it('should return the hardcoded fallback config', () => {
      const config = getFallbackConfig();
      expect(config.tiers).toHaveProperty('free');
      expect(config.tiers).toHaveProperty('reader');
      expect(config.tiers).toHaveProperty('pro');
      expect(config.ai_budget_ceiling).toBe(12000);
      expect(config.max_agent_steps).toBe(12);
      expect(config.storage_addons).toHaveLength(4);
      expect(config.boosts).toHaveLength(3);
      expect(config.regional_pricing).toHaveProperty('IN');
      expect(config.regional_pricing).toHaveProperty('BR');
    });

    it('should have consistent cost rates', () => {
      const config = getFallbackConfig();
      expect(config.cost_rates.ai_per_message.free).toBe(0.001);
      expect(config.cost_rates.ai_per_message.reader).toBe(0.002);
      expect(config.cost_rates.ai_per_message.pro).toBe(0.004);
      expect(config.cost_rates.storage_per_gb_month).toBe(0.000015);
      expect(config.cost_rates.infra_fixed_month).toBe(30);
      expect(config.cost_rates.payment_processing_rate).toBe(0.1);
    });
  });
});
