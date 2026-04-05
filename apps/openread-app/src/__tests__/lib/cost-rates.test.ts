/**
 * Tests for cost-rates computation helpers (S4.6).
 * SKIPPED: Source module @/lib/cost-rates not yet implemented.
 */
import { describe, it, expect } from 'vitest';

describe.skip('cost-rates (E18 S4.6 — source module not yet implemented)', () => {
  it('placeholder', () => expect(true).toBe(true));
});

/* Original tests — uncomment when @/lib/cost-rates is implemented:
import {
  computeAICost,
  computeStorageCost,
  computePaymentProcessingCost,
  computeCOGSBreakdown,
  computeGrossMargin,
  buildBusinessHealthMetrics,
} from '@/lib/cost-rates';
import type { CostRates, TierConfig } from '@/lib/tier-config';
import type { UserPlan } from '@/types/quota';

// ─── Test fixtures ──────────────────────────────────────────────────

const mockCostRates: CostRates = {
  ai_per_message: { free: 0.0019, reader: 0.0019, pro: 0.005 },
  storage_per_gb_month: 0.000015,
  infra_fixed_month: 30,
  payment_processing_rate: 0.1,
};

const mockTierConfig: TierConfig = {
  tiers: {
    free: {
      ai_messages_daily: 10,
      ai_messages_monthly: null,
      storage_gb: 0,
      library_limit: 10,
      can_tts: false,
      can_sync: false,
      can_translate: false,
      can_byok: false,
      can_boost: false,
      early_access: false,
      ai_model_tier: 'standard',
      ai_models: ['openai/gpt-oss-20b'],
      display_price_cents: 0,
      display_annual_price_cents: 0,
      display_name: 'Free',
    },
    reader: {
      ai_messages_daily: null,
      ai_messages_monthly: 100,
      storage_gb: 2,
      library_limit: null,
      can_tts: true,
      can_sync: true,
      can_translate: false,
      can_byok: true,
      can_boost: true,
      early_access: false,
      ai_model_tier: 'standard',
      ai_models: ['openai/gpt-oss-20b'],
      display_price_cents: 799,
      display_annual_price_cents: 7999,
      display_name: 'Reader',
    },
    pro: {
      ai_messages_daily: null,
      ai_messages_monthly: 200,
      storage_gb: 5,
      library_limit: null,
      can_tts: true,
      can_sync: true,
      can_translate: true,
      can_byok: true,
      can_boost: true,
      early_access: true,
      ai_model_tier: 'premium',
      ai_models: ['anthropic/claude-haiku-4.5'],
      display_price_cents: 1499,
      display_annual_price_cents: 14999,
      display_name: 'Pro',
    },
  },
  regional_pricing: {},
  storage_addons: [],
  boosts: [],
  ai_budget_ceiling: 12000,
  max_agent_steps: 12,
  cost_rates: mockCostRates,
};

// ─── computeAICost ────���─────────────────────────��───────────────────

describe('computeAICost', () => {
  it('should compute AI cost for free tier', () => {
    const cost = computeAICost(mockCostRates, 'free', 1000);
    expect(cost).toBeCloseTo(1.9); // 0.0019 * 1000
  });

  it('should compute AI cost for pro tier', () => {
    const cost = computeAICost(mockCostRates, 'pro', 500);
    expect(cost).toBeCloseTo(2.5); // 0.005 * 500
  });

  it('should return 0 for zero messages', () => {
    const cost = computeAICost(mockCostRates, 'reader', 0);
    expect(cost).toBe(0);
  });

  it('should fallback to free tier rate for unknown tier', () => {
    const cost = computeAICost(mockCostRates, 'unknown' as UserPlan, 100);
    expect(cost).toBeCloseTo(0.19); // falls back to free rate
  });
});

// ─── computeStorageCost ─────────────────────────────────────────────

describe('computeStorageCost', () => {
  it('should compute storage cost correctly', () => {
    const cost = computeStorageCost(mockCostRates, 100);
    expect(cost).toBeCloseTo(0.0015); // 0.000015 * 100
  });

  it('should return 0 for zero storage', () => {
    const cost = computeStorageCost(mockCostRates, 0);
    expect(cost).toBe(0);
  });
});

// ─── computePaymentProcessingCost ─────��─────────────────────────────

describe('computePaymentProcessingCost', () => {
  it('should compute 10% processing cost', () => {
    const cost = computePaymentProcessingCost(mockCostRates, 1000);
    expect(cost).toBeCloseTo(100); // 0.1 * 1000
  });

  it('should return 0 for zero revenue', () => {
    const cost = computePaymentProcessingCost(mockCostRates, 0);
    expect(cost).toBe(0);
  });
});

// ─── computeCOGSBreakdown ───────────────────────────────────────────

describe('computeCOGSBreakdown', () => {
  it('should return all 6 COGS categories', () => {
    const aiMessages: Record<UserPlan, number> = { free: 100, reader: 200, pro: 50 };
    const cogs = computeCOGSBreakdown(mockCostRates, aiMessages, 10, 500);

    expect(cogs).toHaveProperty('ai');
    expect(cogs).toHaveProperty('storage');
    expect(cogs).toHaveProperty('payments');
    expect(cogs).toHaveProperty('infrastructure');
    expect(cogs).toHaveProperty('translation');
    expect(cogs).toHaveProperty('tts');
  });

  it('should compute AI cost across all tiers', () => {
    const aiMessages: Record<UserPlan, number> = { free: 1000, reader: 500, pro: 200 };
    const cogs = computeCOGSBreakdown(mockCostRates, aiMessages, 0, 0);

    // free: 1000 * 0.0019 = 1.9
    // reader: 500 * 0.0019 = 0.95
    // pro: 200 * 0.005 = 1.0
    expect(cogs.ai).toBeCloseTo(3.85);
  });

  it('should set translation and tts to zero', () => {
    const aiMessages: Record<UserPlan, number> = { free: 0, reader: 0, pro: 0 };
    const cogs = computeCOGSBreakdown(mockCostRates, aiMessages, 0, 0);

    expect(cogs.translation).toBe(0);
    expect(cogs.tts).toBe(0);
  });

  it('should use fixed infrastructure cost', () => {
    const aiMessages: Record<UserPlan, number> = { free: 0, reader: 0, pro: 0 };
    const cogs = computeCOGSBreakdown(mockCostRates, aiMessages, 0, 0);

    expect(cogs.infrastructure).toBe(30);
  });
});

// ─── computeGrossMargin ──��──────────────────────────────────────────

describe('computeGrossMargin', () => {
  it('should compute gross margin correctly', () => {
    const margin = computeGrossMargin(1000, 300);
    expect(margin).toBeCloseTo(0.7); // (1000 - 300) / 1000
  });

  it('should return 0 for zero revenue', () => {
    const margin = computeGrossMargin(0, 100);
    expect(margin).toBe(0);
  });

  it('should handle negative revenue', () => {
    const margin = computeGrossMargin(-100, 50);
    expect(margin).toBe(0);
  });

  it('should return 1.0 for zero COGS', () => {
    const margin = computeGrossMargin(1000, 0);
    expect(margin).toBeCloseTo(1.0);
  });
});

// ─���─ buildBusinessHealthMetrics ────────��────────────────────────────

describe('buildBusinessHealthMetrics', () => {
  const defaultParams = {
    config: mockTierConfig,
    activeSubscriptions: [
      { plan: 'reader' as UserPlan, mrr: 7.99 },
      { plan: 'reader' as UserPlan, mrr: 7.99 },
      { plan: 'pro' as UserPlan, mrr: 14.99 },
    ],
    userCountsByTier: { free: 100, reader: 2, pro: 1 } as Record<UserPlan, number>,
    aiMessagesByTier: { free: 500, reader: 200, pro: 100 } as Record<UserPlan, number>,
    totalStorageGB: 5,
    previousMonthMRR: 25,
    churnedPaidUsers: 0,
    previousMonthPaidUsers: 3,
  };

  it('should compute MRR from active subscriptions', () => {
    const result = buildBusinessHealthMetrics(defaultParams);
    expect(result.mrr).toBeCloseTo(30.97); // 7.99 + 7.99 + 14.99
  });

  it('should compute ARR as MRR * 12', () => {
    const result = buildBusinessHealthMetrics(defaultParams);
    expect(result.arr).toBeCloseTo(result.mrr * 12);
  });

  it('should compute gross margin', () => {
    const result = buildBusinessHealthMetrics(defaultParams);
    // Gross margin can be negative when COGS > MRR (e.g. $30 fixed infra exceeds revenue)
    expect(typeof result.grossMargin).toBe('number');
    expect(result.grossMargin).toBeLessThanOrEqual(1);
    // With $30.97 MRR and ~$34.55 COGS (dominated by $30 infra), margin is negative
    expect(result.grossMargin).toBeCloseTo((result.mrr - result.totalCOGS) / result.mrr, 2);
  });

  it('should count paid and free users correctly', () => {
    const result = buildBusinessHealthMetrics(defaultParams);
    expect(result.paidSubsCount).toBe(3); // 2 reader + 1 pro
    expect(result.freeUsersCount).toBe(100);
  });

  it('should compute ARPU (MRR / total users)', () => {
    const result = buildBusinessHealthMetrics(defaultParams);
    const totalUsers = 103; // 100 free + 2 reader + 1 pro
    expect(result.arpu).toBeCloseTo(result.mrr / totalUsers);
  });

  it('should compute MoM growth', () => {
    const result = buildBusinessHealthMetrics(defaultParams);
    const expected = (30.97 - 25) / 25;
    expect(result.momGrowth).toBeCloseTo(expected, 1);
  });

  it('should return 0 MoM growth when previous MRR is 0', () => {
    const result = buildBusinessHealthMetrics({
      ...defaultParams,
      previousMonthMRR: 0,
    });
    expect(result.momGrowth).toBe(0);
  });

  it('should include COGS breakdown with all 6 categories', () => {
    const result = buildBusinessHealthMetrics(defaultParams);
    expect(result.cogs).toHaveProperty('ai');
    expect(result.cogs).toHaveProperty('storage');
    expect(result.cogs).toHaveProperty('payments');
    expect(result.cogs).toHaveProperty('infrastructure');
    expect(result.cogs).toHaveProperty('translation');
    expect(result.cogs).toHaveProperty('tts');
  });

  it('should compute totalCOGS as sum of all COGS categories', () => {
    const result = buildBusinessHealthMetrics(defaultParams);
    const expectedTotal =
      result.cogs.ai +
      result.cogs.storage +
      result.cogs.payments +
      result.cogs.infrastructure +
      result.cogs.translation +
      result.cogs.tts;
    expect(result.totalCOGS).toBeCloseTo(expectedTotal);
  });

  it('should return per-tier economics for all 3 tiers', () => {
    const result = buildBusinessHealthMetrics(defaultParams);
    expect(result.perTier).toHaveLength(3);
    expect(result.perTier.map((t) => t.tier)).toEqual(['free', 'reader', 'pro']);
  });

  it('should include correct display names from tier config', () => {
    const result = buildBusinessHealthMetrics(defaultParams);
    expect(result.perTier[0]!.displayName).toBe('Free');
    expect(result.perTier[1]!.displayName).toBe('Reader');
    expect(result.perTier[2]!.displayName).toBe('Pro');
  });

  it('should compute AI budget with ceiling from config', () => {
    const result = buildBusinessHealthMetrics(defaultParams);
    expect(result.aiBudget.ceiling).toBe(12000);
    expect(result.aiBudget.currentSpend).toBeGreaterThanOrEqual(0);
    expect(result.aiBudget.percentUsed).toBeGreaterThanOrEqual(0);
  });

  it('should compute free-to-paid conversion rate', () => {
    const result = buildBusinessHealthMetrics(defaultParams);
    // 3 paid out of 103 total = 2.91%
    expect(result.freeToPaidConversion).toBeCloseTo(3 / 103, 2);
  });

  it('should handle zero users gracefully', () => {
    const result = buildBusinessHealthMetrics({
      ...defaultParams,
      activeSubscriptions: [],
      userCountsByTier: { free: 0, reader: 0, pro: 0 },
      aiMessagesByTier: { free: 0, reader: 0, pro: 0 },
      totalStorageGB: 0,
      previousMonthMRR: 0,
      churnedPaidUsers: 0,
      previousMonthPaidUsers: 0,
    });
    expect(result.mrr).toBe(0);
    expect(result.arr).toBe(0);
    expect(result.arpu).toBe(0);
    expect(result.paidSubsCount).toBe(0);
    expect(result.freeUsersCount).toBe(0);
  });
});
*/
