/**
 * OPDS feed caching layer using IndexedDB.
 *
 * Provides offline access to previously browsed feeds with
 * time-based expiration and storage quota management.
 */

import type { OPDSFeed } from '../types';
import { createLogger } from '@/utils/logger';

const logger = createLogger('opds-cache');

export interface OPDSCachedFeed {
  feed: OPDSFeed;
  cachedAt: string;
  expiresAt: string;
  catalogId?: string;
}

export interface CacheOptions {
  catalogId?: string;
  maxAge?: number; // ms
}

export interface CacheStats {
  totalEntries: number;
  totalSize: number;
  oldestEntry: string;
  newestEntry: string;
}

const DB_NAME = 'opds-cache';
const DB_VERSION = 1;
const FEEDS_STORE = 'feeds';
const IMAGES_STORE = 'images';
const DEFAULT_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_MAX_SIZE = 100 * 1024 * 1024; // 100 MB

interface CachedFeedRecord {
  url: string;
  feed: OPDSFeed;
  catalogId?: string;
  cachedAt: string;
  expiresAt: string;
  size: number;
}

interface CachedImageRecord {
  url: string;
  blob: Blob;
  catalogId?: string;
  cachedAt: string;
  size: number;
}

export class OPDSCacheStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  /**
   * Get a cached feed by URL, returning null if expired or not found.
   */
  async getFeed(url: string): Promise<OPDSCachedFeed | null> {
    try {
      const db = await this.openDB();
      const record = await getFromStore<CachedFeedRecord>(db, FEEDS_STORE, url);
      if (!record) return null;

      if (new Date(record.expiresAt) < new Date()) {
        await deleteFromStore(db, FEEDS_STORE, url);
        return null;
      }

      return {
        feed: record.feed,
        cachedAt: record.cachedAt,
        expiresAt: record.expiresAt,
        catalogId: record.catalogId,
      };
    } catch (e) {
      logger.warn('Failed to read cached feed', e);
      return null;
    }
  }

  /**
   * Store a feed in the cache.
   */
  async setFeed(url: string, feed: OPDSFeed, options: CacheOptions = {}): Promise<void> {
    try {
      const { catalogId, maxAge = DEFAULT_MAX_AGE } = options;
      const now = new Date();

      const record: CachedFeedRecord = {
        url,
        feed,
        catalogId,
        cachedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + maxAge).toISOString(),
        size: estimateSize(feed),
      };

      const db = await this.openDB();
      await putInStore(db, FEEDS_STORE, record);
    } catch (e) {
      logger.warn('Failed to write feed to cache', e);
    }
  }

  /**
   * Get a cached image blob by URL.
   */
  async getImage(url: string): Promise<Blob | null> {
    try {
      const db = await this.openDB();
      const record = await getFromStore<CachedImageRecord>(db, IMAGES_STORE, url);
      return record?.blob ?? null;
    } catch (e) {
      logger.warn('Failed to read cached image', e);
      return null;
    }
  }

  /**
   * Store an image blob in the cache.
   */
  async setImage(url: string, blob: Blob, catalogId?: string): Promise<void> {
    try {
      const db = await this.openDB();
      await putInStore(db, IMAGES_STORE, {
        url,
        blob,
        catalogId,
        cachedAt: new Date().toISOString(),
        size: blob.size,
      });
    } catch (e) {
      logger.warn('Failed to write image to cache', e);
    }
  }

  /**
   * Check if a feed URL is cached and not expired.
   */
  async isCached(url: string): Promise<boolean> {
    return (await this.getFeed(url)) !== null;
  }

  /**
   * Get cache statistics.
   */
  async getStats(): Promise<CacheStats> {
    try {
      const db = await this.openDB();
      const feeds = await getAllFromStore<CachedFeedRecord>(db, FEEDS_STORE);
      const images = await getAllFromStore<CachedImageRecord>(db, IMAGES_STORE);

      let totalSize = 0;
      let oldestEntry = new Date().toISOString();
      let newestEntry = '1970-01-01T00:00:00.000Z';

      for (const feed of feeds) {
        totalSize += feed.size;
        if (feed.cachedAt < oldestEntry) oldestEntry = feed.cachedAt;
        if (feed.cachedAt > newestEntry) newestEntry = feed.cachedAt;
      }

      for (const image of images) {
        totalSize += image.size;
      }

      return {
        totalEntries: feeds.length + images.length,
        totalSize,
        oldestEntry,
        newestEntry,
      };
    } catch (e) {
      logger.warn('Failed to read cache stats', e);
      return {
        totalEntries: 0,
        totalSize: 0,
        oldestEntry: '',
        newestEntry: '',
      };
    }
  }

  /**
   * Clear all cache for a specific catalog.
   */
  async clearCatalog(catalogId: string): Promise<void> {
    try {
      const db = await this.openDB();
      const feeds = await getAllFromStore<CachedFeedRecord>(db, FEEDS_STORE);
      const images = await getAllFromStore<CachedImageRecord>(db, IMAGES_STORE);

      for (const feed of feeds) {
        if (feed.catalogId === catalogId) {
          await deleteFromStore(db, FEEDS_STORE, feed.url);
        }
      }
      for (const image of images) {
        if (image.catalogId === catalogId) {
          await deleteFromStore(db, IMAGES_STORE, image.url);
        }
      }
    } catch (e) {
      logger.warn('Failed to clear catalog cache', e);
    }
  }

  /**
   * Clear all cached data.
   */
  async clearAll(): Promise<void> {
    try {
      const db = await this.openDB();
      await clearStore(db, FEEDS_STORE);
      await clearStore(db, IMAGES_STORE);
    } catch (e) {
      logger.warn('Failed to clear all cache', e);
    }
  }

  /**
   * Prune expired entries and enforce storage quota.
   */
  async prune(maxAge = DEFAULT_MAX_AGE, maxSize = DEFAULT_MAX_SIZE): Promise<void> {
    try {
      const db = await this.openDB();
      const feeds = await getAllFromStore<CachedFeedRecord>(db, FEEDS_STORE);
      const now = new Date();
      const cutoff = new Date(now.getTime() - maxAge);

      // Delete expired
      for (const feed of feeds) {
        if (new Date(feed.expiresAt) < now || new Date(feed.cachedAt) < cutoff) {
          await deleteFromStore(db, FEEDS_STORE, feed.url);
        }
      }

      // Check size and delete oldest if over quota
      const stats = await this.getStats();
      if (stats.totalSize > maxSize) {
        const remainingFeeds = await getAllFromStore<CachedFeedRecord>(db, FEEDS_STORE);
        remainingFeeds.sort((a, b) => a.cachedAt.localeCompare(b.cachedAt));

        let excess = stats.totalSize - maxSize;
        for (const feed of remainingFeeds) {
          if (excess <= 0) break;
          await deleteFromStore(db, FEEDS_STORE, feed.url);
          excess -= feed.size;
        }
      }
    } catch (e) {
      logger.warn('Failed to prune cache', e);
    }
  }

  private openDB(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(FEEDS_STORE)) {
          db.createObjectStore(FEEDS_STORE, { keyPath: 'url' });
        }
        if (!db.objectStoreNames.contains(IMAGES_STORE)) {
          db.createObjectStore(IMAGES_STORE, { keyPath: 'url' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        this.dbPromise = null;
        reject(request.error);
      };
    });

    return this.dbPromise;
  }
}

// --- IndexedDB helpers ---

function getFromStore<T>(db: IDBDatabase, storeName: string, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
}

function getAllFromStore<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error);
  });
}

function putInStore(db: IDBDatabase, storeName: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.put(value);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function deleteFromStore(db: IDBDatabase, storeName: string, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function clearStore(db: IDBDatabase, storeName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function estimateSize(obj: unknown): number {
  try {
    return new Blob([JSON.stringify(obj)]).size;
  } catch (e) {
    logger.warn('Failed to estimate object size', e);
    return 0;
  }
}
