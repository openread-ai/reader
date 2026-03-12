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
import type { BookConfig, BookDataRecord } from '@/types/book';
import type { DBBook, DBBookConfig, DBBookNote } from '@/types/records';
import type { SystemSettings } from '@/types/settings';
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseClient } from '@/utils/supabase';
import { getAccessToken } from '@/utils/access';
import type { AIConversation, AIMessage } from '@/services/ai/types';
import { aiStore } from '@/services/ai/storage/aiStore';
import { useAIChatStore } from '@/store/aiChatStore';

/** Supabase row shape for ai_conversations table */
interface SupabaseAIConversation {
  id: string;
  user_id: string;
  book_hash: string;
  title: string;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Supabase row shape for ai_messages table */
interface SupabaseAIMessage {
  id: string;
  conversation_id: string;
  user_id: string;
  role: string;
  content: string;
  created_at: string;
}

/** Realtime broadcast event names for cross-device sync */
export const SYNC_EVENTS = {
  BOOKS: 'books-changed',
  CONFIGS: 'configs-changed',
  NOTES: 'notes-changed',
  SETTINGS: 'settings-changed',
  AI_CONVERSATIONS: 'ai-conversations-changed',
} as const;

/** Fallback polling interval — only used if Realtime WebSocket fails */
const SYNC_FALLBACK_INTERVAL_MS = 30_000;

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
    } else if (
      Math.max(r.updatedAt ?? 0, r.deletedAt ?? 0) > Math.max(l.updatedAt ?? 0, l.deletedAt ?? 0)
    ) {
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
/**
 * Coalescing guard: prevents concurrent runs of an async operation while
 * ensuring at most one queued re-run when a request arrives mid-execution.
 * Returns { run, requestRerun, reset } — call reset() in stop() teardown.
 */
function createCoalescingGuard() {
  let busy = false;
  let pending = false;
  return {
    /** Try to enter. Returns true if caller should proceed, false if already busy (re-run queued). */
    tryEnter(): boolean {
      if (busy) {
        pending = true;
        return false;
      }
      busy = true;
      return true;
    },
    /** Call in finally block. Returns true if a re-run was requested while busy. */
    exit(): boolean {
      busy = false;
      if (pending) {
        pending = false;
        return true;
      }
      return false;
    },
    /** Reset state on teardown (stop). */
    reset() {
      busy = false;
      pending = false;
    },
  };
}

export class SyncWorker {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private drainGuard = createCoalescingGuard();
  private reconcileGuard = createCoalescingGuard();
  private aiPullGuard = createCoalescingGuard();
  private syncClient = new SyncClient();
  private realtimeChannel: RealtimeChannel | null = null;
  private userId: string | null = null;
  /** Cached authenticated Supabase client — avoids creating a new GoTrueClient on every call. */
  private cachedSupabase: { client: SupabaseClient; token: string } | null = null;
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

    // Subscribe to Supabase Realtime broadcast for instant sync.
    // Primary sync mechanism — triggers immediately when another device pushes changes.
    if (this.userId) {
      try {
        this.realtimeChannel = supabase
          .channel(`sync:${this.userId}`)
          .on('broadcast', { event: SYNC_EVENTS.BOOKS }, () => {
            this.reconcileBooks();
          })
          .on('broadcast', { event: SYNC_EVENTS.CONFIGS }, () => {
            this.pullRemoteConfigs();
          })
          .on('broadcast', { event: SYNC_EVENTS.NOTES }, () => {
            this.pullRemoteNotes();
          })
          .on('broadcast', { event: SYNC_EVENTS.SETTINGS }, () => {
            this.pullRemoteSettings();
          })
          .on('broadcast', { event: SYNC_EVENTS.AI_CONVERSATIONS }, () => {
            this.pullRemoteAIConversations();
          })
          .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
              console.log('[SyncWorker] Realtime connected — polling disabled');
            } else if (status === 'CHANNEL_ERROR') {
              console.warn('[SyncWorker] Realtime failed — enabling fallback polling');
              this.startFallbackPolling();
            }
          });
      } catch {
        console.warn('[SyncWorker] Realtime unavailable — enabling fallback polling');
        this.realtimeChannel = null;
        this.startFallbackPolling();
      }
    }

    // Run full sync once on startup
    this.runSyncCycle();
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
    this.cachedSupabase = null;
    this.drainGuard.reset();
    this.reconcileGuard.reset();
    this.aiPullGuard.reset();
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
    // drainQueue uses drainGuard internally — if already running,
    // tryEnter() queues a re-run instead of silently dropping.
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
      await this.reconcileBooks();
    } else if (type === 'configs') {
      await this.pullRemoteConfigs();
    } else if (type === 'notes') {
      await this.pullRemoteNotes();
    } else if (type === 'settings') {
      await this.pullRemoteSettings();
    } else {
      await this.runSyncCycle();
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
      this.broadcast(SYNC_EVENTS.SETTINGS);
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
      this.broadcast(SYNC_EVENTS.SETTINGS);
    } catch (error) {
      console.error('[SyncWorker] Push collections failed:', error);
    }
  }

  /**
   * Get an authenticated Supabase client for direct table access.
   * Caches the client and only recreates if the token changes.
   */
  private async getAuthenticatedSupabase(): Promise<SupabaseClient | null> {
    const token = await getAccessToken();
    if (!token) return null;
    if (this.cachedSupabase && this.cachedSupabase.token === token) {
      return this.cachedSupabase.client;
    }
    const client = createSupabaseClient(token);
    // Disable GoTrue session management — these clients use a static Bearer
    // token header and don't need auto-refresh timers or session persistence.
    // Without this, replaced clients leak timers until GC.
    client.auth.stopAutoRefresh();
    this.cachedSupabase = { client, token };
    return client;
  }

  /**
   * Push an AI conversation to Supabase. Online-only — skips if offline.
   * Does NOT use the offline queue; AI data persists in IndexedDB locally.
   */
  async pushAIConversation(conversation: AIConversation): Promise<void> {
    if (isOffline() || !this.userId) return;

    try {
      const sb = await this.getAuthenticatedSupabase();
      if (!sb) return;
      const { error } = await sb.from('ai_conversations').upsert({
        id: conversation.id,
        user_id: this.userId,
        book_hash: conversation.bookHash,
        title: conversation.title,
        deleted_at: conversation.deletedAt ? new Date(conversation.deletedAt).toISOString() : null,
        created_at: new Date(conversation.createdAt).toISOString(),
        updated_at: new Date(conversation.updatedAt).toISOString(),
      });
      if (error) {
        console.error('[SyncWorker] Push AI conversation failed:', error.message);
      } else {
        this.broadcast(SYNC_EVENTS.AI_CONVERSATIONS);
      }
    } catch (error) {
      console.error('[SyncWorker] Push AI conversation error:', error);
    }
  }

  /**
   * Push an AI message to Supabase. Online-only — skips if offline.
   */
  async pushAIMessage(message: AIMessage): Promise<void> {
    if (isOffline() || !this.userId) return;

    try {
      const sb = await this.getAuthenticatedSupabase();
      if (!sb) return;
      const { error } = await sb.from('ai_messages').upsert({
        id: message.id,
        conversation_id: message.conversationId,
        user_id: this.userId,
        role: message.role,
        content: message.content,
        created_at: new Date(message.createdAt).toISOString(),
      });
      if (error) {
        console.error('[SyncWorker] Push AI message failed:', error.message);
      } else {
        this.broadcast(SYNC_EVENTS.AI_CONVERSATIONS);
      }
    } catch (error) {
      console.error('[SyncWorker] Push AI message error:', error);
    }
  }

  /**
   * Start fallback polling (only when Realtime WebSocket fails).
   */
  private startFallbackPolling(): void {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => this.runSyncCycle(), SYNC_FALLBACK_INTERVAL_MS);
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

    if (!this.drainGuard.tryEnter()) return;
    this.updateStatus({ syncing: true, error: null });

    try {
      const result = await offlineQueue.drain((item) => this.processItem(item));
      this.updateStatus({
        syncing: false,
        pending: result.remaining,
        lastDrainResult: result,
        error: result.failed > 0 ? `${result.failed} items failed to sync` : null,
      });
      // After pushing changes, reconcile to pick up cross-device updates
      if (result.synced > 0) {
        this.reconcileBooks();
      }
    } catch (error) {
      this.updateStatus({
        syncing: false,
        error: error instanceof Error ? error.message : 'Sync failed',
      });
    } finally {
      if (this.drainGuard.exit()) {
        this.drainQueue();
      }
    }
  }

  /**
   * Periodic sync: drain queue, reconcile books, pull configs/notes/settings/AI.
   * Books always use reconciliation (watermark can't detect deletions).
   * Configs/notes/settings use fast watermark GET.
   * AI conversations pulled directly from Supabase (no-op if no book is active).
   */
  private async runSyncCycle(): Promise<void> {
    await this.drainQueue();
    await Promise.all([
      this.reconcileBooks(),
      this.pullRemoteConfigs(),
      this.pullRemoteNotes(),
      this.pullRemoteSettings(),
      this.pullRemoteAIConversations(),
    ]);
  }

  /**
   * Full hash-based reconciliation for books.
   * Sends full local inventory; server returns diff (upserts + removals).
   * Used on startup, after pushes, and on Realtime events — not every 10s.
   */
  private async reconcileBooks(): Promise<void> {
    if (isOffline()) return;
    if (!this.reconcileGuard.tryEnter()) return;

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

      // Download covers AFTER all store mutations are complete.
      // Must be sequential — see docs/epics/sync-fixes/005_cover_sync_race_condition.md
      await this.downloadMissingCovers();
    } catch (error) {
      console.error('[SyncWorker] Reconciliation failed:', error);
    } finally {
      if (this.reconcileGuard.exit()) {
        this.reconcileBooks();
      }
    }
  }

  /**
   * Download covers for books that have uploadedAt but no local cover file.
   * Checks ALL library books, not just upserted ones, because uploadedAt
   * may arrive in a later reconciliation cycle after the book was first synced.
   */
  private async downloadMissingCovers(): Promise<void> {
    try {
      const appService = await envConfig.getAppService();
      const { getCoverFilename } = await import('@/utils/book');

      const library = useLibraryStore.getState().library;
      const candidates = library.filter((b) => b.uploadedAt && !b.coverImageUrl);
      const existResults = await Promise.all(
        candidates.map((book) => appService.exists(getCoverFilename(book), 'Books')),
      );
      const needsDownload = candidates.filter((_, i) => !existResults[i]);

      if (needsDownload.length > 0) {
        console.log(
          `[SyncWorker] Downloading covers for ${needsDownload.length} books:`,
          needsDownload.map((b) => b.title),
        );
        try {
          await appService.downloadBookCovers(needsDownload);
        } catch (dlErr) {
          console.error('[SyncWorker] Cover download failed:', dlErr);
          // Don't return — still generate URLs for books that already have files
        }
      }

      // Generate URLs for ALL candidates: both freshly downloaded and books
      // that already have the file locally but no URL. generateCoverImageUrl
      // returns null for books whose files don't exist (safe after download failure).
      const coverUrls = new Map<string, string>();
      await Promise.all(
        candidates.map(async (book) => {
          const coverUrl = await appService.generateCoverImageUrl(book);
          if (coverUrl) {
            coverUrls.set(book.hash, coverUrl);
          }
        }),
      );
      if (coverUrls.size > 0) {
        const currentLib = useLibraryStore.getState().library;
        const updated = currentLib.map((b) => {
          const url = coverUrls.get(b.hash);
          return url ? { ...b, coverImageUrl: url } : b;
        });
        useLibraryStore.getState().setLibrary(updated);
        await appService.saveLibraryBooks(updated);
        console.log(`[SyncWorker] Updated ${coverUrls.size} cover URLs in library`);
      }
    } catch (error) {
      console.error('[SyncWorker] Failed to download covers:', error);
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

      const booksToUpdate: Array<{
        hash: string;
        progress: BookConfig['progress'];
        updatedAt: number;
      }> = [];

      for (const config of configs) {
        if (!config.bookHash) continue;
        const book = bookByHash.get(config.bookHash);
        if (!book) continue;
        const bookKey = `${book.hash}-${book.format}`;
        const existing = bookDataStore.getConfig(bookKey);
        if (!existing || (config.updatedAt ?? 0) >= (existing.updatedAt ?? 0)) {
          const merged = { ...existing, ...config };
          // Discard malformed CFI location strings from remote
          if (merged.location && !merged.location.startsWith('epubcfi(')) {
            delete merged.location;
          }
          bookDataStore.setConfig(bookKey, merged);

          // Also store in pre-synced cache so initViewState can merge the location
          // before FoliateViewer initializes (avoids flash from page 1). See #62.
          bookDataStore.setPreSyncedConfig(config.bookHash, merged);

          // Sync progress from config back to library book for card display
          if (config.progress) {
            booksToUpdate.push({
              hash: book.hash,
              progress: config.progress,
              updatedAt: Date.now(),
            });
          }
        }
      }

      // Batch-update library books with synced progress only.
      // Merge only the changed fields (progress, updatedAt) into current state —
      // never spread a stale full-book snapshot which would clobber fields set
      // concurrently by downloadMissingCovers (e.g., coverImageUrl). See #63.
      if (booksToUpdate.length > 0) {
        const currentLibrary = useLibraryStore.getState().library;
        const updateMap = new Map(booksToUpdate.map((b) => [b.hash, b]));
        const updatedLibrary = currentLibrary.map((b) => {
          const update = updateMap.get(b.hash);
          if (!update) return b;
          return { ...b, progress: update.progress, updatedAt: update.updatedAt };
        });
        useLibraryStore.getState().setLibrary(updatedLibrary);
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
            const remoteTime = Math.max(note.updatedAt ?? 0, note.deletedAt ?? 0);
            const localTime = Math.max(
              mergedNotes[idx]!.updatedAt ?? 0,
              mergedNotes[idx]!.deletedAt ?? 0,
            );
            if (remoteTime > localTime) {
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
   * Pull AI conversations and messages from Supabase for the active book.
   * Merges into IndexedDB (LWW by updatedAt), then refreshes Zustand store.
   * Uses coalescing guard to prevent duplicate pulls from rapid broadcasts.
   */
  private async pullRemoteAIConversations(): Promise<void> {
    if (isOffline() || !this.userId) return;

    const bookHash = useAIChatStore.getState().currentBookHash;
    if (!bookHash) return;

    if (!this.aiPullGuard.tryEnter()) return;

    try {
      const sb = await this.getAuthenticatedSupabase();
      if (!sb) return;

      // Pull conversations for this book
      const { data: remoteConversations, error: convError } = await sb
        .from('ai_conversations')
        .select('*')
        .eq('book_hash', bookHash)
        .eq('user_id', this.userId);

      if (convError) {
        console.error('[SyncWorker] Pull AI conversations failed:', convError.message);
        return;
      }

      if (!remoteConversations || remoteConversations.length === 0) return;

      // Get local conversations (including soft-deleted) for LWW merge
      const localConversations = await aiStore.getAllConversations(bookHash);
      const localMap = new Map(localConversations.map((c) => [c.id, c]));

      // Merge: remote wins if updatedAt is newer (LWW)
      const merged: AIConversation[] = [];
      for (const remote of remoteConversations as SupabaseAIConversation[]) {
        const local = localMap.get(remote.id);
        const remoteConv: AIConversation = {
          id: remote.id,
          bookHash: remote.book_hash,
          title: remote.title,
          createdAt: new Date(remote.created_at).getTime(),
          updatedAt: new Date(remote.updated_at).getTime(),
          deletedAt: remote.deleted_at ? new Date(remote.deleted_at).getTime() : undefined,
        };

        if (!local || remoteConv.updatedAt > local.updatedAt) {
          merged.push(remoteConv);
        }
      }

      if (merged.length > 0) {
        await aiStore.upsertConversations(merged);
      }

      // Pull messages for all conversations
      const conversationIds = (remoteConversations as SupabaseAIConversation[]).map((c) => c.id);
      let newMessages: AIMessage[] = [];
      if (conversationIds.length > 0) {
        const { data: remoteMessages, error: msgError } = await sb
          .from('ai_messages')
          .select('*')
          .in('conversation_id', conversationIds)
          .eq('user_id', this.userId)
          .order('created_at', { ascending: true })
          .limit(1000);

        if (msgError) {
          console.error('[SyncWorker] Pull AI messages failed:', msgError.message);
          return;
        }

        if (remoteMessages && remoteMessages.length > 0) {
          const localMessageArrays = await Promise.all(
            conversationIds.map((id) => aiStore.getMessages(id)),
          );
          const localMsgIds = new Set(localMessageArrays.flat().map((m) => m.id));

          newMessages = (remoteMessages as SupabaseAIMessage[])
            .filter((m) => !localMsgIds.has(m.id))
            .map((m) => ({
              id: m.id,
              conversationId: m.conversation_id,
              role: m.role as 'user' | 'assistant',
              content: m.content,
              createdAt: new Date(m.created_at).getTime(),
            }));

          if (newMessages.length > 0) {
            await aiStore.upsertMessages(newMessages);
          }
        }
      }

      // Refresh Zustand store only if remote data introduced actual changes.
      // Skipping no-op updates prevents cascading re-renders that can
      // trigger pushes → broadcasts → pulls → infinite loop.
      if (merged.length > 0) {
        const { currentBookHash, conversations: existing } = useAIChatStore.getState();
        if (currentBookHash === bookHash) {
          const freshConversations = await aiStore.getConversations(bookHash);
          const changed =
            freshConversations.length !== existing.length ||
            freshConversations.some(
              (c, i) => c.id !== existing[i]?.id || c.updatedAt !== existing[i]?.updatedAt,
            );
          if (changed) {
            useAIChatStore.setState({ conversations: freshConversations });
          }
        }
      }
      if (newMessages.length > 0) {
        const { activeConversationId, messages: existingMsgs } = useAIChatStore.getState();
        if (
          activeConversationId &&
          newMessages.some((m) => m.conversationId === activeConversationId)
        ) {
          const freshMessages = await aiStore.getMessages(activeConversationId);
          const changed =
            freshMessages.length !== existingMsgs.length ||
            freshMessages.some((m, i) => m.id !== existingMsgs[i]?.id);
          if (changed) {
            useAIChatStore.setState({ messages: freshMessages });
          }
        }
      }
    } catch (error) {
      console.error('[SyncWorker] Pull AI conversations error:', error);
    } finally {
      if (this.aiPullGuard.exit()) {
        this.pullRemoteAIConversations();
      }
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
          this.broadcast(SYNC_EVENTS.BOOKS);
          return true;
        case 'config':
          await this.syncClient.pushChanges({ configs: [item.payload] });
          this.broadcast(SYNC_EVENTS.CONFIGS);
          return true;
        case 'note':
          await this.syncClient.pushChanges({ notes: [item.payload] });
          this.broadcast(SYNC_EVENTS.NOTES);
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
  broadcast(event: string): void {
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
