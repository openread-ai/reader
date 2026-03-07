import { create } from 'zustand';
import { Book, BookGroupType, BooksGroup } from '@/types/book';
import { EnvConfigType, isTauriAppPlatform } from '@/services/environment';
import { BOOK_UNGROUPED_NAME } from '@/services/constants';
import { md5Fingerprint } from '@/utils/md5';

interface LibraryState {
  library: Book[];
  libraryLoaded: boolean;
  isSyncing: boolean;
  syncProgress: number;
  /** P9.21: Timestamp of last successful sync (ms since epoch) */
  lastSyncAt: number | null;
  /** P9.21: Last sync error message, null if last sync succeeded */
  syncError: string | null;
  /** P9.21: Set of book hashes with unsaved local changes */
  dirtyBooks: Set<string>;
  checkOpenWithBooks: boolean;
  checkLastOpenBooks: boolean;
  currentBookshelf: (Book | BooksGroup)[];
  selectedBooks: Set<string>; // hashes for books, ids for groups
  groups: Record<string, string>;
  setIsSyncing: (syncing: boolean) => void;
  setSyncProgress: (progress: number) => void;
  setLastSyncAt: (timestamp: number | null) => void;
  setSyncError: (error: string | null) => void;
  markBookDirty: (hash: string) => void;
  clearDirtyBooks: () => void;
  setSelectedBooks: (ids: string[]) => void;
  getSelectedBooks: () => string[];
  toggleSelectedBook: (id: string) => void;
  getVisibleLibrary: () => Book[];
  setCheckOpenWithBooks: (check: boolean) => void;
  setCheckLastOpenBooks: (check: boolean) => void;
  setLibrary: (books: Book[]) => void;
  updateBook: (envConfig: EnvConfigType, book: Book) => Promise<void>;
  updateBooks: (envConfig: EnvConfigType, books: Book[]) => Promise<void>;
  setCurrentBookshelf: (bookshelf: (Book | BooksGroup)[]) => void;
  refreshGroups: () => void;
  addGroup: (name: string) => BookGroupType;
  getGroups: () => BookGroupType[];
  getGroupId: (path: string) => string | undefined;
  getGroupName: (id: string) => string | undefined;
  getParentPath: (path: string) => string | undefined;
  getGroupsByParent: (parentPath?: string) => BookGroupType[];
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  library: [],
  libraryLoaded: false,
  isSyncing: false,
  syncProgress: 0,
  lastSyncAt: null,
  syncError: null,
  dirtyBooks: new Set(),
  currentBookshelf: [],
  selectedBooks: new Set(),
  groups: {},
  checkOpenWithBooks: isTauriAppPlatform(),
  checkLastOpenBooks: isTauriAppPlatform(),

  setIsSyncing: (syncing: boolean) => set({ isSyncing: syncing }),
  setSyncProgress: (progress: number) => set({ syncProgress: progress }),
  setLastSyncAt: (timestamp: number | null) => set({ lastSyncAt: timestamp }),
  setSyncError: (error: string | null) => set({ syncError: error }),
  markBookDirty: (hash: string) => {
    const dirtyBooks = new Set(get().dirtyBooks);
    dirtyBooks.add(hash);
    set({ dirtyBooks });
  },
  clearDirtyBooks: () => set({ dirtyBooks: new Set() }),
  getVisibleLibrary: () => get().library,

  setCurrentBookshelf: (bookshelf: (Book | BooksGroup)[]) => {
    set({ currentBookshelf: bookshelf });
  },

  setCheckOpenWithBooks: (check) => set({ checkOpenWithBooks: check }),
  setCheckLastOpenBooks: (check) => set({ checkLastOpenBooks: check }),
  setLibrary: (books) => {
    const { refreshGroups } = get();
    set({ library: books, libraryLoaded: true });
    refreshGroups();
  },
  updateBook: async (envConfig: EnvConfigType, book: Book) => {
    const appService = await envConfig.getAppService();
    const { library } = get();
    const bookIndex = library.findIndex((b) => b.hash === book.hash);
    if (bookIndex !== -1) {
      library[bookIndex] = book;
    }
    set({ library: [...library] });
    await appService.saveLibraryBooks(library);
  },
  updateBooks: async (envConfig: EnvConfigType, books: Book[]) => {
    if (!books?.length) return;

    const appService = await envConfig.getAppService();
    const { library, refreshGroups } = get();

    const existingMap = new Map(library.map((b) => [b.hash, b]));
    const incomingHashes = new Set(books.map((b) => b.hash));
    const merged = books.map((b) => {
      const existing = existingMap.get(b.hash);
      if (!existing) return b;
      const localNewer = (existing.updatedAt || 0) > (b.updatedAt || 0);
      const winner = localNewer ? existing : { ...b, coverImageUrl: existing.coverImageUrl };
      return winner;
    });
    const newLibrary = [...library.filter((b) => !incomingHashes.has(b.hash)), ...merged];
    set({ library: newLibrary });
    refreshGroups();
    await appService.saveLibraryBooks(newLibrary);
  },

  setSelectedBooks: (ids: string[]) => {
    set({ selectedBooks: new Set(ids) });
  },

  getSelectedBooks: () => {
    return Array.from(get().selectedBooks);
  },

  toggleSelectedBook: (id: string) => {
    set((state) => {
      const newSelection = new Set(state.selectedBooks);
      if (newSelection.has(id)) {
        newSelection.delete(id);
      } else {
        newSelection.add(id);
      }
      return { selectedBooks: newSelection };
    });
  },

  refreshGroups: () => {
    const { library } = get();
    const groups: Record<string, string> = {};

    library.forEach((book) => {
      if (book.groupName && book.groupName !== BOOK_UNGROUPED_NAME) {
        groups[md5Fingerprint(book.groupName)] = book.groupName;
        let nextSlashIndex = book.groupName.indexOf('/', 0);
        while (nextSlashIndex > 0) {
          const groupName = book.groupName.substring(0, nextSlashIndex);
          groups[md5Fingerprint(groupName)] = groupName;
          nextSlashIndex = book.groupName.indexOf('/', nextSlashIndex + 1);
        }
      }
    });

    set({ groups });
  },

  addGroup: (name: string) => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new Error('Group name cannot be empty');
    }

    const id = md5Fingerprint(trimmedName);
    const { groups } = get();

    set({ groups: { ...groups, [id]: trimmedName } });

    return { id, name: trimmedName };
  },

  getGroups: () => {
    const { groups } = get();
    return Object.entries(groups)
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  getGroupId: (path: string) => {
    const { groups } = get();

    const directId = Object.entries(groups).find(([_, name]) => name === path)?.[0];
    if (directId) {
      return directId;
    }

    return md5Fingerprint(path);
  },

  getGroupName: (id: string) => {
    return get().groups[id];
  },

  getParentPath: (path: string) => {
    const lastSlashIndex = path.lastIndexOf('/');
    if (lastSlashIndex === -1) return '';
    return path.slice(0, lastSlashIndex);
  },

  getGroupsByParent: (parentPath?: string) => {
    const { groups } = get();
    const result: BookGroupType[] = [];
    Object.entries(groups).forEach(([id, name]) => {
      const groupParentPath = get().getParentPath(name);
      if (groupParentPath === (parentPath || '')) {
        result.push({ id, name });
      }
    });
    return result;
  },
}));
