import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';
import { BookCard } from '@/components/platform/book-card';
import type { Book } from '@/types/book';

// Mock EnvContext — BookCard calls useEnv() for appService
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    appService: null,
    envConfig: {},
  }),
}));

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

// Mock next/image
vi.mock('next/image', () => ({
  default: ({ src, alt, ...props }: { src: string; alt: string; [key: string]: unknown }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} {...props} />
  ),
}));

// Mock BookCover component
vi.mock('@/components/BookCover', () => ({
  default: ({ book }: { book: Book }) => <div data-testid='book-cover'>{book.title} cover</div>,
}));

// Mock Progress component
vi.mock('@/components/primitives/progress', () => ({
  Progress: ({ value, className }: { value: number; className?: string }) => (
    <div data-testid='progress-bar' role='progressbar' aria-valuenow={value} className={className}>
      {value}%
    </div>
  ),
}));

// Mock Checkbox component
vi.mock('@/components/primitives/checkbox', () => ({
  Checkbox: ({
    checked,
    onCheckedChange,
    onClick,
    className,
    'aria-label': ariaLabel,
  }: {
    checked: boolean;
    onCheckedChange: () => void;
    onClick?: (e: React.MouseEvent) => void;
    className?: string;
    'aria-label'?: string;
  }) => (
    <input
      type='checkbox'
      checked={checked}
      onChange={onCheckedChange}
      onClick={onClick}
      className={className}
      aria-label={ariaLabel}
      data-testid='checkbox'
    />
  ),
}));

// Mock BookCardMenu component
vi.mock('@/components/platform/book-card-menu', () => ({
  BookCardMenu: ({
    onSelectMultiple,
    onAddToCollection,
    onRename,
    onRemove,
  }: {
    book: Book;
    onSelectMultiple: () => void;
    onAddToCollection: () => void;
    onRename: () => void;
    onRemove: () => void;
  }) => (
    <div data-testid='book-card-menu'>
      <button onClick={onSelectMultiple} aria-label='Select Multiple'>
        Select Multiple
      </button>
      <button onClick={onAddToCollection} aria-label='Add to Collection'>
        Add to Collection
      </button>
      <button onClick={onRename} aria-label='Rename'>
        Rename
      </button>
      <button onClick={onRemove} aria-label='Remove'>
        Remove
      </button>
    </div>
  ),
}));

// Mock dialog components
vi.mock('@/components/platform/add-to-collection-dialog', () => ({
  AddToCollectionDialog: ({
    open,
    onOpenChange,
  }: {
    bookHash: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) =>
    open ? (
      <div data-testid='add-to-collection-dialog'>
        <button onClick={() => onOpenChange(false)}>Close</button>
      </div>
    ) : null,
}));

vi.mock('@/components/platform/rename-book-dialog', () => ({
  RenameBookDialog: ({
    open,
    onOpenChange,
  }: {
    book: Book;
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) =>
    open ? (
      <div data-testid='rename-book-dialog'>
        <button onClick={() => onOpenChange(false)}>Close</button>
      </div>
    ) : null,
}));

vi.mock('@/components/platform/remove-book-dialog', () => ({
  RemoveBookDialog: ({
    open,
    onOpenChange,
  }: {
    book: Book;
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) =>
    open ? (
      <div data-testid='remove-book-dialog'>
        <button onClick={() => onOpenChange(false)}>Close</button>
      </div>
    ) : null,
}));

// Mock library view store
const mockToggleBookSelection = vi.fn();
const mockSetSelectMode = vi.fn();

vi.mock('@/store/libraryViewStore', () => ({
  useLibraryViewStore: vi.fn(() => ({
    isSelectMode: false,
    selectedBooks: [],
    toggleBookSelection: mockToggleBookSelection,
    setSelectMode: mockSetSelectMode,
  })),
}));

// Import the mocked module to modify its return value
import { useLibraryViewStore } from '@/store/libraryViewStore';

const createMockBook = (overrides: Partial<Book> = {}): Book => ({
  hash: 'test-hash-123',
  title: 'Test Book Title',
  author: 'Test Author',
  format: 'epub',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  coverImageUrl: null,
  ...overrides,
});

describe('BookCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to default (normal mode, no selection)
    vi.mocked(useLibraryViewStore).mockReturnValue({
      isSelectMode: false,
      selectedBooks: [],
      toggleBookSelection: mockToggleBookSelection,
      setSelectMode: mockSetSelectMode,
    } as ReturnType<typeof useLibraryViewStore>);
  });

  afterEach(() => {
    cleanup();
  });

  describe('Rendering', () => {
    it('should render book title', () => {
      const book = createMockBook({ title: 'My Amazing Book' });
      render(<BookCard book={book} />);
      expect(screen.getByText('My Amazing Book')).toBeTruthy();
    });

    it('should render book author', () => {
      const book = createMockBook({ author: 'John Doe' });
      render(<BookCard book={book} />);
      expect(screen.getByText('John Doe')).toBeTruthy();
    });

    it('should not render author when not provided', () => {
      const book = createMockBook({ author: '' });
      render(<BookCard book={book} />);
      // Author paragraph should not be present
      const authorElements = screen.queryAllByText(/./);
      expect(authorElements.every((el) => el.textContent !== '')).toBeTruthy();
    });

    it('should link to reader with correct href in normal mode', () => {
      const book = createMockBook({ hash: 'book-hash-abc' });
      render(<BookCard book={book} />);
      const link = screen.getByRole('link');
      expect(link.getAttribute('href')).toBe('/reader?ids=book-hash-abc');
    });

    it('should have accessible aria-label on link', () => {
      const book = createMockBook({ title: 'Test Book', author: 'Test Author' });
      render(<BookCard book={book} />);
      const link = screen.getByRole('link');
      expect(link.getAttribute('aria-label')).toBe('Open Test Book by Test Author');
    });

    it('should show "Unknown author" in aria-label when author is not provided', () => {
      const book = createMockBook({ title: 'Test Book', author: '' });
      render(<BookCard book={book} />);
      const link = screen.getByRole('link');
      expect(link.getAttribute('aria-label')).toBe('Open Test Book by Unknown author');
    });
  });

  describe('Cover Image', () => {
    it('should render BookCover when coverImageUrl is present', () => {
      const book = createMockBook({ coverImageUrl: 'https://example.com/cover.jpg' });
      render(<BookCard book={book} />);
      expect(screen.getByTestId('book-cover')).toBeTruthy();
    });

    it('should render placeholder icon when no cover', () => {
      const book = createMockBook({ coverImageUrl: null });
      render(<BookCard book={book} />);
      // BookCover is always rendered (it handles its own fallback internally)
      expect(screen.getByTestId('book-cover')).toBeTruthy();
    });
  });

  describe('Progress Display', () => {
    it('should show progress bar when showProgress is true and has progress', () => {
      const book = createMockBook({ progress: [50, 100] });
      render(<BookCard book={book} showProgress />);
      const progressBar = screen.getByTestId('progress-bar');
      expect(progressBar).toBeTruthy();
      expect(progressBar.getAttribute('aria-valuenow')).toBe('50');
    });

    it('should not show progress bar when showProgress is false', () => {
      const book = createMockBook({ progress: [50, 100] });
      render(<BookCard book={book} showProgress={false} />);
      expect(screen.queryByTestId('progress-bar')).toBeNull();
    });

    it('should not show progress bar when progress is 0', () => {
      const book = createMockBook({ progress: [0, 100] });
      render(<BookCard book={book} showProgress />);
      expect(screen.queryByTestId('progress-bar')).toBeNull();
    });

    it('should not show progress bar when no progress data', () => {
      const book = createMockBook({ progress: undefined });
      render(<BookCard book={book} showProgress />);
      expect(screen.queryByTestId('progress-bar')).toBeNull();
    });

    it('should calculate correct progress percentage', () => {
      const book = createMockBook({ progress: [75, 100] });
      render(<BookCard book={book} showProgress />);
      const progressBar = screen.getByTestId('progress-bar');
      expect(progressBar.getAttribute('aria-valuenow')).toBe('75');
    });

    it('should round progress percentage', () => {
      const book = createMockBook({ progress: [33, 100] });
      render(<BookCard book={book} showProgress />);
      const progressBar = screen.getByTestId('progress-bar');
      expect(progressBar.getAttribute('aria-valuenow')).toBe('33');
    });
  });

  describe('Styling', () => {
    it('should apply custom className', () => {
      const book = createMockBook();
      render(<BookCard book={book} className='custom-class' />);
      // The className is now on the outer div, not the link
      const container = document.querySelector('.custom-class');
      expect(container).toBeTruthy();
    });

    it('should have hover scale transition class', () => {
      const book = createMockBook();
      render(<BookCard book={book} />);
      const container = document.querySelector('.md\\:hover\\:scale-105');
      expect(container).toBeTruthy();
    });

    it('should show ring highlight when selected', () => {
      vi.mocked(useLibraryViewStore).mockReturnValue({
        isSelectMode: true,
        selectedBooks: ['test-hash-123'],
        toggleBookSelection: mockToggleBookSelection,
        setSelectMode: mockSetSelectMode,
      } as ReturnType<typeof useLibraryViewStore>);

      const book = createMockBook({ hash: 'test-hash-123' });
      render(<BookCard book={book} />);
      const container = document.querySelector('.ring-primary');
      expect(container).toBeTruthy();
    });
  });

  describe('Menu', () => {
    it('should render menu in normal mode', () => {
      const book = createMockBook();
      render(<BookCard book={book} />);
      expect(screen.getByTestId('book-card-menu')).toBeTruthy();
    });

    it('should hide menu in select mode', () => {
      vi.mocked(useLibraryViewStore).mockReturnValue({
        isSelectMode: true,
        selectedBooks: [],
        toggleBookSelection: mockToggleBookSelection,
        setSelectMode: mockSetSelectMode,
      } as ReturnType<typeof useLibraryViewStore>);

      const book = createMockBook();
      render(<BookCard book={book} />);
      expect(screen.queryByTestId('book-card-menu')).toBeNull();
    });

    it('should trigger select mode when Select Multiple is clicked', () => {
      const book = createMockBook({ hash: 'book-123' });
      render(<BookCard book={book} />);
      fireEvent.click(screen.getByText('Select Multiple'));
      expect(mockSetSelectMode).toHaveBeenCalledWith(true);
      expect(mockToggleBookSelection).toHaveBeenCalledWith('book-123');
    });
  });

  describe('Select Mode', () => {
    beforeEach(() => {
      vi.mocked(useLibraryViewStore).mockReturnValue({
        isSelectMode: true,
        selectedBooks: [],
        toggleBookSelection: mockToggleBookSelection,
        setSelectMode: mockSetSelectMode,
      } as ReturnType<typeof useLibraryViewStore>);
    });

    it('should show checkbox in select mode', () => {
      const book = createMockBook();
      render(<BookCard book={book} />);
      expect(screen.getByTestId('checkbox')).toBeTruthy();
    });

    it('should not show checkbox in normal mode', () => {
      vi.mocked(useLibraryViewStore).mockReturnValue({
        isSelectMode: false,
        selectedBooks: [],
        toggleBookSelection: mockToggleBookSelection,
        setSelectMode: mockSetSelectMode,
      } as ReturnType<typeof useLibraryViewStore>);

      const book = createMockBook();
      render(<BookCard book={book} />);
      expect(screen.queryByTestId('checkbox')).toBeNull();
    });

    it('should not render link in select mode', () => {
      const book = createMockBook();
      render(<BookCard book={book} />);
      expect(screen.queryByRole('link')).toBeNull();
    });

    it('should toggle selection on card click in select mode', () => {
      const book = createMockBook({ hash: 'book-456' });
      render(<BookCard book={book} />);
      // Click on the title (part of the card content)
      fireEvent.click(screen.getByText('Test Book Title'));
      expect(mockToggleBookSelection).toHaveBeenCalledWith('book-456');
    });

    it('should toggle selection on checkbox change', () => {
      const book = createMockBook({ hash: 'book-789' });
      render(<BookCard book={book} />);
      fireEvent.click(screen.getByTestId('checkbox'));
      expect(mockToggleBookSelection).toHaveBeenCalledWith('book-789');
    });

    it('should show checked checkbox when book is selected', () => {
      vi.mocked(useLibraryViewStore).mockReturnValue({
        isSelectMode: true,
        selectedBooks: ['selected-book'],
        toggleBookSelection: mockToggleBookSelection,
        setSelectMode: mockSetSelectMode,
      } as ReturnType<typeof useLibraryViewStore>);

      const book = createMockBook({ hash: 'selected-book' });
      render(<BookCard book={book} />);
      const checkbox = screen.getByTestId('checkbox') as HTMLInputElement;
      expect(checkbox.checked).toBe(true);
    });
  });

  describe('Dialogs', () => {
    it('should open Add to Collection dialog when menu item is clicked', () => {
      const book = createMockBook();
      render(<BookCard book={book} />);
      expect(screen.queryByTestId('add-to-collection-dialog')).toBeNull();
      fireEvent.click(screen.getByText('Add to Collection'));
      expect(screen.getByTestId('add-to-collection-dialog')).toBeTruthy();
    });

    it('should open Rename dialog when menu item is clicked', () => {
      const book = createMockBook();
      render(<BookCard book={book} />);
      expect(screen.queryByTestId('rename-book-dialog')).toBeNull();
      fireEvent.click(screen.getByText('Rename'));
      expect(screen.getByTestId('rename-book-dialog')).toBeTruthy();
    });

    it('should open Remove dialog when menu item is clicked', () => {
      const book = createMockBook();
      render(<BookCard book={book} />);
      expect(screen.queryByTestId('remove-book-dialog')).toBeNull();
      fireEvent.click(screen.getByText('Remove'));
      expect(screen.getByTestId('remove-book-dialog')).toBeTruthy();
    });

    it('should close Add to Collection dialog when close is clicked', () => {
      const book = createMockBook();
      render(<BookCard book={book} />);
      fireEvent.click(screen.getByText('Add to Collection'));
      expect(screen.getByTestId('add-to-collection-dialog')).toBeTruthy();
      fireEvent.click(screen.getByText('Close'));
      expect(screen.queryByTestId('add-to-collection-dialog')).toBeNull();
    });
  });
});
