import { describe, it, expect } from 'vitest';
import {
  getRegionalPricing,
  getCountryFromHeaders,
  formatPrice,
  REGIONAL_PRICING,
  DEFAULT_PRICING,
} from '@/lib/pricing';

describe('pricing', () => {
  // -------------------------------------------------------------------
  // getRegionalPricing
  // -------------------------------------------------------------------
  describe('getRegionalPricing', () => {
    it('should return INR pricing for India', () => {
      const pricing = getRegionalPricing('IN');
      expect(pricing.currency).toBe('INR');
      expect(pricing.symbol).toBe('\u20B9');
      expect(pricing.reader).toBe(349);
      expect(pricing.pro).toBe(699);
    });

    it('should return BRL pricing for Brazil', () => {
      const pricing = getRegionalPricing('BR');
      expect(pricing.currency).toBe('BRL');
      expect(pricing.symbol).toBe('R$');
      expect(pricing.reader).toBe(29.99);
      expect(pricing.pro).toBe(59.99);
    });

    it('should return USD default for US', () => {
      const pricing = getRegionalPricing('US');
      expect(pricing.currency).toBe('USD');
      expect(pricing.symbol).toBe('$');
      expect(pricing.reader).toBe(9.99);
      expect(pricing.pro).toBe(19.99);
    });

    it('should return USD default for unknown country code', () => {
      const pricing = getRegionalPricing('ZZ');
      expect(pricing).toEqual(DEFAULT_PRICING);
    });

    it('should return USD default for empty string', () => {
      const pricing = getRegionalPricing('');
      expect(pricing).toEqual(DEFAULT_PRICING);
    });

    it('should be case-insensitive for country codes', () => {
      expect(getRegionalPricing('in')).toEqual(REGIONAL_PRICING['IN']);
      expect(getRegionalPricing('br')).toEqual(REGIONAL_PRICING['BR']);
      expect(getRegionalPricing('In')).toEqual(REGIONAL_PRICING['IN']);
    });

    it('should handle null/undefined country gracefully', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(getRegionalPricing(null as any)).toEqual(DEFAULT_PRICING);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(getRegionalPricing(undefined as any)).toEqual(DEFAULT_PRICING);
    });
  });

  // -------------------------------------------------------------------
  // getCountryFromHeaders
  // -------------------------------------------------------------------
  describe('getCountryFromHeaders', () => {
    it('should extract country from cf-ipcountry header (Cloudflare)', () => {
      const headers = new Headers({ 'cf-ipcountry': 'IN' });
      expect(getCountryFromHeaders(headers)).toBe('IN');
    });

    it('should extract country from x-vercel-ip-country header (Vercel)', () => {
      const headers = new Headers({ 'x-vercel-ip-country': 'BR' });
      expect(getCountryFromHeaders(headers)).toBe('BR');
    });

    it('should prefer cf-ipcountry over x-vercel-ip-country', () => {
      const headers = new Headers({
        'cf-ipcountry': 'IN',
        'x-vercel-ip-country': 'BR',
      });
      expect(getCountryFromHeaders(headers)).toBe('IN');
    });

    it('should default to US when no country headers are present', () => {
      const headers = new Headers();
      expect(getCountryFromHeaders(headers)).toBe('US');
    });

    it('should default to US when headers contain unrelated values only', () => {
      const headers = new Headers({ 'content-type': 'application/json' });
      expect(getCountryFromHeaders(headers)).toBe('US');
    });
  });

  // -------------------------------------------------------------------
  // formatPrice
  // -------------------------------------------------------------------
  describe('formatPrice', () => {
    it('should format USD reader price correctly', () => {
      expect(formatPrice(DEFAULT_PRICING, 'reader')).toBe('$9.99');
    });

    it('should format USD pro price correctly', () => {
      expect(formatPrice(DEFAULT_PRICING, 'pro')).toBe('$19.99');
    });

    it('should format INR reader price correctly', () => {
      const inr = getRegionalPricing('IN');
      expect(formatPrice(inr, 'reader')).toBe('\u20B9349');
    });

    it('should format INR pro price correctly', () => {
      const inr = getRegionalPricing('IN');
      expect(formatPrice(inr, 'pro')).toBe('\u20B9699');
    });

    it('should format BRL reader price correctly', () => {
      const brl = getRegionalPricing('BR');
      expect(formatPrice(brl, 'reader')).toBe('R$29.99');
    });

    it('should format BRL pro price correctly', () => {
      const brl = getRegionalPricing('BR');
      expect(formatPrice(brl, 'pro')).toBe('R$59.99');
    });
  });

  // -------------------------------------------------------------------
  // Config exports
  // -------------------------------------------------------------------
  describe('pricing config', () => {
    it('should export REGIONAL_PRICING with IN and BR entries', () => {
      expect(REGIONAL_PRICING).toHaveProperty('IN');
      expect(REGIONAL_PRICING).toHaveProperty('BR');
    });

    it('should export DEFAULT_PRICING as USD', () => {
      expect(DEFAULT_PRICING.currency).toBe('USD');
    });

    it('should have positive prices for all regional tiers', () => {
      for (const [, pricing] of Object.entries(REGIONAL_PRICING)) {
        expect(pricing.reader).toBeGreaterThan(0);
        expect(pricing.pro).toBeGreaterThan(0);
        expect(pricing.pro).toBeGreaterThan(pricing.reader);
      }
    });

    it('should have positive prices for default tier', () => {
      expect(DEFAULT_PRICING.reader).toBeGreaterThan(0);
      expect(DEFAULT_PRICING.pro).toBeGreaterThan(0);
      expect(DEFAULT_PRICING.pro).toBeGreaterThan(DEFAULT_PRICING.reader);
    });
  });
});
