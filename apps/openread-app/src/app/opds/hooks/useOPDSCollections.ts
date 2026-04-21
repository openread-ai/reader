'use client';

import { useCallback, useMemo } from 'react';
import { usePlatformSidebarStore, type Collection } from '@/store/platformSidebarStore';
import { useLibraryStore } from '@/store/libraryStore';
import type { Book } from '@/types/book';
import type { OPDSPublication } from '../types';
import { createLogger } from '@/utils/logger';

const logger = createLogger('opds-collections');

export interface UseOPDSCollectionsResult {
  collections: Collection[];
  isInCollection: (bookHash: string, collectionId: string) => boolean;
  getCollectionsFor: (bookHash: string) => Collection[];
  addToCollection: (bookHash: string, collectionId: string) => void;
  removeFromCollection: (bookHash: string, collectionId: string) => void;
  createCollection: (name: string) => Collection | null;
  createAndAdd: (name: string, bookHash?: string) => Collection | null;
  findExistingBook: (publication: OPDSPublication) => Book | null;
}

/**
 * Hook for integrating OPDS publications with the collection system.
 *
 * Provides collection CRUD, membership checks, and existing book detection
 * by matching OPDS publication identifiers against the library.
 */
export function useOPDSCollections(): UseOPDSCollectionsResult {
  const collections = usePlatformSidebarStore((state) => state.collections);
  const addCollectionStore = usePlatformSidebarStore((state) => state.addCollection);
  const addBookToCollection = usePlatformSidebarStore((state) => state.addBookToCollection);
  const removeBookFromCollection = usePlatformSidebarStore(
    (state) => state.removeBookFromCollection,
  );

  const library = useLibraryStore((state) => state.library);

  const activeBooks = useMemo(() => library.filter((b) => !b.deletedAt), [library]);

  const isInCollection = useCallback(
    (bookHash: string, collectionId: string): boolean => {
      const col = collections.find((c) => c.id === collectionId);
      return col?.bookHashes.includes(bookHash) ?? false;
    },
    [collections],
  );

  const getCollectionsFor = useCallback(
    (bookHash: string): Collection[] => {
      return collections.filter((c) => c.bookHashes.includes(bookHash));
    },
    [collections],
  );

  const addToCollection = useCallback(
    (bookHash: string, collectionId: string) => {
      addBookToCollection(collectionId, bookHash);
    },
    [addBookToCollection],
  );

  const removeFromCollection = useCallback(
    (bookHash: string, collectionId: string) => {
      removeBookFromCollection(collectionId, bookHash);
    },
    [removeBookFromCollection],
  );

  const createCollection = useCallback(
    (name: string): Collection | null => {
      if (!name.trim()) return null;
      try {
        return addCollectionStore(name.trim());
      } catch (e) {
        logger.warn('Failed to create collection', e);
        return null;
      }
    },
    [addCollectionStore],
  );

  const createAndAdd = useCallback(
    (name: string, bookHash?: string): Collection | null => {
      const collection = createCollection(name);
      if (collection && bookHash) {
        addToCollection(bookHash, collection.id);
      }
      return collection;
    },
    [createCollection, addToCollection],
  );

  const findExistingBook = useCallback(
    (publication: OPDSPublication): Book | null => {
      // Try by OPDS identifiers (ISBN, URN, etc.)
      if (publication.identifiers.length > 0) {
        for (const identifier of publication.identifiers) {
          const found = activeBooks.find((b) => {
            const bookMeta = b.metadata;
            if (!bookMeta) return false;
            // Check primary identifier match
            if (bookMeta.identifier === identifier.value) {
              return true;
            }
            // Check altIdentifier match
            if (bookMeta.altIdentifier) {
              if (typeof bookMeta.altIdentifier === 'string') {
                return bookMeta.altIdentifier === identifier.value;
              }
              if (Array.isArray(bookMeta.altIdentifier)) {
                return bookMeta.altIdentifier.includes(identifier.value);
              }
              // Identifier object with scheme/value
              return bookMeta.altIdentifier.value === identifier.value;
            }
            return false;
          });
          if (found) return found;
        }
      }

      // Fallback: match by title + author (case-insensitive)
      const pubTitle = publication.title.toLowerCase().trim();
      if (!pubTitle) return null;

      return (
        activeBooks.find((b) => {
          if (b.title.toLowerCase().trim() !== pubTitle) return false;
          if (publication.authors.length === 0) return true;
          // At least one author must match
          const bookAuthor = b.author?.toLowerCase().trim() ?? '';
          return publication.authors.some((pa) =>
            bookAuthor.includes(pa.name.toLowerCase().trim()),
          );
        }) ?? null
      );
    },
    [activeBooks],
  );

  return {
    collections,
    isInCollection,
    getCollectionsFor,
    addToCollection,
    removeFromCollection,
    createCollection,
    createAndAdd,
    findExistingBook,
  };
}
