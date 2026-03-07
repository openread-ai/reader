# Sync Manual Test Checklist

> **Setup**: Two devices (Web + Desktop, or two browser tabs). **A** and **B** below. Same account on both.
>
> **Last tested**: 2026-03-04 | **MCP version**: @openread/mcp@0.0.1-test.9
>
> **Sync model**: Books use hash-based reconciliation (no tombstones). Notes, configs, collections keep watermark-based sync with `deletedAt`.

---

## Phase 1: Book Reconciliation (NEW — priority)

> These tests verify the core change: books sync via hash-based reconciliation instead of tombstones.
> Open DevTools → Network tab. Filter for `/api/sync`. Watch request/response bodies.

### Reconciliation Protocol

- [ ] On page load, `POST /api/sync` includes `reconcile.books` in request body (hash→timestamp map).
- [ ] Response includes `reconcile.upsert` (array) and `reconcile.remove` (array of hashes).
- [ ] When library is in sync, both `upsert` and `remove` are empty arrays.

### Create → Reconcile

- [ ] Import a book on A. Wait 10s. Refresh B. Book appears via `reconcile.upsert`.
- [ ] Import on B. Wait 10s. Refresh A. Book appears.
- [ ] Import same book on both devices. No duplicate — one copy, latest metadata.

### Delete → Reconcile

- [ ] Delete a book on A (permanent delete). Check Network tab — `DELETE /api/sync?book_hash=X` fires.
- [ ] Wait 10s or refresh B. Book disappears. Network tab shows hash in `reconcile.remove`.
- [ ] Verify in Supabase: `SELECT * FROM books WHERE book_hash = '<hash>'` returns **no rows** (hard-deleted, not tombstoned).
- [ ] Bulk delete 3+ books on A. All disappear on B.
- [ ] Delete then re-import same file. Book reappears on both devices as a fresh entry.

### Update → Reconcile

- [ ] Rename a book on A. Wait 10s. B shows updated title (via `reconcile.upsert` with newer timestamp).
- [ ] Change reading status on A. Status shows on B.
- [ ] Bulk status change on A (multiple books). All update on B.

### Server State

- [ ] After delete on A, server has no `books` row for that hash.
- [ ] After delete on A, `book_configs` and `book_notes` for that hash are also deleted (DELETE endpoint cleans them).
- [ ] `files` metadata for that hash is deleted.
- [ ] AI conversations for that hash are deleted.

---

## Phase 2: Configs & Notes (unchanged — verify no regressions)

### Reading Progress

- [ ] Read to page 50 on A, close book. Open on B — jumps to page 50.
- [ ] Read to page 80 on A, then go back to page 20. Open on B — reflects page 20.
- [ ] Read several pages on A with B open on same book. B's progress updates within ~3s.

### Book Settings

- [ ] Change font size on A. Open same book on B — font size matches.
- [ ] Change progress on A + change view settings on B simultaneously. Both survive (field-level LWW).

### Notes

- [ ] Highlight text on A. Open book on B — highlight appears with correct color/style.
- [ ] Add a bookmark on A. Appears on B.
- [ ] Add an annotation on A. Note text appears on B.
- [ ] Edit annotation text on A. Updated text on B.
- [ ] Delete a highlight on A. Gone on B. _(Notes still use `deletedAt` — this is unchanged.)_

---

## Phase 3: Other Entity Sync (unchanged — verify no regressions)

### AI Conversations

- [ ] Start a new AI chat on A. Open AI panel on B — conversation appears.
- [ ] Delete a conversation on A. Disappears on B.

### User Settings

- [ ] Change theme on A. B matches.
- [ ] `lastSyncedAt*` timestamps stay per-device (not roaming).

### Collections

- [ ] Create a collection on A. Appears on B.
- [ ] Add book to collection on A. Reflected on B.

### Credentials

- [ ] Add BYOK API key on A. B can use it for AI chat.
- [ ] Delete key on A. B no longer has it.

---

## Phase 4: Offline & Edge Cases

### Offline

- [ ] Go offline on A (DevTools → Network → Offline). Delete a book. Go back online. Deletion syncs to B.
- [ ] Delete on A while B is offline. Bring B online — book disappears via reconciliation.
- [ ] Full offline session on A: import, highlight, change status, delete a book. Come online — ALL sync to B.

### Conflict Resolution

- [ ] Delete book on A + edit title on B simultaneously. Next reconciliation on B: book is gone (server has no row → `reconcile.remove` wins).
- [ ] Same field edited on both devices. Later write wins on both (LWW).
- [ ] Rename on A + change status on B simultaneously. Both changes survive (field-level LWW).

### Scale

- [ ] 500+ book library syncs within 60s.
- [ ] Book with 200+ highlights syncs without truncation.
- [ ] Rapid-fire: change status on 20 books quickly. All sync.

### Auth

- [ ] Sign out during sync — no crash or corruption.
- [ ] Switch accounts — old data gone, new data loads.

### Platform

- [ ] Web-to-Desktop and Desktop-to-Web CRUD sync both work.
- [ ] Desktop Realtime works (or falls back to polling gracefully).

---

## Phase 5: Regression Guards

- [ ] Library page load: `POST /api/sync` with `reconcile.books` in body (reconciliation replaced the old `GET`-only pull for books).
- [ ] Configs/notes still use `GET /api/sync?type=configs&since=X` watermark pull.
- [ ] Delete on A, refresh B immediately — book doesn't ghost-restore on A.
- [ ] No console errors containing `[SyncWorker]` or `Reconciliation failed`.
- [ ] No `getTrashBooks` or `maybeAutoPurge` calls in console (removed code).
- [ ] Desktop launch: console shows "Migration 20251029: old Images dir not found, skipping" (not "Permission denied").

---

## Phase 6: Database & MCP

### Database

- [x] `trigger_books_updated_at` dropped. ✅ 2026-03-04
- [x] `sync_books_atomic` RPC updated (returns only changed records). ✅ 2026-03-04
- [x] `user_settings` table created with RLS. ✅ 2026-03-04
- [x] MCP read-only RLS policies on 7 tables. ✅ 2026-03-04
- [ ] `reconcile_books` RPC exists (documentation-only, not called by app).
- [ ] `cascade_book_soft_delete` trigger still exists (backward compat for old clients).
- [ ] `cleanup_tombstones` RPC still exists (used by admin endpoint for notes/configs).

### MCP Server

- [x] `list_books` returns correct data. ✅ 2026-03-04
- [ ] `search_book` returns matching results.
- [ ] `get_chapter` returns chapter content.
- [ ] Deleted books excluded from all MCP queries (server uses `deleted_at IS NULL`).
- [ ] MCP token cannot INSERT/UPDATE/DELETE books table (RLS rejects).

---

> **Environment**: Web + Desktop, normal + offline network, pre-seed 5-10 books with highlights. Keep DevTools → Network + Console open.
>
> **What to watch in Network tab**:
>
> - `POST /api/sync` request body should contain `reconcile.books: { "<hash>": <timestamp>, ... }`
> - Response should contain `reconcile: { upsert: [...], remove: [...] }`
> - `DELETE /api/sync?book_hash=X` should return `{ ok: true }`
