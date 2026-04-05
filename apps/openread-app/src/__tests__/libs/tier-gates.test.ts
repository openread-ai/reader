import { describe, it, expect, vi } from 'vitest';

// Mock tier-config's transitive dependencies (supabase, logger)
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

import {
  getTierGates,
  checkFeatureGate,
  formatPriceDisplay,
  type GatedFeature,
} from '@/lib/tier-gates';
import type { UserPlan } from '@/types/quota';

describe('tier-gates', () => {
  // ─── getTierGates ──────────────────────────────────────────────────

  describe('getTierGates', () => {
    it('should return correct free tier gates', () => {
      const gates = getTierGates('free');
      expect(gates.can_tts).toBe(false);
      expect(gates.can_sync).toBe(false);
      expect(gates.can_translate).toBe(false);
      expect(gates.can_byok).toBe(false);
      expect(gates.can_boost).toBe(false);
    });

    it('should return correct reader tier gates', () => {
      const gates = getTierGates('reader');
      expect(gates.can_tts).toBe(true);
      expect(gates.can_sync).toBe(true);
      expect(gates.can_translate).toBe(false);
      expect(gates.can_byok).toBe(true);
      expect(gates.can_boost).toBe(true);
    });

    it('should return correct pro tier gates', () => {
      const gates = getTierGates('pro');
      expect(gates.can_tts).toBe(true);
      expect(gates.can_sync).toBe(true);
      expect(gates.can_translate).toBe(true);
      expect(gates.can_byok).toBe(true);
      expect(gates.can_boost).toBe(true);
    });

    it('should fall back to free for unknown plan', () => {
      const gates = getTierGates('unknown' as UserPlan);
      expect(gates).toEqual(getTierGates('free'));
    });
  });

  // ─── checkFeatureGate ─────────────────────────────────────────────

  describe('checkFeatureGate', () => {
    describe('TTS gate', () => {
      it('free: not allowed, requires reader', () => {
        const result = checkFeatureGate('tts', 'free');
        expect(result.allowed).toBe(false);
        expect(result.requiredTier).toBe('reader');
        expect(result.requiredTierName).toBe('Reader');
        expect(result.message).toContain('Text-to-Speech');
        expect(result.message).toContain('Reader');
      });

      it('reader: allowed', () => {
        const result = checkFeatureGate('tts', 'reader');
        expect(result.allowed).toBe(true);
        expect(result.message).toBe('');
      });

      it('pro: allowed', () => {
        const result = checkFeatureGate('tts', 'pro');
        expect(result.allowed).toBe(true);
        expect(result.message).toBe('');
      });
    });

    describe('sync gate', () => {
      it('free: not allowed, requires reader', () => {
        const result = checkFeatureGate('sync', 'free');
        expect(result.allowed).toBe(false);
        expect(result.requiredTier).toBe('reader');
        expect(result.message).toContain('Cloud Sync');
      });

      it('reader: allowed', () => {
        const result = checkFeatureGate('sync', 'reader');
        expect(result.allowed).toBe(true);
      });

      it('pro: allowed', () => {
        const result = checkFeatureGate('sync', 'pro');
        expect(result.allowed).toBe(true);
      });
    });

    describe('translate gate', () => {
      it('free: not allowed, requires pro', () => {
        const result = checkFeatureGate('translate', 'free');
        expect(result.allowed).toBe(false);
        expect(result.requiredTier).toBe('pro');
        expect(result.requiredTierName).toBe('Pro');
        expect(result.message).toContain('Translation');
        expect(result.message).toContain('Pro');
      });

      it('reader: not allowed, requires pro', () => {
        const result = checkFeatureGate('translate', 'reader');
        expect(result.allowed).toBe(false);
        expect(result.requiredTier).toBe('pro');
      });

      it('pro: allowed', () => {
        const result = checkFeatureGate('translate', 'pro');
        expect(result.allowed).toBe(true);
        expect(result.message).toBe('');
      });
    });

    describe('BYOK gate', () => {
      it('free: not allowed, requires reader', () => {
        const result = checkFeatureGate('byok', 'free');
        expect(result.allowed).toBe(false);
        expect(result.requiredTier).toBe('reader');
        expect(result.message).toContain('Bring Your Own Key');
      });

      it('reader: allowed', () => {
        const result = checkFeatureGate('byok', 'reader');
        expect(result.allowed).toBe(true);
      });

      it('pro: allowed', () => {
        const result = checkFeatureGate('byok', 'pro');
        expect(result.allowed).toBe(true);
      });
    });

    describe('boost gate', () => {
      it('free: not allowed, requires reader', () => {
        const result = checkFeatureGate('boost', 'free');
        expect(result.allowed).toBe(false);
        expect(result.requiredTier).toBe('reader');
      });

      it('reader: allowed', () => {
        const result = checkFeatureGate('boost', 'reader');
        expect(result.allowed).toBe(true);
      });

      it('pro: allowed', () => {
        const result = checkFeatureGate('boost', 'pro');
        expect(result.allowed).toBe(true);
      });
    });

    describe('all features x all plans matrix', () => {
      const features: GatedFeature[] = ['tts', 'sync', 'translate', 'byok', 'boost'];
      const plans: UserPlan[] = ['free', 'reader', 'pro'];

      // Expected: feature -> [free, reader, pro]
      const expected: Record<GatedFeature, [boolean, boolean, boolean]> = {
        tts: [false, true, true],
        sync: [false, true, true],
        translate: [false, false, true],
        byok: [false, true, true],
        boost: [false, true, true],
      };

      for (const feature of features) {
        for (let i = 0; i < plans.length; i++) {
          const plan = plans[i]!;
          const expectedAllowed = expected[feature][i];

          it(`${feature} x ${plan} = ${expectedAllowed ? 'allowed' : 'gated'}`, () => {
            const result = checkFeatureGate(feature, plan);
            expect(result.allowed).toBe(expectedAllowed);
          });
        }
      }
    });

    // ─── S4.2: Price display in gate results ──────────────────────────

    describe('price display (S4.2)', () => {
      it('free user TTS gate shows Reader price ($9.99/mo)', () => {
        const result = checkFeatureGate('tts', 'free');
        expect(result.priceDisplay).toBe('$9.99/mo');
        expect(result.ctaText).toContain('Reader');
        expect(result.ctaText).toContain('$9.99/mo');
      });

      it('free user sync gate shows Reader price', () => {
        const result = checkFeatureGate('sync', 'free');
        expect(result.priceDisplay).toBe('$9.99/mo');
        expect(result.ctaText).toContain('Reader');
      });

      it('free user translate gate shows Pro price ($19.99/mo)', () => {
        const result = checkFeatureGate('translate', 'free');
        expect(result.priceDisplay).toBe('$19.99/mo');
        expect(result.ctaText).toContain('Pro');
        expect(result.ctaText).toContain('$19.99/mo');
      });

      it('free user BYOK gate shows Reader price', () => {
        const result = checkFeatureGate('byok', 'free');
        expect(result.priceDisplay).toBe('$9.99/mo');
        expect(result.ctaText).toContain('Reader');
      });

      it('reader user translate gate shows Pro price', () => {
        const result = checkFeatureGate('translate', 'reader');
        expect(result.priceDisplay).toBe('$19.99/mo');
        expect(result.ctaText).toContain('Pro');
      });

      it('allowed features have empty price/cta', () => {
        const result = checkFeatureGate('tts', 'reader');
        expect(result.allowed).toBe(true);
        // priceDisplay still shows the required tier price (for reference)
        expect(result.priceDisplay).toBe('$9.99/mo');
        // ctaText is empty when feature is allowed
        expect(result.ctaText).toBe('');
      });

      it('pro user sees empty ctaText for all features', () => {
        const features: GatedFeature[] = ['tts', 'sync', 'translate', 'byok', 'boost'];
        for (const feature of features) {
          const result = checkFeatureGate(feature, 'pro');
          expect(result.ctaText).toBe('');
        }
      });
    });
  });

  // ─── formatPriceDisplay ─────────────────────────────────────────────

  describe('formatPriceDisplay', () => {
    it('should format 999 cents as $9.99/mo', () => {
      expect(formatPriceDisplay(999)).toBe('$9.99/mo');
    });

    it('should format 1999 cents as $19.99/mo', () => {
      expect(formatPriceDisplay(1999)).toBe('$19.99/mo');
    });

    it('should return empty string for 0 cents', () => {
      expect(formatPriceDisplay(0)).toBe('');
    });

    it('should return empty string for negative cents', () => {
      expect(formatPriceDisplay(-100)).toBe('');
    });

    it('should format 100 cents as $1.00/mo', () => {
      expect(formatPriceDisplay(100)).toBe('$1.00/mo');
    });
  });
});
