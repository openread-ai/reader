import { create } from 'zustand';
import { SystemSettings } from '@/types/settings';
import { Book, BookConfig, BookNote } from '@/types/book';
import { EnvConfigType } from '@/services/environment';
import { BookDoc } from '@/libs/document';
import { useLibraryStore } from './libraryStore';
import { createLogger } from '@/utils/logger';

const logger = createLogger('bookDataStore');

interface BookData {
  /* Persistent data shared with different views of the same book */
  id: string;
  book: Book | null;
  file: File | null;
  config: BookConfig | null;
  bookDoc: BookDoc | null;
  isFixedLayout: boolean;
}

interface BookDataState {
  booksData: { [id: string]: BookData };
  /** Configs received from pullRemoteConfigs before the book is opened in the reader.
   *  Keyed by bookHash. Consumed (cleared) by initViewState when the book opens. */
  preSyncedConfigs: { [bookHash: string]: Partial<BookConfig> };
  getConfig: (key: string | null) => BookConfig | null;
  setConfig: (key: string, partialConfig: Partial<BookConfig>) => void;
  setPreSyncedConfig: (bookHash: string, config: Partial<BookConfig>) => void;
  consumePreSyncedConfig: (bookHash: string) => Partial<BookConfig> | null;
  saveConfig: (
    envConfig: EnvConfigType,
    bookKey: string,
    config: BookConfig,
    settings: SystemSettings,
  ) => void;
  updateBooknotes: (key: string, booknotes: BookNote[]) => BookConfig | undefined;
  getBookData: (keyOrId: string) => BookData | null;
  clearBookData: (keyOrId: string) => void;
}

export const useBookDataStore = create<BookDataState>((set, get) => ({
  booksData: {},
  preSyncedConfigs: {},
  setPreSyncedConfig: (bookHash: string, config: Partial<BookConfig>) => {
    set((state) => {
      const updated = { ...state.preSyncedConfigs, [bookHash]: config };
      // Cap at 50 entries to prevent unbounded growth
      const keys = Object.keys(updated);
      if (keys.length > 50) {
        delete updated[keys[0]!];
      }
      return { preSyncedConfigs: updated };
    });
  },
  consumePreSyncedConfig: (bookHash: string) => {
    // Atomic read-and-delete inside a single set call
    let consumed: Partial<BookConfig> | null = null;
    set((state) => {
      consumed = state.preSyncedConfigs[bookHash] ?? null;
      if (consumed) {
        const { [bookHash]: _, ...rest } = state.preSyncedConfigs;
        return { preSyncedConfigs: rest };
      }
      return state;
    });
    return consumed;
  },
  getBookData: (keyOrId: string) => {
    const id = keyOrId.split('-')[0]!;
    return get().booksData[id] || null;
  },
  clearBookData: (keyOrId: string) => {
    const id = keyOrId.split('-')[0]!;
    set((state) => {
      const newBooksData = { ...state.booksData };
      delete newBooksData[id];
      return {
        booksData: newBooksData,
      };
    });
  },
  getConfig: (key: string | null) => {
    if (!key) return null;
    const id = key.split('-')[0]!;
    return get().booksData[id]?.config || null;
  },
  setConfig: (key: string, partialConfig: Partial<BookConfig>) => {
    set((state: BookDataState) => {
      const id = key.split('-')[0]!;
      const config = (state.booksData[id]?.config || null) as BookConfig;
      if (!config) {
        logger.warn('No config found for book', id);
        return state;
      }
      Object.assign(config, partialConfig);
      return {
        booksData: {
          ...state.booksData,
          [id]: {
            ...state.booksData[id]!,
            config,
          },
        },
      };
    });
  },
  saveConfig: async (
    envConfig: EnvConfigType,
    bookKey: string,
    config: BookConfig,
    settings: SystemSettings,
  ) => {
    const appService = await envConfig.getAppService();
    const { library, setLibrary } = useLibraryStore.getState();
    const bookIndex = library.findIndex((b) => b.hash === bookKey.split('-')[0]);
    if (bookIndex == -1) return;
    const book = library.splice(bookIndex, 1)[0]!;
    book.progress = config.progress;
    book.updatedAt = Date.now();
    book.downloadedAt = book.downloadedAt || Date.now();
    library.unshift(book);
    setLibrary([...library]);
    config.updatedAt = Date.now();
    await appService.saveBookConfig(book, config, settings);
    await appService.saveLibraryBooks(library);
  },
  updateBooknotes: (key: string, booknotes: BookNote[]) => {
    let updatedConfig: BookConfig | undefined;
    set((state) => {
      const id = key.split('-')[0]!;
      const book = state.booksData[id];
      if (!book) return state;
      const dedupedBooknotes = Array.from(
        new Map(booknotes.map((item) => [`${item.id}-${item.type}-${item.cfi}`, item])).values(),
      );
      updatedConfig = {
        ...book.config,
        updatedAt: Date.now(),
        booknotes: dedupedBooknotes,
      };
      return {
        booksData: {
          ...state.booksData,
          [id]: {
            ...book,
            config: {
              ...book.config,
              updatedAt: Date.now(),
              booknotes: dedupedBooknotes,
            },
          },
        },
      };
    });
    return updatedConfig;
  },
}));
