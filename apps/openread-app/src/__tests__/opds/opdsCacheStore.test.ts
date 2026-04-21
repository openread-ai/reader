import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { OPDSFeed } from '@/app/opds/types';

// --- IndexedDB mock ---

interface MockStore {
  data: Map<string, unknown>;
}

interface MockDB {
  objectStoreNames: { contains: (name: string) => boolean };
  createObjectStore: (name: string, options?: { keyPath: string }) => void;
  transaction: (
    storeName: string,
    mode?: string,
  ) => {
    objectStore: (name: string) => {
      get: (key: string) => MockRequest;
      getAll: () => MockRequest;
      put: (value: unknown) => MockRequest;
      delete: (key: string) => MockRequest;
      clear: () => MockRequest;
    };
  };
}

interface MockRequest {
  result: unknown;
  error: Error | null;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
}

let stores: Map<string, MockStore>;
let dbInstance: MockDB;

function createMockRequest(result: unknown): MockRequest {
  const req: MockRequest = {
    result,
    error: null,
    onsuccess: null,
    onerror: null,
  };
  // Trigger onsuccess in microtask
  Promise.resolve().then(() => req.onsuccess?.());
  return req;
}

function setupIndexedDBMock() {
  stores = new Map();
  stores.set('feeds', { data: new Map() });
  stores.set('images', { data: new Map() });

  dbInstance = {
    objectStoreNames: {
      contains: (name: string) => stores.has(name),
    },
    createObjectStore: (name: string) => {
      stores.set(name, { data: new Map() });
    },
    transaction: (_storeName: string) => ({
      objectStore: (name: string) => {
        const store = stores.get(name)!;
        return {
          get: (key: string) => createMockRequest(store.data.get(key)),
          getAll: () => createMockRequest(Array.from(store.data.values())),
          put: (value: unknown) => {
            const record = value as { url: string };
            store.data.set(record.url, value);
            return createMockRequest(undefined);
          },
          delete: (key: string) => {
            store.data.delete(key);
            return createMockRequest(undefined);
          },
          clear: () => {
            store.data.clear();
            return createMockRequest(undefined);
          },
        };
      },
    }),
  };

  const openRequest: MockRequest & { onupgradeneeded: (() => void) | null } = {
    result: dbInstance,
    error: null,
    onsuccess: null,
    onerror: null,
    onupgradeneeded: null,
  };

  Object.defineProperty(globalThis, 'indexedDB', {
    value: {
      open: () => {
        // Trigger upgrade then success
        Promise.resolve().then(() => {
          openRequest.onupgradeneeded?.();
          openRequest.onsuccess?.();
        });
        return openRequest;
      },
    },
    writable: true,
    configurable: true,
  });
}

function createMockFeed(overrides: Partial<OPDSFeed> = {}): OPDSFeed {
  return {
    id: 'test-feed',
    title: 'Test Feed',
    updated: '2024-01-01T00:00:00Z',
    links: [],
    publications: [],
    navigation: [],
    facets: [],
    groups: [],
    isComplete: true,
    feedType: 'navigation',
    ...overrides,
  };
}

describe('OPDSCacheStore', () => {
  beforeEach(() => {
    vi.resetModules();
    setupIndexedDBMock();
  });

  it('should store and retrieve a feed', async () => {
    const { OPDSCacheStore } = await import('@/app/opds/services/opdsCacheStore');
    const cache = new OPDSCacheStore();
    const feed = createMockFeed({ title: 'Cached Feed' });

    await cache.setFeed('https://example.com/feed', feed);
    const result = await cache.getFeed('https://example.com/feed');

    expect(result).not.toBeNull();
    expect(result!.feed.title).toBe('Cached Feed');
    expect(result!.cachedAt).toBeDefined();
    expect(result!.expiresAt).toBeDefined();
  });

  it('should return null for missing feed', async () => {
    const { OPDSCacheStore } = await import('@/app/opds/services/opdsCacheStore');
    const cache = new OPDSCacheStore();

    const result = await cache.getFeed('https://example.com/missing');
    expect(result).toBeNull();
  });

  it('should return null for expired feed', async () => {
    const { OPDSCacheStore } = await import('@/app/opds/services/opdsCacheStore');
    const cache = new OPDSCacheStore();
    const feed = createMockFeed();

    // Store with 0ms max age (immediately expired)
    await cache.setFeed('https://example.com/expired', feed, { maxAge: 0 });

    // Wait a tick so the expiry time is in the past
    await new Promise((r) => setTimeout(r, 10));

    const result = await cache.getFeed('https://example.com/expired');
    expect(result).toBeNull();
  });

  it('should store feed with catalogId', async () => {
    const { OPDSCacheStore } = await import('@/app/opds/services/opdsCacheStore');
    const cache = new OPDSCacheStore();
    const feed = createMockFeed();

    await cache.setFeed('https://example.com/feed', feed, { catalogId: 'cat-1' });
    const result = await cache.getFeed('https://example.com/feed');

    expect(result).not.toBeNull();
    expect(result!.catalogId).toBe('cat-1');
  });

  it('should check if feed is cached', async () => {
    const { OPDSCacheStore } = await import('@/app/opds/services/opdsCacheStore');
    const cache = new OPDSCacheStore();
    const feed = createMockFeed();

    expect(await cache.isCached('https://example.com/feed')).toBe(false);
    await cache.setFeed('https://example.com/feed', feed);
    expect(await cache.isCached('https://example.com/feed')).toBe(true);
  });

  it('should clear all cached data', async () => {
    const { OPDSCacheStore } = await import('@/app/opds/services/opdsCacheStore');
    const cache = new OPDSCacheStore();
    const feed = createMockFeed();

    await cache.setFeed('https://example.com/feed1', feed);
    await cache.setFeed('https://example.com/feed2', feed);
    await cache.clearAll();

    expect(await cache.isCached('https://example.com/feed1')).toBe(false);
    expect(await cache.isCached('https://example.com/feed2')).toBe(false);
  });

  it('should clear cache for specific catalog', async () => {
    const { OPDSCacheStore } = await import('@/app/opds/services/opdsCacheStore');
    const cache = new OPDSCacheStore();

    await cache.setFeed('https://cat1.com/feed', createMockFeed(), { catalogId: 'cat-1' });
    await cache.setFeed('https://cat2.com/feed', createMockFeed(), { catalogId: 'cat-2' });

    await cache.clearCatalog('cat-1');

    expect(await cache.isCached('https://cat1.com/feed')).toBe(false);
    expect(await cache.isCached('https://cat2.com/feed')).toBe(true);
  });

  it('should report cache stats', async () => {
    const { OPDSCacheStore } = await import('@/app/opds/services/opdsCacheStore');
    const cache = new OPDSCacheStore();

    await cache.setFeed('https://example.com/feed1', createMockFeed({ title: 'Feed 1' }));
    await cache.setFeed('https://example.com/feed2', createMockFeed({ title: 'Feed 2' }));

    const stats = await cache.getStats();

    expect(stats.totalEntries).toBe(2);
    expect(stats.totalSize).toBeGreaterThan(0);
  });

  it('should store and retrieve images', async () => {
    const { OPDSCacheStore } = await import('@/app/opds/services/opdsCacheStore');
    const cache = new OPDSCacheStore();
    const blob = new Blob(['image data'], { type: 'image/jpeg' });

    await cache.setImage('https://example.com/cover.jpg', blob);
    const result = await cache.getImage('https://example.com/cover.jpg');

    expect(result).not.toBeNull();
    expect(result!.size).toBe(blob.size);
  });

  it('should return null for missing image', async () => {
    const { OPDSCacheStore } = await import('@/app/opds/services/opdsCacheStore');
    const cache = new OPDSCacheStore();

    const result = await cache.getImage('https://example.com/missing.jpg');
    expect(result).toBeNull();
  });
});
