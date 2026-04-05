import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Tests that the middleware integrates Upstash rate limiting correctly:
 *   - 429 when rate limited
 *   - Rate-limit headers on successful responses
 *   - Graceful degradation when Upstash is not configured
 *   - OPTIONS (preflight) requests bypass rate limiting
 *   - CORS headers still present on rate-limited responses
 */

// --- Mocks for rate-limit module ---
const mockLimitFn = vi.fn();

vi.mock('@/lib/rate-limit', () => ({
  getRateLimiter: vi.fn(),
  getIdentifier: vi.fn().mockResolvedValue('test-user'),
}));

import type { Ratelimit } from '@upstash/ratelimit';
import { getRateLimiter, getIdentifier } from '@/lib/rate-limit';
const mockedGetRateLimiter = vi.mocked(getRateLimiter);
const mockedGetIdentifier = vi.mocked(getIdentifier);

// We need to import middleware AFTER the mocks are set up
import { middleware } from '../../middleware';

/** Build a mock that satisfies the Ratelimit interface for our test needs. */
function mockLimiter(): Ratelimit {
  return { limit: mockLimitFn } as unknown as Ratelimit;
}

describe('Middleware - Rate Limiting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeRequest(
    path: string,
    options?: { method?: string; origin?: string; authorization?: string; forwardedFor?: string },
  ) {
    const headers: Record<string, string> = {};
    if (options?.origin) headers['origin'] = options.origin;
    if (options?.authorization) headers['authorization'] = options.authorization;
    if (options?.forwardedFor) headers['x-forwarded-for'] = options.forwardedFor;

    return new NextRequest(`http://localhost:3000${path}`, {
      method: options?.method ?? 'GET',
      headers,
    });
  }

  // -------------------------------------------------------------------
  // Graceful degradation
  // -------------------------------------------------------------------
  describe('graceful degradation', () => {
    it('should pass through when getRateLimiter returns null', async () => {
      mockedGetRateLimiter.mockReturnValue(null);

      const request = makeRequest('/api/ai/chat', { origin: 'http://localhost:3000' });
      const response = await middleware(request);

      expect(response.status).toBe(200);
      expect(response.headers.get('X-RateLimit-Limit')).toBeNull();
      expect(response.headers.get('Access-Control-Allow-Methods')).toBe(
        'GET, POST, PUT, DELETE, OPTIONS',
      );
    });

    it('should still set CORS headers when rate limiting is unavailable', async () => {
      mockedGetRateLimiter.mockReturnValue(null);

      const request = makeRequest('/api/test', { origin: 'https://app.openread.ai' });
      const response = await middleware(request);

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app.openread.ai');
    });
  });

  // -------------------------------------------------------------------
  // Rate-limited (429)
  // -------------------------------------------------------------------
  describe('rate-limited responses (429)', () => {
    beforeEach(() => {
      mockLimitFn.mockResolvedValue({
        success: false,
        limit: 60,
        remaining: 0,
        reset: Date.now() + 30_000,
      });
      mockedGetRateLimiter.mockReturnValue(mockLimiter());
    });

    it('should return 429 when rate limit is exceeded', async () => {
      const request = makeRequest('/api/ai/chat');
      const response = await middleware(request);

      expect(response.status).toBe(429);
    });

    it('should return JSON error body on 429', async () => {
      const request = makeRequest('/api/ai/chat');
      const response = await middleware(request);
      const body = await response.json();

      expect(body).toEqual({ error: 'Rate limit exceeded' });
    });

    it('should include X-RateLimit-Limit header on 429', async () => {
      const request = makeRequest('/api/ai/chat');
      const response = await middleware(request);

      expect(response.headers.get('X-RateLimit-Limit')).toBe('60');
    });

    it('should include X-RateLimit-Remaining header on 429', async () => {
      const request = makeRequest('/api/ai/chat');
      const response = await middleware(request);

      expect(response.headers.get('X-RateLimit-Remaining')).toBe('0');
    });

    it('should include X-RateLimit-Reset header on 429', async () => {
      const request = makeRequest('/api/ai/chat');
      const response = await middleware(request);

      expect(response.headers.get('X-RateLimit-Reset')).toBeTruthy();
    });

    it('should include Retry-After header on 429', async () => {
      const request = makeRequest('/api/ai/chat');
      const response = await middleware(request);

      const retryAfter = Number(response.headers.get('Retry-After'));
      expect(retryAfter).toBeGreaterThan(0);
    });

    it('should include Content-Type application/json on 429', async () => {
      const request = makeRequest('/api/ai/chat');
      const response = await middleware(request);

      expect(response.headers.get('Content-Type')).toBe('application/json');
    });

    it('should include CORS origin on 429 for allowed origins', async () => {
      const request = makeRequest('/api/ai/chat', { origin: 'http://localhost:3000' });
      const response = await middleware(request);

      expect(response.status).toBe(429);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3000');
    });

    it('should not include CORS origin on 429 for disallowed origins', async () => {
      const request = makeRequest('/api/ai/chat', { origin: 'https://evil.com' });
      const response = await middleware(request);

      expect(response.status).toBe(429);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    });
  });

  // -------------------------------------------------------------------
  // Successful responses with rate-limit headers
  // -------------------------------------------------------------------
  describe('successful responses with rate-limit headers', () => {
    beforeEach(() => {
      mockLimitFn.mockResolvedValue({
        success: true,
        limit: 60,
        remaining: 42,
        reset: Date.now() + 60_000,
      });
      mockedGetRateLimiter.mockReturnValue(mockLimiter());
    });

    it('should return 200 when within rate limit', async () => {
      const request = makeRequest('/api/ai/chat');
      const response = await middleware(request);

      expect(response.status).toBe(200);
    });

    it('should include X-RateLimit-Limit on successful responses', async () => {
      const request = makeRequest('/api/ai/chat');
      const response = await middleware(request);

      expect(response.headers.get('X-RateLimit-Limit')).toBe('60');
    });

    it('should include X-RateLimit-Remaining on successful responses', async () => {
      const request = makeRequest('/api/ai/chat');
      const response = await middleware(request);

      expect(response.headers.get('X-RateLimit-Remaining')).toBe('42');
    });

    it('should include X-RateLimit-Reset on successful responses', async () => {
      const request = makeRequest('/api/ai/chat');
      const response = await middleware(request);

      expect(response.headers.get('X-RateLimit-Reset')).toBeTruthy();
    });

    it('should still include CORS headers on successful rate-limited responses', async () => {
      const request = makeRequest('/api/ai/chat', { origin: 'https://app.openread.ai' });
      const response = await middleware(request);

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app.openread.ai');
      expect(response.headers.get('Access-Control-Allow-Methods')).toBe(
        'GET, POST, PUT, DELETE, OPTIONS',
      );
    });
  });

  // -------------------------------------------------------------------
  // OPTIONS requests
  // -------------------------------------------------------------------
  describe('OPTIONS preflight', () => {
    it('should not invoke rate limiter for OPTIONS requests', async () => {
      mockedGetRateLimiter.mockReturnValue(mockLimiter());

      const request = makeRequest('/api/ai/chat', {
        method: 'OPTIONS',
        origin: 'http://localhost:3000',
      });
      const response = await middleware(request);

      expect(response.status).toBe(200);
      expect(mockLimitFn).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------
  // Identifier resolution
  // -------------------------------------------------------------------
  describe('identifier resolution', () => {
    beforeEach(() => {
      mockLimitFn.mockResolvedValue({
        success: true,
        limit: 100,
        remaining: 99,
        reset: Date.now() + 60_000,
      });
      mockedGetRateLimiter.mockReturnValue(mockLimiter());
    });

    it('should call getIdentifier with the request', async () => {
      const request = makeRequest('/api/ai/chat', { authorization: 'Bearer tok_abc' });
      await middleware(request);

      expect(mockedGetIdentifier).toHaveBeenCalledWith(request);
    });

    it('should pass the identifier to limiter.limit()', async () => {
      mockedGetIdentifier.mockResolvedValue('user-xyz');

      const request = makeRequest('/api/ai/chat');
      await middleware(request);

      expect(mockLimitFn).toHaveBeenCalledWith('user-xyz');
    });
  });

  // -------------------------------------------------------------------
  // Non-API routes
  // -------------------------------------------------------------------
  describe('non-API paths', () => {
    it('should not invoke rate limiter for non-/api/ paths', async () => {
      mockedGetRateLimiter.mockReturnValue(mockLimiter());

      // Although the middleware matcher would not invoke middleware for non-/api/
      // paths in production, the function itself should still handle it correctly.
      const request = makeRequest('/library', { origin: 'http://localhost:3000' });
      const response = await middleware(request);

      expect(response.status).toBe(200);
      expect(mockedGetRateLimiter).not.toHaveBeenCalled();
    });
  });
});
