import { useEffect, useRef } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useLibraryStore } from '@/store/libraryStore';
import { PLATFORM_BOOKS_MANIFEST, PLATFORM_BOOKS_SEEDED_KEY } from '@/services/platformBooks';
import { createLogger } from '@/utils/logger';

const logger = createLogger('platform-books');

export function usePlatformBooks() {
  const { appService } = useEnv();
  const libraryLoaded = useLibraryStore((s) => s.libraryLoaded);
  const seedingRef = useRef(false);

  useEffect(() => {
    if (!libraryLoaded || !appService || seedingRef.current) return;

    const visibleBooks = useLibraryStore.getState().library.filter((b) => !b.deletedAt);
    if (visibleBooks.length > 0) {
      if (!localStorage.getItem(PLATFORM_BOOKS_SEEDED_KEY)) {
        localStorage.setItem(PLATFORM_BOOKS_SEEDED_KEY, new Date().toISOString());
      }
      return;
    }

    if (localStorage.getItem(PLATFORM_BOOKS_SEEDED_KEY)) return;
    if (PLATFORM_BOOKS_MANIFEST.length === 0) {
      localStorage.setItem(PLATFORM_BOOKS_SEEDED_KEY, new Date().toISOString());
      return;
    }

    seedingRef.current = true;

    const seed = async () => {
      try {
        const res = await fetch('/api/platform-books');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { books } = await res.json();

        for (const book of books) {
          try {
            const { library } = useLibraryStore.getState();
            await appService.importBook(book.downloadUrl, library);
          } catch (err) {
            logger.error('Failed to import platform book', { title: book.title, err });
          }
        }

        const { library } = useLibraryStore.getState();
        useLibraryStore.getState().setLibrary([...library]);
        await appService.saveLibraryBooks(library);
      } catch (err) {
        logger.error('Platform books seeding failed', err);
      } finally {
        localStorage.setItem(PLATFORM_BOOKS_SEEDED_KEY, new Date().toISOString());
      }
    };

    seed();
  }, [libraryLoaded, appService]);
}
