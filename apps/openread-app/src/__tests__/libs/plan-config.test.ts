import { describe, it, expect, vi, beforeAll } from 'vitest';
import {
  buildPlanCardConfigs,
  formatCentsToPrice,
  formatStorageAddon,
} from '@/libs/payment/plan-config';
import type { PlanCardConfig } from '@/libs/payment/plan-config';
import { getFallbackConfig } from '@/lib/tier-config';
import type { StorageAddon } from '@/lib/tier-config';

// Suppress logger noise
vi.mock('@/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: vi.fn(),
}));

const fallback = getFallbackConfig();
const tiers = fallback.tiers;

describe('buildPlanCardConfigs', () => {
  let configs: PlanCardConfig[];

  beforeAll(() => {
    configs = buildPlanCardConfigs(tiers);
  });

  it('should return exactly 3 configs in order: free, reader, pro', () => {
    expect(configs).toHaveLength(3);
    expect(configs[0]!.plan).toBe('free');
    expect(configs[1]!.plan).toBe('reader');
    expect(configs[2]!.plan).toBe('pro');
  });

  it('should populate display names from tier config', () => {
    expect(configs[0]!.displayName).toBe('Free');
    expect(configs[1]!.displayName).toBe('Reader');
    expect(configs[2]!.displayName).toBe('Pro');
  });

  it('should populate monthly and annual prices from tier config', () => {
    expect(configs[0]!.monthlyPriceCents).toBe(0);
    expect(configs[0]!.annualPriceCents).toBe(0);
    expect(configs[1]!.monthlyPriceCents).toBe(999);
    expect(configs[1]!.annualPriceCents).toBe(9999);
    expect(configs[2]!.monthlyPriceCents).toBe(1999);
    expect(configs[2]!.annualPriceCents).toBe(19999);
  });

  it('should set "Most Popular" badge on Reader only', () => {
    expect(configs[0]!.badge).toBeUndefined();
    expect(configs[1]!.badge).toBe('Most Popular');
    expect(configs[2]!.badge).toBeUndefined();
  });

  it('should set primary CTA style for Reader, ghost for others', () => {
    expect(configs[0]!.ctaStyle).toBe('ghost');
    expect(configs[1]!.ctaStyle).toBe('primary');
    expect(configs[2]!.ctaStyle).toBe('ghost');
  });

  it('should set correct CTA labels', () => {
    expect(configs[0]!.ctaLabel).toBe('Get Started');
    expect(configs[1]!.ctaLabel).toBe('Start Reading');
    expect(configs[2]!.ctaLabel).toBe('Go Pro');
  });

  // Feature groups structure
  describe('Feature Groups', () => {
    it('should have AI Features group for all plans', () => {
      for (const config of configs) {
        const aiGroup = config.featureGroups.find((g) => g.name === 'AI Features');
        expect(aiGroup).toBeTruthy();
        expect(aiGroup!.features.length).toBeGreaterThan(0);
      }
    });

    it('should have Reading group for all plans', () => {
      for (const config of configs) {
        const readingGroup = config.featureGroups.find((g) => g.name === 'Reading');
        expect(readingGroup).toBeTruthy();
        expect(readingGroup!.features.length).toBeGreaterThan(0);
      }
    });

    it('should have Storage group for all plans', () => {
      for (const config of configs) {
        const storageGroup = config.featureGroups.find((g) => g.name === 'Storage');
        expect(storageGroup).toBeTruthy();
      }
    });

    it('should have MCP group for reader and pro but not free', () => {
      const freeConfig = configs[0]!;
      const readerConfig = configs[1]!;
      const proConfig = configs[2]!;

      expect(freeConfig.featureGroups.find((g) => g.name === 'MCP')).toBeUndefined();
      expect(readerConfig.featureGroups.find((g) => g.name === 'MCP')).toBeTruthy();
      expect(proConfig.featureGroups.find((g) => g.name === 'MCP')).toBeTruthy();
    });

    // AI Features details
    it('should show limited usage for free tier', () => {
      const freeAI = configs[0]!.featureGroups.find((g) => g.name === 'AI Features')!;
      expect(freeAI.features.some((f) => f.label === 'Limited AI usage')).toBe(true);
    });

    it('should show generous usage for reader tier', () => {
      const readerAI = configs[1]!.featureGroups.find((g) => g.name === 'AI Features')!;
      expect(readerAI.features.some((f) => f.label === 'Generous AI usage')).toBe(true);
    });

    it('should show extended usage for pro tier', () => {
      const proAI = configs[2]!.featureGroups.find((g) => g.name === 'AI Features')!;
      expect(proAI.features.some((f) => f.label === 'Extended AI usage')).toBe(true);
    });

    it('should show Premium AI models for pro tier', () => {
      const proAI = configs[2]!.featureGroups.find((g) => g.name === 'AI Features')!;
      expect(proAI.features.some((f) => f.label === 'Premium AI models')).toBe(true);
    });

    it('should show Basic AI models for free and Standard for reader', () => {
      const freeAI = configs[0]!.featureGroups.find((g) => g.name === 'AI Features')!;
      const readerAI = configs[1]!.featureGroups.find((g) => g.name === 'AI Features')!;
      expect(freeAI.features.some((f) => f.label === 'Basic AI models')).toBe(true);
      expect(readerAI.features.some((f) => f.label === 'Standard AI models')).toBe(true);
    });

    // Reading details
    it('should show library limit for free tier', () => {
      const freeReading = configs[0]!.featureGroups.find((g) => g.name === 'Reading')!;
      expect(freeReading.features.some((f) => f.label === '10 book library')).toBe(true);
    });

    it('should show unlimited library for paid tiers', () => {
      const readerReading = configs[1]!.featureGroups.find((g) => g.name === 'Reading')!;
      const proReading = configs[2]!.featureGroups.find((g) => g.name === 'Reading')!;
      expect(readerReading.features.some((f) => f.label === 'Unlimited library')).toBe(true);
      expect(proReading.features.some((f) => f.label === 'Unlimited library')).toBe(true);
    });

    it('should show TTS for paid tiers only', () => {
      const freeReading = configs[0]!.featureGroups.find((g) => g.name === 'Reading')!;
      const readerReading = configs[1]!.featureGroups.find((g) => g.name === 'Reading')!;
      expect(freeReading.features.some((f) => f.label === 'AI Read Aloud (TTS)')).toBe(false);
      expect(readerReading.features.some((f) => f.label === 'AI Read Aloud (TTS)')).toBe(true);
    });

    // Storage details
    it('should show no storage for free tier', () => {
      const freeStorage = configs[0]!.featureGroups.find((g) => g.name === 'Storage')!;
      expect(freeStorage.features[0]!.label).toBe('No cloud storage');
      expect(freeStorage.features[0]!.included).toBe(false);
    });

    it('should show base storage for paid tiers', () => {
      const readerStorage = configs[1]!.featureGroups.find((g) => g.name === 'Storage')!;
      const proStorage = configs[2]!.featureGroups.find((g) => g.name === 'Storage')!;
      expect(readerStorage.features[0]!.label).toBe('5 GB base storage');
      expect(proStorage.features[0]!.label).toBe('10 GB base storage');
    });

    // MCP details
    it('should show 60 req/min for reader', () => {
      const readerMCP = configs[1]!.featureGroups.find((g) => g.name === 'MCP')!;
      expect(readerMCP.features[0]!.label).toBe('60 req/min');
    });

    it('should show 120 req/min for pro', () => {
      const proMCP = configs[2]!.featureGroups.find((g) => g.name === 'MCP')!;
      expect(proMCP.features[0]!.label).toBe('120 req/min');
    });
  });
});

describe('formatCentsToPrice', () => {
  it('should format 0 cents as $0.00', () => {
    expect(formatCentsToPrice(0)).toBe('$0.00');
  });

  it('should format 799 cents as $7.99', () => {
    expect(formatCentsToPrice(799)).toBe('$7.99');
  });

  it('should format 1499 cents as $14.99', () => {
    expect(formatCentsToPrice(1499)).toBe('$14.99');
  });

  it('should format 7999 cents as $79.99', () => {
    expect(formatCentsToPrice(7999)).toBe('$79.99');
  });

  it('should format with specified currency', () => {
    // EUR formatting depends on locale
    const result = formatCentsToPrice(799, 'EUR', 'de-DE');
    expect(result).toContain('7,99');
  });
});

describe('formatStorageAddon', () => {
  const addon: StorageAddon = { gb: 5, price_cents: 199, mobile_price_cents: 299 };

  it('should format web price for non-iOS', () => {
    const result = formatStorageAddon(addon, false);
    expect(result.label).toBe('+5 GB');
    expect(result.price).toBe('$1.99/mo');
  });

  it('should format mobile price for iOS', () => {
    const result = formatStorageAddon(addon, true);
    expect(result.label).toBe('+5 GB');
    expect(result.price).toBe('$2.99/mo');
  });

  it('should handle larger addon', () => {
    const largeAddon: StorageAddon = { gb: 50, price_cents: 799, mobile_price_cents: 1099 };
    const result = formatStorageAddon(largeAddon, false);
    expect(result.label).toBe('+50 GB');
    expect(result.price).toBe('$7.99/mo');
  });
});
