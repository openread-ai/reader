/**
 * @module services/sync/syncWorker
 * P9.22: Background sync worker that drains the offline queue.
 *
 * - Runs every 10 seconds when online
 * - Pauses when offline, resumes on reconnection
 * - Uses SyncClient to push queued changes
 * - Single source of truth for all sync operations and watermarks
 */

import { offlineQueue, type QueueItem } from './offlineQueue';
import { SyncClient, type SyncType } from '@/libs/sync';
import { supabase } from '@/utils/supabase';
import {
  transformBookFromDB,
  transformBookConfigFromDB,
  transformBookNoteFromDB,
  extractRoamingSettings,
  applyRoamingSettings,
} from '@/utils/transform';
import { useLibraryStore } from '@/store/libraryStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import envConfig from '@/services/environment';
import type { BookDataRecord } from '@/types/book';
import type { DBBook, DBBookConfig, DBBookNote } from '@/types/records';
import type { SystemSettings } from '@/types/settings';
import type { RealtimeChannel } from '@supabase/supabase-js';

const SYNC_INTERVAL_MS = 10_000;

/** Check if the browser is offline. */
function isOffline(): boolean {
  return typeof navigator !== 'undefined' && !navigator.onLine;
}

/** Compute the max timestamp from an array of DB records (updated_at / deleted_at). */
function computeMaxTimestamp(records: BookDataRecord[]): number {
  let maxTime = 0;
  for (const rec of records) {
    if (rec.updated_at) {
      maxTime = Math.max(maxTime, new Date(rec.updated_at).getTime());
    }
    if (rec.deleted_at) {
      maxTime = Math.max(maxTime, new Date(rec.deleted_at).getTime());
    }
  }
  return maxTime;
}

/**
 * Persist watermark updates to the settings store.
 * Creates a new object (immutable) and saves locally without triggering a push.
 */
async function saveWatermarks(updates: Partial<SystemSettings>): Promise<void> {
  const settings = { ...useSettingsStore.getState().settings, ...updates };
  useSettingsStore.getState().setSettings(settings);
  // Save locally only — no push to avoid recursion and redundant network calls.
  // Watermarks are per-device and excluded from roaming settings.
  const appService = await envConfig.getAppService();
  await appService.saveSettings(settings);
}

interface SyncableCollection {
  id: string;
  name?: string;
  bookHashes?: string[];
  createdAt?: string;
  updatedAt?: number;
  deletedAt?: number | null;
}

/**
 * Merge local and remote collections using per-collection LWW.
 * New collections from either side are added; conflicts resolved by updatedAt.
 */
function mergeCollections(
  local: SyncableCollection[],
  remote: SyncableCollection[],
): SyncableCollection[] {
  const localMap = new Map(local.map((c) => [c.id, c]));
  for (const r of remote) {
    if (!r.id) continue;
    const l = localMap.get(r.id);
    if (!l) {
      localMap.set(r.id, r);
    } else if ((r.updatedAt ?? 0) > (l.updatedAt ?? 0)) {
      localMap.set(r.id, r);
    }
  }
  return Array.from(localMap.values()).filter((c) => !c.deletedAt);
}

export interface SyncWorkerStatus {
  pending: number;
  syncing: boolean;
  lastDrainResult: { synced: number; failed: number; remaining: number } | null;
  error: string | null;
}

/**
 * Background sync worker.
 * Call start() to begin periodic queue draining.
 */
export class SyncWorker {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private pendingDrainRequested = false;
  private syncClient = new SyncClient();
  private realtimeChannel: RealtimeChannel | null = null;
  private userId: string | null = null;
  private _status: SyncWorkerStatus = {
    pending: 0,
    syncing: false,
    lastDrainResult: null,
    error: null,
  };
  private listeners = new Set<(status: SyncWorkerStatus) => void>();

  /**
   * Start the background sync worker.
   * Drains the queue immediately, then every SYNC_INTERVAL_MS.
   * Subscribes to Supabase Realtime for instant cross-device sync.
   */
  start(userId?: string): void {
    if (this.intervalId) return; // Already started
    this.userId = userId ?? null;

    // Listen to online/offline events
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline);
      window.addEventListener('offline', this.handleOffline);
    }

    // Subscribe to Supabase Realtime broadcast for instant pull.
    // Tauri's custom protocol (tauri://localhost) isn't a secure context,
    // so WebSocket fails there — polling is the fallback.
    if (this.userId) {
      try {
        this.realtimeChannel = supabase
          .channel(`sync:${this.userId}`)
          .on('broadcast', { event: 'books-changed' }, () => {
            this.pullRemoteChanges();
          })
          .subscribe((status) => {
            if (status === 'CHANNEL_ERROR') {
              console.warn('[SyncWorker] Realtime channel error, using polling fallback');
            }
          });
      } catch {
        console.warn('[SyncWorker] Realtime unavailable, using polling fallback');
        this.realtimeChannel = null;
      }
    }

    // Run full cycle immediately on start (replay pending + pull remote)
    this.runSyncCycle();

    // Schedule periodic sync cycles (fallback if Realtime disconnects)
    this.intervalId = setInterval(() => this.runSyncCycle(), SYNC_INTERVAL_MS);
  }

  /**
   * Stop the background sync worker.
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.realtimeChannel) {
      supabase.removeChannel(this.realtimeChannel);
      this.realtimeChannel = null;
    }
    this.userId = null;
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline);
      window.removeEventListener('offline', this.handleOffline);
    }
  }

  /**
   * Manually trigger a drain (e.g., after enqueuing a delete).
   * If a drain is already running, schedules a re-drain so the new item
   * isn't stuck waiting for the next periodic cycle.
   */
  async syncNow(): Promise<void> {
    if (this.isRunning) {
      this.pendingDrainRequested = true;
      return;
    }
    await this.drainQueue();
  }

  /**
   * Get current status.
   */
  get status(): SyncWorkerStatus {
    return { ...this._status };
  }

  /**
   * Subscribe to status changes.
   */
  subscribe(callback: (status: SyncWorkerStatus) => void): () => void {
    this.listeners.add(callback);
    callback(this._status);
    return () => this.listeners.delete(callback);
  }

  /**
   * Pull on demand. Components call this instead of using SyncClient directly.
   */
  async pullNow(type?: SyncType): Promise<void> {
    if (type === 'books') {
      await this.pullRemoteChanges();
    } else if (type === 'configs') {
      await this.pullRemoteConfigs();
    } else if (type === 'notes') {
      await this.pullRemoteNotes();
    } else if (type === 'settings') {
      await this.pullRemoteSettings();
    } else {
      // Pull all types in parallel — they query independent tables
      await Promise.all([
        this.pullRemoteChanges(),
        this.pullRemoteConfigs(),
        this.pullRemoteNotes(),
        this.pullRemoteSettings(),
      ]);
    }
  }

  /**
   * Push current roaming settings to the server.
   * Saves the watermark locally without going through saveSettings
   * to avoid infinite recursion (saveSettings must not trigger pushSettings).
   */
  async pushSettings(): Promise<void> {
    if (isOffline()) return;

    try {
      const settings = useSettingsStore.getState().settings;
      const roaming = extractRoamingSettings(settings);
      await this.syncClient.pushChanges({ settings: roaming });
      await saveWatermarks({ lastSyncedAtSettings: Date.now() });
    } catch (error) {
      console.error('[SyncWorker] Push settings failed:', error);
    }
  }

  /**
   * Push collections to server via the settings sync channel.
   * Collections are stored as a `_collections` key in user_settings JSON.
   */
  async pushCollections(): Promise<void> {
    if (isOffline()) return;

    try {
      const { usePlatformSidebarStore } = await import('@/store/platformSidebarStore');
      const collections = usePlatformSidebarStore.getState().collections;
      await this.syncClient.pushChanges({
        settings: { _collections: collections, _updatedAt: new Date().toISOString() },
      });
    } catch (error) {
      console.error('[SyncWorker] Push collections failed:', error);
    }
  }

  private handleOnline = (): void => {
    // Resume: drain immediately when coming back online
    this.drainQueue();
  };

  private handleOffline = (): void => {
    // Nothing to do — drainQueue checks navigator.onLine
    this.updateStatus({ error: 'Offline — changes will sync when connected' });
  };

  /**
   * Process all pending queue items.
   */
  private async drainQueue(): Promise<void> {
    if (isOffline()) {
      this.updateStatus({ pending: offlineQueue.pendingCount });
      return;
    }

    // Skip if already running
    if (this.isRunning) return;
    this.isRunning = true;
    this.updateStatus({ syncing: true, error: null });

    try {
      const result = await offlineQueue.drain((item) => this.processItem(item));
      this.updateStatus({
        syncing: false,
        pending: result.remaining,
        lastDrainResult: result,
        error: result.failed > 0 ? `${result.failed} items failed to sync` : null,
      });
    } catch (error) {
      this.updateStatus({
        syncing: false,
        error: error instanceof Error ? error.message : 'Sync failed',
      });
    } finally {
      this.isRunning = false;

      // If syncNow() was called while we were draining, re-drain to pick up
      // items that were enqueued during the previous drain.
      if (this.pendingDrainRequested) {
        this.pendingDrainRequested = false;
        this.drainQueue();
      }
    }
  }

  /**
   * Full sync cycle: drain push queue, then pull remote changes for all entity types.
   */
  private async runSyncCycle(): Promise<void> {
    await this.drainQueue();
    // Pull all types in parallel — they query independent DB tables
    await Promise.all([
      this.pullRemoteChanges(),
      this.pullRemoteConfigs(),
      this.pullRemoteNotes(),
      this.pullRemoteSettings(),
    ]);
  }

  /**
   * Pull remote book changes via hash-based reconciliation.
   * Sends full local inventory; server returns diff (upserts + removals).
   */
  private async pullRemoteChanges(): Promise<void> {
    if (isOffline()) return;

    try {
      const library = useLibraryStore.getState().library;
      const localHashes: Record<string, number> = {};
      for (const book of library) {
        localHashes[book.hash] = book.updatedAt || 0;
      }

      const result = await this.syncClient.pushChanges({
        reconcile: { books: localHashes },
      });
      const reconcile = result.reconcile;
      if (!reconcile) return;

      if (reconcile.upsert?.length) {
        const books = reconcile.upsert.map((b) => transformBookFromDB(b as unknown as DBBook));
        await useLibraryStore.getState().updateBooks(envConfig, books);
      }
      if (reconcile.remove?.length) {
        const removeSet = new Set(reconcile.remove);
        const current = useLibraryStore.getState().library;
        const remaining = current.filter((b) => !removeSet.has(b.hash));
        useLibraryStore.getState().setLibrary(remaining);
        const appService = await envConfig.getAppService();
        await appService.saveLibraryBooks(remaining);
      }
    } catch (error) {
      console.error('[SyncWorker] Reconciliation failed:', error);
    }
  }

  /**
   * Pull remote config changes and merge into bookDataStore.
   */
  private async pullRemoteConfigs(): Promise<void> {
    if (isOffline()) return;

    try {
      const settings = useSettingsStore.getState().settings;
      const since = (settings.lastSyncedAtConfigs ?? 0) + 1;

      const result = await this.syncClient.pullChanges(since, 'configs');
      const dbConfigs = result.configs;
      if (!dbConfigs?.length) return;

      const configs = dbConfigs.map((c) => transformBookConfigFromDB(c as unknown as DBBookConfig));
      const bookDataStore = useBookDataStore.getState();
      // Build lookup map of active (non-deleted) books to skip orphaned configs
      const library = useLibraryStore.getState().library;
      const bookByHash = new Map(library.map((b) => [b.hash, b]));

      for (const config of configs) {
        if (!config.bookHash) continue;
        const book = bookByHash.get(config.bookHash);
        if (!book) continue;
        const bookKey = `${book.hash}-${book.format}`;
        const existing = bookDataStore.getConfig(bookKey);
        if (!existing || (config.updatedAt ?? 0) >= (existing.updatedAt ?? 0)) {
          bookDataStore.setConfig(bookKey, { ...existing, ...config });
        }
      }

      const maxTime = computeMaxTimestamp(dbConfigs as unknown as BookDataRecord[]);
      if (maxTime > 0) {
        await saveWatermarks({ lastSyncedAtConfigs: maxTime });
      }
    } catch (error) {
      console.error('[SyncWorker] Pull remote configs failed:', error);
    }
  }

  /**
   * Pull remote note changes and merge into bookDataStore.
   */
  private async pullRemoteNotes(): Promise<void> {
    if (isOffline()) return;

    try {
      const settings = useSettingsStore.getState().settings;
      const since = (settings.lastSyncedAtNotes ?? 0) + 1;

      const result = await this.syncClient.pullChanges(since, 'notes');
      const dbNotes = result.notes;
      if (!dbNotes?.length) return;

      const notes = dbNotes.map((n) => transformBookNoteFromDB(n as unknown as DBBookNote));
      const bookDataStore = useBookDataStore.getState();

      // Group notes by bookHash
      const notesByBook = new Map<string, typeof notes>();
      for (const note of notes) {
        if (!note.bookHash) continue;
        const existing = notesByBook.get(note.bookHash) ?? [];
        existing.push(note);
        notesByBook.set(note.bookHash, existing);
      }

      // Build lookup map of active (non-deleted) books to skip orphaned notes
      const library = useLibraryStore.getState().library;
      const bookByHash = new Map(library.map((b) => [b.hash, b]));

      for (const [bookHash, bookNotes] of notesByBook) {
        const book = bookByHash.get(bookHash);
        if (!book) continue;
        const bookKey = `${book.hash}-${book.format}`;
        const config = bookDataStore.getConfig(bookKey);
        if (!config) continue;

        const oldNotes = config.booknotes ?? [];
        // Build ID→index map for O(1) lookups instead of O(N) findIndex
        const noteIdxMap = new Map(oldNotes.map((n, i) => [n.id, i]));
        const mergedNotes = [...oldNotes];

        for (const note of bookNotes) {
          const idx = noteIdxMap.get(note.id);
          if (idx !== undefined) {
            if ((note.updatedAt ?? 0) > (mergedNotes[idx]!.updatedAt ?? 0)) {
              mergedNotes[idx] = { ...mergedNotes[idx]!, ...note };
            }
          } else {
            mergedNotes.push(note);
          }
        }

        bookDataStore.setConfig(bookKey, { booknotes: mergedNotes });
      }

      const maxTime = computeMaxTimestamp(dbNotes as unknown as BookDataRecord[]);
      if (maxTime > 0) {
        await saveWatermarks({ lastSyncedAtNotes: maxTime });
      }
    } catch (error) {
      console.error('[SyncWorker] Pull remote notes failed:', error);
    }
  }

  /**
   * Pull remote settings and merge roaming fields into local settings.
   */
  private async pullRemoteSettings(): Promise<void> {
    if (isOffline()) return;

    try {
      const settings = useSettingsStore.getState().settings;
      const since = (settings.lastSyncedAtSettings ?? 0) + 1;

      const result = await this.syncClient.pullChanges(since, 'settings');
      const remoteSettings = result.settings;
      if (!remoteSettings || Object.keys(remoteSettings).length === 0) return;

      const freshSettings = { ...useSettingsStore.getState().settings };
      const merged = applyRoamingSettings(freshSettings, remoteSettings);
      merged.lastSyncedAtSettings = Date.now();
      useSettingsStore.getState().setSettings(merged);
      const appService = await envConfig.getAppService();
      await appService.saveSettings(merged);

      // Merge remote collections if present
      if (remoteSettings._collections && Array.isArray(remoteSettings._collections)) {
        const { usePlatformSidebarStore } = await import('@/store/platformSidebarStore');
        const localCollections = usePlatformSidebarStore.getState().collections;
        const mergedCollections = mergeCollections(
          localCollections,
          remoteSettings._collections as SyncableCollection[],
        );
        usePlatformSidebarStore.setState({
          collections: mergedCollections as typeof localCollections,
        });
      }
    } catch (error) {
      console.error('[SyncWorker] Pull remote settings failed:', error);
    }
  }

  /**
   * Process a single queue item via SyncClient.
   */
  private async processItem(item: QueueItem): Promise<boolean> {
    try {
      switch (item.type) {
        case 'book':
          await this.syncClient.pushChanges({ books: [item.payload] });
          this.broadcastChange('books-changed');
          return true;
        case 'config':
          await this.syncClient.pushChanges({ configs: [item.payload] });
          return true;
        case 'note':
          await this.syncClient.pushChanges({ notes: [item.payload] });
          return true;
        default:
          console.warn(`[SyncWorker] Unknown queue item type: ${item.type}`);
          return false;
      }
    } catch (error) {
      console.error(`[SyncWorker] Failed to process item ${item.id}:`, error);
      return false;
    }
  }

  /**
   * Broadcast a sync event to other devices via Supabase Realtime.
   */
  private broadcastChange(event: string): void {
    if (!this.realtimeChannel) return;
    this.realtimeChannel.send({
      type: 'broadcast',
      event,
      payload: {},
    });
  }

  private updateStatus(partial: Partial<SyncWorkerStatus>): void {
    this._status = { ...this._status, ...partial };
    this.listeners.forEach((cb) => cb(this._status));
  }
}

/** Singleton instance */
export const syncWorker = new SyncWorker();
