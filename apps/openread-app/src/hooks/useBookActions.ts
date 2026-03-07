'use client';

import { useCallback } from 'react';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlatformSidebarStore } from '@/store/platformSidebarStore';
import { useLibraryViewStore } from '@/store/libraryViewStore';
import { eventDispatcher } from '@/utils/event';
import envConfig from '@/services/environment';
import { enqueueAndSync, enqueueBatchAndSync } from '@/services/sync/helpers';
import { useBookDataStore } from '@/store/bookDataStore';
import type { Book, ReadingStatus } from '@/types/book';
import { createLogger } from '@/utils/logger';

const logger = createLogger('bookActions');

/** Cast a Book to the queue payload format. */
function bookPayload(book: Book): Record<string, unknown> {
  return book as unknown as Record<string, unknown>;
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

  /**
   * Soft delete a book by setting deletedAt timestamp.
   * Uses optimistic update: UI updates immediately, persistence happens in background.
   * On failure, library is rolled back to its previous state.
   */
  const removeBook = useCallback(
    (book: Book) => {
      // Snapshot current library for rollback
      const snapshot = useLibraryStore.getState().library.slice();

      const updatedBook: Book = {
        ...book,
        deletedAt: Date.now(),
        updatedAt: Date.now(),
      };

      // Fire-and-forget: updateBook sets state synchronously, then persists async.
      // We attach a catch handler for rollback instead of awaiting.
      updateBook(envConfig, updatedBook).catch((error) => {
        logger.error('Failed to remove book, rolling back:', error);
        try {
          useLibraryStore.getState().setLibrary(snapshot);
        } catch (rollbackError) {
          logger.error('Rollback also failed:', rollbackError);
        }
        eventDispatcher.dispatch('toast', {
          type: 'error',
          message: 'Failed to remove book',
        });
      });

      enqueueAndSync({ type: 'book', action: 'delete', payload: bookPayload(updatedBook) });
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
   * Soft delete multiple books.
   * Uses optimistic update: clears selection and exits select mode immediately.
   * On failure, library is rolled back to its previous state.
   */
  const bulkRemove = useCallback(
    (hashes: string[]) => {
      // Snapshot current library for rollback
      const snapshot = useLibraryStore.getState().library.slice();

      const deletedAt = Date.now();
      const updatePromises = hashes
        .map((hash) => {
          const book = getBookByHash(hash);
          if (!book) return null;

          const updatedBook: Book = {
            ...book,
            deletedAt,
            updatedAt: deletedAt,
          };
          return updateBook(envConfig, updatedBook);
        })
        .filter(Boolean);

      // Clear selection and exit select mode immediately (optimistic)
      clearSelection();
      setSelectMode(false);

      // Fire-and-forget: persist in background, rollback on failure
      Promise.all(updatePromises).catch((error) => {
        logger.error('Failed to remove books, rolling back:', error);
        try {
          useLibraryStore.getState().setLibrary(snapshot);
        } catch (rollbackError) {
          logger.error('Rollback also failed:', rollbackError);
        }
        eventDispatcher.dispatch('toast', {
          type: 'error',
          message: `Failed to remove ${hashes.length > 1 ? 'books' : 'book'}`,
        });
      });

      // Enqueue all deleted books in a single batch
      const items = hashes
        .map((hash) => {
          const book = getBookByHash(hash);
          if (!book) return null;
          return {
            type: 'book' as const,
            action: 'delete' as const,
            payload: bookPayload({ ...book, deletedAt, updatedAt: deletedAt }),
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);
      enqueueBatchAndSync(items);
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
   * Permanently delete a book: hard-delete from library, server configs/notes, and storage.
   * Unlike removeBook (soft-delete), this is irreversible — re-importing the same file starts fresh.
   */
  const permanentlyDeleteBook = useCallback(async (book: Book) => {
    try {
      const appService = await envConfig.getAppService();

      // Delete local + cloud files
      await appService.deleteBook(book, 'both');

      // Remove from library entirely (not soft-delete)
      const { library, setLibrary } = useLibraryStore.getState();
      const remaining = library.filter((b) => b.hash !== book.hash);
      setLibrary(remaining);
      appService.saveLibraryBooks(remaining);

      // Push a tombstone with deletedAt to sync deletion to other devices
      const tombstone: Book = { ...book, deletedAt: Date.now(), updatedAt: Date.now() };
      enqueueAndSync({ type: 'book', action: 'delete', payload: bookPayload(tombstone) });

      // Clear local book data (configs, notes, highlights)
      const bookKey = `${book.hash}-${book.format}`;
      useBookDataStore.getState().setConfig(bookKey, { booknotes: [], progress: undefined });
    } catch (error) {
      logger.error('Failed to permanently delete book:', error);
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: 'Failed to permanently delete book',
      });
    }
  }, []);

  return {
    // Single actions
    setReadingStatus,
    renameBook,
    removeBook,
    permanentlyDeleteBook,
    // Bulk actions
    bulkSetReadingStatus,
    bulkRemove,
    bulkAddToCollection,
  };
}
