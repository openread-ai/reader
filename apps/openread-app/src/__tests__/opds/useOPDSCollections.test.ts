import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOPDSCollections } from '@/app/opds/hooks/useOPDSCollections';
import type { OPDSPublication } from '@/app/opds/types';

// Mock the stores
const mockCollections = [
  { id: 'col-1', name: 'Fiction', bookHashes: ['hash-a', 'hash-b'], createdAt: '2024-01-01' },
  { id: 'col-2', name: 'Science', bookHashes: ['hash-c'], createdAt: '2024-01-02' },
];

const mockLibrary = [
  {
    hash: 'hash-a',
    title: 'Test Book',
    author: 'Jane Doe',
    metadata: { identifier: '978-1234567890' },
  },
  { hash: 'hash-b', title: 'Another Book', author: 'John Smith', metadata: {} },
  {
    hash: 'hash-c',
    title: 'Science Book',
    author: 'Dr. Lab',
    metadata: { identifier: 'urn:uuid:12345' },
  },
];

const mockAddCollection = vi.fn().mockImplementation((name: string) => ({
  id: 'col-new',
  name,
  bookHashes: [],
  createdAt: new Date().toISOString(),
}));
const mockAddBookToCollection = vi.fn();
const mockRemoveBookFromCollection = vi.fn();

vi.mock('@/store/platformSidebarStore', () => ({
  usePlatformSidebarStore: vi.fn((selector: (state: unknown) => unknown) => {
    const state = {
      collections: mockCollections,
      addCollection: mockAddCollection,
      addBookToCollection: mockAddBookToCollection,
      removeBookFromCollection: mockRemoveBookFromCollection,
    };
    return selector(state);
  }),
}));

vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: vi.fn((selector: (state: unknown) => unknown) => {
    const state = { library: mockLibrary };
    return selector(state);
  }),
}));

function createPublication(overrides: Partial<OPDSPublication> = {}): OPDSPublication {
  return {
    id: 'pub-1',
    title: 'Test Book',
    authors: [{ name: 'Jane Doe' }],
    contributors: [],
    links: [],
    acquisitionLinks: [],
    images: [],
    identifiers: [{ scheme: 'isbn', value: '978-1234567890' }],
    subjects: [],
    ...overrides,
  };
}

describe('useOPDSCollections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return collections', () => {
    const { result } = renderHook(() => useOPDSCollections());
    expect(result.current.collections).toHaveLength(2);
    expect(result.current.collections[0]!.name).toBe('Fiction');
  });

  describe('isInCollection', () => {
    it('should return true when book is in collection', () => {
      const { result } = renderHook(() => useOPDSCollections());
      expect(result.current.isInCollection('hash-a', 'col-1')).toBe(true);
    });

    it('should return false when book is not in collection', () => {
      const { result } = renderHook(() => useOPDSCollections());
      expect(result.current.isInCollection('hash-a', 'col-2')).toBe(false);
    });

    it('should return false for unknown collection', () => {
      const { result } = renderHook(() => useOPDSCollections());
      expect(result.current.isInCollection('hash-a', 'col-unknown')).toBe(false);
    });
  });

  describe('getCollectionsFor', () => {
    it('should return collections containing the book', () => {
      const { result } = renderHook(() => useOPDSCollections());
      const cols = result.current.getCollectionsFor('hash-a');
      expect(cols).toHaveLength(1);
      expect(cols[0]!.id).toBe('col-1');
    });

    it('should return empty array for unknown book', () => {
      const { result } = renderHook(() => useOPDSCollections());
      expect(result.current.getCollectionsFor('hash-unknown')).toHaveLength(0);
    });
  });

  describe('addToCollection', () => {
    it('should call store addBookToCollection', () => {
      const { result } = renderHook(() => useOPDSCollections());
      act(() => {
        result.current.addToCollection('hash-a', 'col-2');
      });
      expect(mockAddBookToCollection).toHaveBeenCalledWith('col-2', 'hash-a');
    });
  });

  describe('removeFromCollection', () => {
    it('should call store removeBookFromCollection', () => {
      const { result } = renderHook(() => useOPDSCollections());
      act(() => {
        result.current.removeFromCollection('hash-a', 'col-1');
      });
      expect(mockRemoveBookFromCollection).toHaveBeenCalledWith('col-1', 'hash-a');
    });
  });

  describe('createCollection', () => {
    it('should create a new collection', () => {
      const { result } = renderHook(() => useOPDSCollections());
      let col: ReturnType<typeof result.current.createCollection>;
      act(() => {
        col = result.current.createCollection('New Collection');
      });
      expect(mockAddCollection).toHaveBeenCalledWith('New Collection');
      expect(col!).not.toBeNull();
      expect(col!.name).toBe('New Collection');
    });

    it('should return null for empty name', () => {
      const { result } = renderHook(() => useOPDSCollections());
      let col: ReturnType<typeof result.current.createCollection>;
      act(() => {
        col = result.current.createCollection('');
      });
      expect(col!).toBeNull();
    });
  });

  describe('createAndAdd', () => {
    it('should create collection and add book', () => {
      const { result } = renderHook(() => useOPDSCollections());
      act(() => {
        result.current.createAndAdd('My Shelf', 'hash-a');
      });
      expect(mockAddCollection).toHaveBeenCalledWith('My Shelf');
      expect(mockAddBookToCollection).toHaveBeenCalledWith('col-new', 'hash-a');
    });

    it('should create collection without book when no hash provided', () => {
      const { result } = renderHook(() => useOPDSCollections());
      act(() => {
        result.current.createAndAdd('Empty Shelf');
      });
      expect(mockAddCollection).toHaveBeenCalledWith('Empty Shelf');
      expect(mockAddBookToCollection).not.toHaveBeenCalled();
    });
  });

  describe('findExistingBook', () => {
    it('should find book by identifier', () => {
      const { result } = renderHook(() => useOPDSCollections());
      const pub = createPublication({
        identifiers: [{ scheme: 'isbn', value: '978-1234567890' }],
      });
      const book = result.current.findExistingBook(pub);
      expect(book).not.toBeNull();
      expect(book!.hash).toBe('hash-a');
    });

    it('should find book by identifier URN', () => {
      const { result } = renderHook(() => useOPDSCollections());
      const pub = createPublication({
        identifiers: [{ scheme: 'urn', value: 'urn:uuid:12345' }],
        title: 'No Match Title',
        authors: [],
      });
      const book = result.current.findExistingBook(pub);
      expect(book).not.toBeNull();
      expect(book!.hash).toBe('hash-c');
    });

    it('should find book by title + author fallback', () => {
      const { result } = renderHook(() => useOPDSCollections());
      const pub = createPublication({
        identifiers: [],
        title: 'Another Book',
        authors: [{ name: 'John Smith' }],
      });
      const book = result.current.findExistingBook(pub);
      expect(book).not.toBeNull();
      expect(book!.hash).toBe('hash-b');
    });

    it('should return null when no match found', () => {
      const { result } = renderHook(() => useOPDSCollections());
      const pub = createPublication({
        identifiers: [],
        title: 'Unknown Book',
        authors: [{ name: 'Unknown Author' }],
      });
      const book = result.current.findExistingBook(pub);
      expect(book).toBeNull();
    });
  });
});
