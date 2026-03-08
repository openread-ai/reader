import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';
import { CollectionCard } from '@/components/platform/collection-card';
import type { Collection } from '@/store/platformSidebarStore';
import type { Book } from '@/types/book';

// Mock next/link
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// Mock BookCover component
vi.mock('@/components/BookCover', () => ({
  default: ({ book }: { book: Book }) => <div data-testid='book-cover'>{book.title} cover</div>,
}));

// Mock the stores
const mockLibrary: Book[] = [
  {
    hash: 'book-1',
    title: 'Book One',
    author: 'Author One',
    format: 'epub',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    coverImageUrl: 'https://example.com/cover1.jpg',
  },
  {
    hash: 'book-2',
    title: 'Book Two',
    author: 'Author Two',
    format: 'pdf',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    coverImageUrl: null,
  },
];

const mockDeleteCollection = vi.fn();
const mockRenameCollection = vi.fn();

vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: vi.fn((selector) => {
    const state = { library: mockLibrary };
    return selector(state);
  }),
}));

vi.mock('@/hooks/useCollections', () => ({
  useCollections: () => ({
    collections: [],
    createCollection: vi.fn(),
    deleteCollection: mockDeleteCollection,
    renameCollection: mockRenameCollection,
  }),
}));

// Mock dropdown menu components
vi.mock('@/components/primitives/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({
    children,
    asChild: _asChild,
  }: {
    children: React.ReactNode;
    asChild?: boolean;
  }) => <div data-testid='dropdown-trigger'>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid='dropdown-content'>{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onClick,
    className,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    className?: string;
  }) => (
    <button onClick={onClick} className={className} data-testid='dropdown-item'>
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr />,
}));

// Mock alert dialog components
vi.mock('@/components/primitives/alert-dialog', () => ({
  AlertDialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid='alert-dialog'>{children}</div> : null,
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogAction: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => (
    <button onClick={onClick} data-testid='confirm-delete'>
      {children}
    </button>
  ),
  AlertDialogCancel: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
}));

// Mock CreateCollectionDialog (used for rename)
vi.mock('@/components/platform/create-collection-dialog', () => ({
  CreateCollectionDialog: ({
    open,
    onOpenChange,
    onCreateCollection,
    initialName,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onCreateCollection: (name: string) => void;
    initialName?: string;
  }) =>
    open ? (
      <div data-testid='rename-dialog'>
        <span data-testid='rename-initial-name'>{initialName}</span>
        <button data-testid='rename-submit' onClick={() => onCreateCollection('New Name')}>
          Rename
        </button>
        <button data-testid='rename-cancel' onClick={() => onOpenChange(false)}>
          Cancel
        </button>
      </div>
    ) : null,
}));

// Mock useTranslation
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

// Mock button component
vi.mock('@/components/primitives/button', () => ({
  Button: ({
    children,
    onClick,
    ...props
  }: {
    children: React.ReactNode;
    onClick?: (e: React.MouseEvent) => void;
    [key: string]: unknown;
  }) => (
    <button onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

const createMockCollection = (overrides: Partial<Collection> = {}): Collection => ({
  id: 'collection-1',
  name: 'My Collection',
  bookHashes: ['book-1', 'book-2'],
  createdAt: new Date().toISOString(),
  ...overrides,
});

describe('CollectionCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe('Rendering', () => {
    it('should render collection name', () => {
      const collection = createMockCollection({ name: 'Work Reading' });
      render(<CollectionCard collection={collection} />);
      expect(screen.getByText('Work Reading')).toBeTruthy();
    });

    it('should render book count singular', () => {
      const collection = createMockCollection({ bookHashes: ['book-1'] });
      render(<CollectionCard collection={collection} />);
      expect(screen.getByText('1 book')).toBeTruthy();
    });

    it('should render book count plural', () => {
      const collection = createMockCollection({ bookHashes: ['book-1', 'book-2'] });
      render(<CollectionCard collection={collection} />);
      expect(screen.getByText('2 books')).toBeTruthy();
    });

    it('should render zero books correctly', () => {
      const collection = createMockCollection({ bookHashes: [] });
      render(<CollectionCard collection={collection} />);
      expect(screen.getByText('0 books')).toBeTruthy();
    });

    it('should link to collection page', () => {
      const collection = createMockCollection({ id: 'my-collection-id' });
      render(<CollectionCard collection={collection} />);
      const link = screen.getByRole('link');
      expect(link.getAttribute('href')).toBe('/collections/my-collection-id');
    });

    it('should have accessible aria-label', () => {
      const collection = createMockCollection({
        name: 'Book Club',
        bookHashes: ['book-1', 'book-2', 'book-3'],
      });
      render(<CollectionCard collection={collection} />);
      const link = screen.getByRole('link');
      expect(link.getAttribute('aria-label')).toBe('Open Book Club collection with 3 books');
    });

    it('should have correct aria-label for single book', () => {
      const collection = createMockCollection({
        name: 'Favorites',
        bookHashes: ['book-1'],
      });
      render(<CollectionCard collection={collection} />);
      const link = screen.getByRole('link');
      expect(link.getAttribute('aria-label')).toBe('Open Favorites collection with 1 book');
    });
  });

  describe('Preview Covers', () => {
    it('should render book covers when collection has books', () => {
      const collection = createMockCollection({ bookHashes: ['book-1'] });
      render(<CollectionCard collection={collection} />);
      expect(screen.getByTestId('book-cover')).toBeTruthy();
    });

    it('should show folder icon when collection is empty', () => {
      const collection = createMockCollection({ bookHashes: [] });
      render(<CollectionCard collection={collection} />);
      // Should not have any book covers
      expect(screen.queryByTestId('book-cover')).toBeNull();
    });
  });

  describe('Actions', () => {
    it('should render dropdown menu trigger', () => {
      const collection = createMockCollection();
      render(<CollectionCard collection={collection} />);
      expect(screen.getByTestId('dropdown-trigger')).toBeTruthy();
    });

    it('should render rename and delete options', () => {
      const collection = createMockCollection();
      render(<CollectionCard collection={collection} />);
      const items = screen.getAllByTestId('dropdown-item');
      expect(items.length).toBe(2); // Rename and Delete
    });

    it('should call renameCollection when rename is clicked', () => {
      const collection = createMockCollection({ name: 'Old Name' });

      render(<CollectionCard collection={collection} />);
      const items = screen.getAllByTestId('dropdown-item');
      fireEvent.click(items[0]); // Rename button — opens the rename dialog

      // Dialog should now be visible with the initial name
      expect(screen.getByTestId('rename-dialog')).toBeTruthy();
      expect(screen.getByTestId('rename-initial-name').textContent).toBe('Old Name');

      // Submit the rename
      fireEvent.click(screen.getByTestId('rename-submit'));
      expect(mockRenameCollection).toHaveBeenCalledWith('collection-1', 'New Name');
    });

    it('should not rename if dialog is cancelled', () => {
      const collection = createMockCollection();

      render(<CollectionCard collection={collection} />);
      const items = screen.getAllByTestId('dropdown-item');
      fireEvent.click(items[0]); // Rename button — opens the rename dialog

      // Cancel the dialog
      fireEvent.click(screen.getByTestId('rename-cancel'));

      expect(mockRenameCollection).not.toHaveBeenCalled();
    });

    it('should show delete confirmation dialog when delete is clicked', () => {
      const collection = createMockCollection({ name: 'Test Collection' });
      render(<CollectionCard collection={collection} />);

      // Initially dialog should not be visible
      expect(screen.queryByTestId('alert-dialog')).toBeNull();

      // Click delete button
      const items = screen.getAllByTestId('dropdown-item');
      fireEvent.click(items[1]); // Delete button

      // Dialog should now be visible
      expect(screen.getByTestId('alert-dialog')).toBeTruthy();
      expect(screen.getByText('Delete Collection?')).toBeTruthy();
    });

    it('should call deleteCollection when delete is confirmed', () => {
      const collection = createMockCollection({ id: 'delete-me' });
      render(<CollectionCard collection={collection} />);

      // Open delete dialog
      const items = screen.getAllByTestId('dropdown-item');
      fireEvent.click(items[1]); // Delete button

      // Confirm delete
      fireEvent.click(screen.getByTestId('confirm-delete'));

      expect(mockDeleteCollection).toHaveBeenCalledWith('delete-me');
    });
  });

  describe('Styling', () => {
    it('should apply custom className', () => {
      const collection = createMockCollection();
      const { container } = render(
        <CollectionCard collection={collection} className='custom-class' />,
      );
      expect((container.firstChild as HTMLElement).className).toContain('custom-class');
    });

    it('should have hover transition class', () => {
      const collection = createMockCollection();
      const { container } = render(<CollectionCard collection={collection} />);
      expect((container.firstChild as HTMLElement).className).toContain('transition-colors');
    });
  });
});
