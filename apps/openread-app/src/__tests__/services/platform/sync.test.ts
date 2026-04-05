import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PlatformSync } from '@/services/platform/sync';
import type { SyncState } from '@/services/platform/sync';

// Mock the client module
vi.mock('@/services/platform/client', () => ({
  getPlatformClient: vi.fn(() => ({
    books: {
      list: vi.fn().mockResolvedValue({ books: [], total: 0, page: 1, pageSize: 20 }),
      exists: vi.fn().mockResolvedValue(false),
    },
  })),
  OpenreadError: class OpenreadError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));

// P9.21: Mock new dependencies
vi.mock('@/libs/sync', () => ({
  SyncClient: class MockSyncClient {
    pushChanges = vi.fn().mockResolvedValue({ books: null, notes: null, configs: null });
    pullChanges = vi.fn().mockResolvedValue({ books: null, notes: null, configs: null });
  },
}));

vi.mock('@/services/deviceService', () => ({
  getDeviceId: vi.fn(() => 'test-device-id'),
}));

vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: {
    getState: vi.fn(() => ({
      library: [],
      setLastSyncAt: vi.fn(),
      setSyncError: vi.fn(),
      clearDirtyBooks: vi.fn(),
    })),
  },
}));

describe('PlatformSync', () => {
  let sync: PlatformSync;
  let originalNavigator: typeof navigator;
  let originalLocalStorage: Storage;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock navigator.onLine
    originalNavigator = global.navigator;
    Object.defineProperty(global, 'navigator', {
      value: { onLine: true },
      writable: true,
      configurable: true,
    });

    // Mock localStorage
    originalLocalStorage = global.localStorage;
    const localStorageMock: Record<string, string> = {};
    Object.defineProperty(global, 'localStorage', {
      value: {
        getItem: vi.fn((key: string) => localStorageMock[key] || null),
        setItem: vi.fn((key: string, value: string) => {
          localStorageMock[key] = value;
        }),
        removeItem: vi.fn((key: string) => {
          delete localStorageMock[key];
        }),
        clear: vi.fn(() => {
          Object.keys(localStorageMock).forEach((key) => delete localStorageMock[key]);
        }),
      },
      writable: true,
      configurable: true,
    });

    sync = new PlatformSync();
  });

  afterEach(() => {
    Object.defineProperty(global, 'navigator', {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(global, 'localStorage', {
      value: originalLocalStorage,
      writable: true,
      configurable: true,
    });
  });

  describe('getState', () => {
    it('should return initial state', () => {
      const state = sync.getState();

      expect(state).toEqual({
        lastSyncAt: null,
        isSyncing: false,
        error: null,
        pendingChanges: 0,
      });
    });
  });

  describe('subscribe', () => {
    it('should call callback immediately with current state', () => {
      const callback = vi.fn();

      sync.subscribe(callback);

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          isSyncing: false,
          lastSyncAt: null,
        }),
      );
    });

    it('should return unsubscribe function', () => {
      const callback = vi.fn();

      const unsubscribe = sync.subscribe(callback);

      expect(typeof unsubscribe).toBe('function');
    });

    it('should stop receiving updates after unsubscribe', () => {
      const callback = vi.fn();

      const unsubscribe = sync.subscribe(callback);
      callback.mockClear();

      unsubscribe();

      // Record a change - should not trigger callback
      sync.recordChange('books', 'create', { id: '1' });

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('recordChange', () => {
    it('should increment pending changes count', () => {
      sync.recordChange('books', 'create', { id: '1' });

      const state = sync.getState();
      expect(state.pendingChanges).toBe(1);
    });

    it('should notify subscribers of state change', () => {
      const callback = vi.fn();
      sync.subscribe(callback);
      callback.mockClear();

      sync.recordChange('books', 'create', { id: '1' });

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          pendingChanges: 1,
        }),
      );
    });

    it('should accumulate multiple changes', () => {
      sync.recordChange('books', 'create', { id: '1' });
      sync.recordChange('books', 'update', { id: '2' });
      sync.recordChange('annotations', 'create', { id: '3' });

      const state = sync.getState();
      expect(state.pendingChanges).toBe(3);
    });
  });

  describe('initialize', () => {
    it('should load last sync time from localStorage', () => {
      const pastDate = new Date('2024-01-15T10:00:00.000Z');
      vi.mocked(localStorage.getItem).mockReturnValueOnce(pastDate.toISOString());

      sync.initialize();

      const state = sync.getState();
      expect(state.lastSyncAt).toEqual(pastDate);
    });

    it('should handle missing localStorage value', () => {
      vi.mocked(localStorage.getItem).mockReturnValueOnce(null);

      sync.initialize();

      const state = sync.getState();
      expect(state.lastSyncAt).toBeNull();
    });
  });

  describe('sync', () => {
    it('should return offline error when not online', async () => {
      Object.defineProperty(global.navigator, 'onLine', { value: false });

      const result = await sync.sync();

      expect(result.errors).toContain('Offline');
      expect(result.pushed).toBe(0);
      expect(result.pulled).toBe(0);
    });

    it('should set isSyncing to true during sync', async () => {
      const states: SyncState[] = [];
      sync.subscribe((state) => states.push({ ...state }));

      await sync.sync();

      // Should have been true at some point during sync
      expect(states.some((s) => s.isSyncing)).toBe(true);
    });

    it('should set isSyncing to false after sync completes', async () => {
      await sync.sync();

      const state = sync.getState();
      expect(state.isSyncing).toBe(false);
    });

    it('should update lastSyncAt after successful sync', async () => {
      const beforeSync = Date.now();

      await sync.sync();

      const state = sync.getState();
      expect(state.lastSyncAt).not.toBeNull();
      expect(state.lastSyncAt!.getTime()).toBeGreaterThanOrEqual(beforeSync);
    });

    it('should save lastSyncAt to localStorage', async () => {
      await sync.sync();

      expect(localStorage.setItem).toHaveBeenCalledWith('platformLastSyncAt', expect.any(String));
    });

    it('should not start new sync while already syncing', async () => {
      // Start first sync
      const firstSync = sync.sync();

      // Try to start another sync immediately
      const secondSync = sync.sync();

      // Both should resolve to the same result
      const [first, second] = await Promise.all([firstSync, secondSync]);

      expect(first).toBe(second);
    });

    it('should clear pending changes after push', async () => {
      sync.recordChange('books', 'create', { id: '1' });
      sync.recordChange('books', 'update', { id: '2' });

      expect(sync.getState().pendingChanges).toBe(2);

      await sync.sync();

      expect(sync.getState().pendingChanges).toBe(0);
    });
  });

  describe('mergeBook', () => {
    it('should return remote book when no local exists', () => {
      const remote = {
        id: '1',
        hash: 'abc',
        metaHash: 'def',
        title: 'Test Book',
        author: 'Author',
        format: 'epub' as const,
        sizeBytes: 1000,
        storagePath: 'path/to/book',
        userId: 'user-1',
        catalogBookId: null,
        createdAt: Date.parse('2024-01-15T10:00:00.000Z'),
        updatedAt: Date.parse('2024-01-15T10:00:00.000Z'),
      };

      const result = sync.mergeBook(remote);

      expect(result).toBe(remote);
    });

    it('should return remote when remote is newer (LWW)', () => {
      const remote = {
        id: '1',
        hash: 'abc',
        metaHash: 'def',
        title: 'Remote Title',
        author: 'Author',
        format: 'epub' as const,
        sizeBytes: 1000,
        storagePath: 'path/to/book',
        userId: 'user-1',
        catalogBookId: null,
        createdAt: Date.parse('2024-01-15T10:00:00.000Z'),
        updatedAt: Date.parse('2024-01-20T10:00:00.000Z'), // Newer
      };

      const local = {
        id: '1',
        title: 'Local Title',
        updatedAt: Date.parse('2024-01-15T10:00:00.000Z'), // Older
      };

      const result = sync.mergeBook(remote, local);

      expect(result).toBe(remote);
    });

    it('should return null when local is newer (keep local)', () => {
      const remote = {
        id: '1',
        hash: 'abc',
        metaHash: 'def',
        title: 'Remote Title',
        author: 'Author',
        format: 'epub' as const,
        sizeBytes: 1000,
        storagePath: 'path/to/book',
        userId: 'user-1',
        catalogBookId: null,
        createdAt: Date.parse('2024-01-15T10:00:00.000Z'),
        updatedAt: Date.parse('2024-01-15T10:00:00.000Z'), // Older
      };

      const local = {
        id: '1',
        title: 'Local Title',
        updatedAt: Date.parse('2024-01-20T10:00:00.000Z'), // Newer
      };

      const result = sync.mergeBook(remote, local);

      expect(result).toBeNull();
    });

    it('should handle local updatedAt as number (timestamp)', () => {
      const remote = {
        id: '1',
        hash: 'abc',
        metaHash: 'def',
        title: 'Remote Title',
        author: 'Author',
        format: 'epub' as const,
        sizeBytes: 1000,
        storagePath: 'path/to/book',
        userId: 'user-1',
        catalogBookId: null,
        createdAt: Date.parse('2024-01-15T10:00:00.000Z'),
        updatedAt: Date.parse('2024-01-20T10:00:00.000Z'),
      };

      const local = {
        id: '1',
        title: 'Local Title',
        updatedAt: new Date('2024-01-15T10:00:00.000Z').getTime(), // As number
      };

      const result = sync.mergeBook(remote, local);

      expect(result).toBe(remote);
    });
  });

  describe('clearPendingChanges', () => {
    it('should clear all pending changes', () => {
      sync.recordChange('books', 'create', { id: '1' });
      sync.recordChange('books', 'update', { id: '2' });

      sync.clearPendingChanges();

      expect(sync.getState().pendingChanges).toBe(0);
    });

    it('should notify subscribers', () => {
      sync.recordChange('books', 'create', { id: '1' });

      const callback = vi.fn();
      sync.subscribe(callback);
      callback.mockClear();

      sync.clearPendingChanges();

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          pendingChanges: 0,
        }),
      );
    });
  });
});
