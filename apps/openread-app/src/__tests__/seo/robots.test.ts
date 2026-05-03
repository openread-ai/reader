import { describe, it, expect } from 'vitest';
import robots from '../../app/robots';

describe('robots.ts', () => {
  it('should return a valid robots configuration', () => {
    const result = robots();
    expect(result).toBeDefined();
    expect(result.rules).toBeDefined();
    expect(result.sitemap).toBeDefined();
  });

  it('should allow all user agents to crawl /', () => {
    const result = robots();
    const rules = Array.isArray(result.rules) ? result.rules : [result.rules];
    const wildcardRule = rules.find((r) => r.userAgent === '*');

    expect(wildcardRule).toBeDefined();
    expect(wildcardRule!.allow).toBe('/');
  });

  it('should disallow crawling of /api/ routes', () => {
    const result = robots();
    const rules = Array.isArray(result.rules) ? result.rules : [result.rules];
    const wildcardRule = rules.find((r) => r.userAgent === '*');

    expect(wildcardRule!.disallow).toContain('/api/');
  });

  it('should disallow crawling of /library/ routes', () => {
    const result = robots();
    const rules = Array.isArray(result.rules) ? result.rules : [result.rules];
    const wildcardRule = rules.find((r) => r.userAgent === '*');

    expect(wildcardRule!.disallow).toContain('/library/');
  });

  it('should disallow crawling of /reader/ routes', () => {
    const result = robots();
    const rules = Array.isArray(result.rules) ? result.rules : [result.rules];
    const wildcardRule = rules.find((r) => r.userAgent === '*');

    expect(wildcardRule!.disallow).toContain('/reader/');
  });

  it('should disallow crawling of /settings/ routes', () => {
    const result = robots();
    const rules = Array.isArray(result.rules) ? result.rules : [result.rules];
    const wildcardRule = rules.find((r) => r.userAgent === '*');

    expect(wildcardRule!.disallow).toContain('/settings/');
  });

  it('should reference the sitemap at the correct URL', () => {
    const result = robots();
    expect(result.sitemap).toBe('https://app.openread.ai/sitemap.xml');
  });
});
