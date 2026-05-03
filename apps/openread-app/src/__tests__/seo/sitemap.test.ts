import { describe, it, expect } from 'vitest';
import sitemap from '../../app/sitemap';

describe('sitemap.ts', () => {
  it('should return an array of sitemap entries', () => {
    const result = sitemap();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it('should include the homepage with priority 1', () => {
    const result = sitemap();
    const homepage = result.find((entry) => entry.url === 'https://app.openread.ai');

    expect(homepage).toBeDefined();
    expect(homepage!.priority).toBe(1);
    expect(homepage!.changeFrequency).toBe('weekly');
  });

  it('should include the auth page', () => {
    const result = sitemap();
    const authPage = result.find((entry) => entry.url === 'https://app.openread.ai/auth');

    expect(authPage).toBeDefined();
    expect(authPage!.priority).toBe(0.5);
    expect(authPage!.changeFrequency).toBe('monthly');
  });

  it('should include the privacy page', () => {
    const result = sitemap();
    const privacyPage = result.find((entry) => entry.url === 'https://app.openread.ai/privacy');

    expect(privacyPage).toBeDefined();
    expect(privacyPage!.priority).toBe(0.3);
    expect(privacyPage!.changeFrequency).toBe('monthly');
  });

  it('should include the terms page', () => {
    const result = sitemap();
    const termsPage = result.find((entry) => entry.url === 'https://app.openread.ai/terms');

    expect(termsPage).toBeDefined();
    expect(termsPage!.priority).toBe(0.3);
    expect(termsPage!.changeFrequency).toBe('monthly');
  });

  it('should only include public routes (no authenticated routes)', () => {
    const result = sitemap();
    const urls = result.map((entry) => entry.url);

    // Should not include any authenticated routes
    for (const entryUrl of urls) {
      expect(entryUrl).not.toContain('/library');
      expect(entryUrl).not.toContain('/reader');
      expect(entryUrl).not.toContain('/settings');
      expect(entryUrl).not.toContain('/api');
    }
  });

  it('should have lastModified as a Date on all entries', () => {
    const result = sitemap();

    for (const entry of result) {
      expect(entry.lastModified).toBeInstanceOf(Date);
    }
  });

  it('should have exactly 4 entries', () => {
    const result = sitemap();
    expect(result).toHaveLength(4);
  });
});
