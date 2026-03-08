'use client';

import { useCallback } from 'react';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlatformSidebarStore } from '@/store/platformSidebarStore';
import { useLibraryViewStore } from '@/store/libraryViewStore';
import { eventDispatcher } from '@/utils/event';
import envConfig from '@/services/environment';
import { enqueueAndSync, enqueueBatchAndSync } from '@/services/sync/helpers';
import { useBookDataStore } from '@/store/bookDataStore';
import { getAccessToken } from '@/utils/access';
import type { Book, ReadingStatus } from '@/types/book';
import { createLogger } from '@/utils/logger';

const logger = createLogger('bookActions');

/** Cast a Book to the queue payload format. */
function bookPayload(book: Book): Record<string, unknown> {
  return book as unknown as Record<string, unknown>;
}

/**
 * Background cleanup for a permanently deleted book.
 * Runs after the book is already removed from the UI — all steps are best-effort.
 */
async function cleanupDeletedBook(book: Book, remainingLibrary: Book[]): Promise<void> {
  try {
    const appService = await envConfig.getAppService();

    // Save updated library, remove from collections, delete files — all in parallel
    const [, , sidebarStore] = await Promise.all([
      appService.saveLibraryBooks(remainingLibrary),
      appService.deleteBook(book, 'both').catch(() => {}),
      import('@/store/platformSidebarStore'),
    ]);

    // Remove from all collections
    const { collections, removeBookFromCollection } =
      sidebarStore.usePlatformSidebarStore.getState();
    for (const col of collections) {
      if (col.bookHashes.includes(book.hash)) {
        removeBookFromCollection(col.id, book.hash);
      }
    }

    // Delete local config directory
    appService.deleteDir(`${book.hash}`, 'Books').catch(() => {});

    // Delete AI conversations from IndexedDB
    import('@/services/ai/storage/aiStore')
      .then(async ({ aiStore }) => {
        const conversations = await aiStore.getConversations(book.hash);
        for (const conv of conversations) {
          await aiStore.deleteConversation(conv.id);
        }
      })
      .catch(() => {});

    // Hard-delete server-side data, then broadcast to other devices
    getAccessToken().then((token) => {
      if (token) {
        fetch(`/api/sync?book_hash=${encodeURIComponent(book.hash)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        })
          .then(() => import('@/services/sync/syncWorker'))
          .then(({ syncWorker }) => syncWorker.broadcast('books-changed'))
          .catch(() => {});
      }
    });
  } catch (error) {
    createLogger('bookActions').error('Background cleanup failed:', error);
  }
}

/**
 * Hook that provides book mutation actions for single and bulk operations.
 * All mutations go through libraryStore.updateBook() for consistency.
 */
export function useBookActions() {
  const library = useLibraryStore((state) => state.library);
  const updateBook = useLibraryStore((state) => state.updateBook);
  const addBookToCollection = usePlatformSidebarStore((state) => state.addBookToCollection);
  const clearSelection = useLibraryViewStore((state) => state.clearSelection);
  const setSelectMode = useLibraryViewStore((state) => state.setSelectMode);

  /**
   * Helper to get a book by hash and apply updates
   */
  const getBookByHash = useCallback(
    (hash: string): Book | undefined => {
      return library.find((b) => b.hash === hash);
    },
    [library],
  );

  // Single book actions

  /**
   * Update the reading status of a book
   */
  const setReadingStatus = useCallback(
    async (book: Book, status: ReadingStatus) => {
      try {
        const updatedBook: Book = {
          ...book,
          readingStatus: status,
          updatedAt: Date.now(),
        };
        await updateBook(envConfig, updatedBook);
        enqueueAndSync({ type: 'book', action: 'upsert', payload: bookPayload(updatedBook) });
      } catch (error) {
        logger.error('Failed to update reading status:', error);
        eventDispatcher.dispatch('toast', {
          type: 'error',
          message: 'Failed to update reading status',
        });
        throw error;
      }
    },
    [updateBook],
  );

  /**
   * Rename a book's title.
   * Does nothing if the new title is empty after trimming.
   */
  const renameBook = useCallback(
    async (book: Book, newTitle: string) => {
      const trimmedTitle = newTitle.trim();
      if (!trimmedTitle) return;

      try {
        const updatedBook: Book = {
          ...book,
          title: trimmedTitle,
          updatedAt: Date.now(),
        };
        await updateBook(envConfig, updatedBook);
        enqueueAndSync({ type: 'book', action: 'upsert', payload: bookPayload(updatedBook) });
      } catch (error) {
        logger.error('Failed to rename book:', error);
        eventDispatcher.dispatch('toast', {
          type: 'error',
          message: 'Failed to rename book',
        });
        throw error;
      }
    },
    [updateBook],
  );

  // Bulk actions

  /**
   * Update reading status for multiple books.
   * Clears selection and exits select mode after completion.
   */
  const bulkSetReadingStatus = useCallback(
    async (hashes: string[], status: ReadingStatus) => {
      try {
        const updatedAt = Date.now();
        const updatedBooks: Book[] = [];
        const updatePromises = hashes
          .map((hash) => {
            const book = getBookByHash(hash);
            if (!book) return null;

            const updatedBook: Book = {
              ...book,
              readingStatus: status,
              updatedAt,
            };
            updatedBooks.push(updatedBook);
            return updateBook(envConfig, updatedBook);
          })
          .filter(Boolean);

        await Promise.all(updatePromises);

        enqueueBatchAndSync(
          updatedBooks.map((b) => ({
            type: 'book' as const,
            action: 'upsert' as const,
            payload: bookPayload(b),
          })),
        );

        clearSelection();
        setSelectMode(false);
      } catch (error) {
        logger.error('Failed to update reading status:', error);
        eventDispatcher.dispatch('toast', {
          type: 'error',
          message: `Failed to update ${hashes.length > 1 ? 'books' : 'book'}`,
        });
        throw error;
      }
    },
    [getBookByHash, updateBook, clearSelection, setSelectMode],
  );

  /**
   * Add multiple books to a collection
   * Clears selection and exits select mode after completion
   */
  const bulkAddToCollection = useCallback(
    (hashes: string[], collectionId: string) => {
      hashes.forEach((hash) => {
        addBookToCollection(collectionId, hash);
      });
      clearSelection();
      setSelectMode(false);
    },
    [addBookToCollection, clearSelection, setSelectMode],
  );

  /**
   * Permanently delete a book: instant UI removal, background cleanup.
   * This is irreversible — re-importing the same file starts fresh.
   */
  const permanentlyDeleteBook = useCallback(async (book: Book) => {
    // Instant: remove from UI + collections + in-memory store
    const { library, setLibrary } = useLibraryStore.getState();
    const remaining = library.filter((b) => b.hash !== book.hash);
    setLibrary(remaining);

    const bookKey = `${book.hash}-${book.format}`;
    useBookDataStore.getState().setConfig(bookKey, { booknotes: [], progress: undefined });

    // Background: clean up all layers (best-effort, non-blocking)
    cleanupDeletedBook(book, remaining);
  }, []);

  /**
   * Permanently delete multiple books.
   * Instant UI removal for all, then background cleanup.
   */
  const bulkRemove = useCallback(
    (hashes: string[]) => {
      const books = hashes.map((hash) => getBookByHash(hash)).filter(Boolean) as Book[];
      if (books.length === 0) return;

      clearSelection();
      setSelectMode(false);

      // Instant: remove all from UI at once
      const hashSet = new Set(hashes);
      const { library, setLibrary } = useLibraryStore.getState();
      const remaining = library.filter((b) => !hashSet.has(b.hash));
      setLibrary(remaining);

      for (const book of books) {
        const bookKey = `${book.hash}-${book.format}`;
        useBookDataStore.getState().setConfig(bookKey, { booknotes: [], progress: undefined });
      }

      // Background: clean up all books in parallel
      for (const book of books) {
        cleanupDeletedBook(book, remaining);
      }
    },
    [getBookByHash, clearSelection, setSelectMode],
  );

  return {
    // Single actions
    setReadingStatus,
    renameBook,
    permanentlyDeleteBook,
    // Bulk actions
    bulkSetReadingStatus,
    bulkRemove,
    bulkAddToCollection,
  };
}
