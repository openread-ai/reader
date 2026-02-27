/**
 * @module services/sync/syncWorker
 * P9.22: Background sync worker that drains the offline queue.
 *
 * - Runs every 10 seconds when online
 * - Pauses when offline, resumes on reconnection
 * - Uses SyncClient to push queued changes
 * - Dispatches status events for UI updates
 */

import { offlineQueue, type QueueItem } from './offlineQueue';
import { SyncClient } from '@/libs/sync';
import { supabase } from '@/utils/supabase';
import { transformBookFromDB } from '@/utils/transform';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import envConfig from '@/services/environment';
import type { DBBook } from '@/types/records';
import type { RealtimeChannel } from '@supabase/supabase-js';

const SYNC_INTERVAL_MS = 10_000;

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

    // Subscribe to Supabase Realtime broadcast for instant pull
    if (this.userId) {
      this.realtimeChannel = supabase
        .channel(`sync:${this.userId}`)
        .on('broadcast', { event: 'books-changed' }, () => {
          this.pullRemoteChanges();
        })
        .subscribe();
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
    // Skip if offline
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
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
   * Full sync cycle: drain push queue, then pull remote changes.
   */
  private async runSyncCycle(): Promise<void> {
    await this.drainQueue();
    await this.pullRemoteChanges();
  }

  /**
   * Pull remote book changes since lastSyncedAtBooks and merge into library.
   */
  private async pullRemoteChanges(): Promise<void> {
    // Skip if offline
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;

    try {
      const settings = useSettingsStore.getState().settings;
      const since = (settings.lastSyncedAtBooks ?? 0) + 1;

      const result = await this.syncClient.pullChanges(since, 'books');
      const dbBooks = result.books;
      if (!dbBooks?.length) return;

      // Transform DB records to client Book type
      const books = dbBooks.map((dbBook) => transformBookFromDB(dbBook as unknown as DBBook));

      // Merge into library store
      await useLibraryStore.getState().updateBooks(envConfig, books);

      // Compute max timestamp from pulled records and update settings
      let maxTime = 0;
      for (const rec of dbBooks) {
        if (rec.updated_at) {
          maxTime = Math.max(maxTime, new Date(rec.updated_at).getTime());
        }
        if (rec.deleted_at) {
          maxTime = Math.max(maxTime, new Date(rec.deleted_at).getTime());
        }
      }

      if (maxTime > 0) {
        const freshSettings = useSettingsStore.getState().settings;
        freshSettings.lastSyncedAtBooks = maxTime;
        useSettingsStore.getState().setSettings(freshSettings);
        useSettingsStore.getState().saveSettings(envConfig, freshSettings);
      }
    } catch (error) {
      console.error('[SyncWorker] Pull remote changes failed:', error);
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
