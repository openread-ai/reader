import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';
import { BookCardMenu } from '@/components/platform/book-card-menu';
import type { Book } from '@/types/book';

// Mock the useBookActions hook
const mockSetReadingStatus = vi.fn();

vi.mock('@/hooks/useBookActions', () => ({
  useBookActions: () => ({
    setReadingStatus: mockSetReadingStatus,
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
  DropdownMenuContent: ({
    children,
    align: _align,
    className: _className,
  }: {
    children: React.ReactNode;
    align?: string;
    className?: string;
  }) => <div data-testid='dropdown-content'>{children}</div>,
  DropdownMenuItem: ({
    children,
    onSelect,
    className,
    ...props
  }: {
    children: React.ReactNode;
    onSelect?: () => void;
    className?: string;
    [key: string]: unknown;
  }) => (
    <button onClick={onSelect} className={className} data-testid='dropdown-item' {...props}>
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <hr data-testid='dropdown-separator' />,
}));

// Mock button component
vi.mock('@/components/primitives/button', () => ({
  Button: ({
    children,
    onClick,
    className: _className,
    variant: _variant,
    size: _size,
    ...props
  }: {
    children: React.ReactNode;
    onClick?: (e: React.MouseEvent) => void;
    className?: string;
    variant?: string;
    size?: string;
    [key: string]: unknown;
  }) => (
    <button onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

const createMockBook = (overrides: Partial<Book> = {}): Book => ({
  hash: 'book-123',
  title: 'Test Book',
  author: 'Test Author',
  format: 'epub',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...overrides,
});

describe('BookCardMenu', () => {
  const defaultProps = {
    book: createMockBook(),
    onSelectMultiple: vi.fn(),
    onAddToCollection: vi.fn(),
    onRename: vi.fn(),
    onRemove: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe('Rendering', () => {
    it('should render trigger button', () => {
      render(<BookCardMenu {...defaultProps} />);
      expect(screen.getByRole('button', { name: /book options/i })).toBeTruthy();
    });

    it('should render dropdown trigger', () => {
      render(<BookCardMenu {...defaultProps} />);
      expect(screen.getByTestId('dropdown-trigger')).toBeTruthy();
    });

    it('should render dropdown content', () => {
      render(<BookCardMenu {...defaultProps} />);
      expect(screen.getByTestId('dropdown-content')).toBeTruthy();
    });

    it('should render all 6 menu items', () => {
      render(<BookCardMenu {...defaultProps} />);
      const items = screen.getAllByTestId('dropdown-item');
      expect(items.length).toBe(6);
    });

    it('should render Select Multiple menu item', () => {
      render(<BookCardMenu {...defaultProps} />);
      expect(screen.getByText('Select Multiple')).toBeTruthy();
    });

    it('should render Add to Collection menu item', () => {
      render(<BookCardMenu {...defaultProps} />);
      expect(screen.getByText('Add to Collection')).toBeTruthy();
    });

    it('should render Want to Read menu item', () => {
      render(<BookCardMenu {...defaultProps} />);
      expect(screen.getByText('Want to Read')).toBeTruthy();
    });

    it('should render Mark as Finished menu item', () => {
      render(<BookCardMenu {...defaultProps} />);
      expect(screen.getByText('Mark as Finished')).toBeTruthy();
    });

    it('should render Rename menu item', () => {
      render(<BookCardMenu {...defaultProps} />);
      expect(screen.getByText('Rename')).toBeTruthy();
    });

    it('should render Remove menu item', () => {
      render(<BookCardMenu {...defaultProps} />);
      expect(screen.getByText('Remove')).toBeTruthy();
    });

    it('should render 2 separators', () => {
      render(<BookCardMenu {...defaultProps} />);
      const separators = screen.getAllByTestId('dropdown-separator');
      expect(separators.length).toBe(2);
    });
  });

  describe('Menu Item Styling', () => {
    it('should apply destructive styling to Remove item', () => {
      render(<BookCardMenu {...defaultProps} />);
      const items = screen.getAllByTestId('dropdown-item');
      const removeItem = items[5]; // Last item is Remove
      expect(removeItem.className).toContain('text-error');
      expect(removeItem.className).toContain('focus:text-error');
    });

    it('should not apply destructive styling to other items', () => {
      render(<BookCardMenu {...defaultProps} />);
      const items = screen.getAllByTestId('dropdown-item');
      // Check first 5 items don't have error styling
      for (let i = 0; i < 5; i++) {
        expect(items[i].className).not.toContain('text-error');
      }
    });
  });

  describe('Menu Actions', () => {
    it('should call onSelectMultiple when Select Multiple is clicked', () => {
      const onSelectMultiple = vi.fn();
      render(<BookCardMenu {...defaultProps} onSelectMultiple={onSelectMultiple} />);

      fireEvent.click(screen.getByText('Select Multiple'));
      expect(onSelectMultiple).toHaveBeenCalledTimes(1);
    });

    it('should call onAddToCollection when Add to Collection is clicked', () => {
      const onAddToCollection = vi.fn();
      render(<BookCardMenu {...defaultProps} onAddToCollection={onAddToCollection} />);

      fireEvent.click(screen.getByText('Add to Collection'));
      expect(onAddToCollection).toHaveBeenCalledTimes(1);
    });

    it('should call setReadingStatus with unread when Want to Read is clicked', async () => {
      const book = createMockBook();
      render(<BookCardMenu {...defaultProps} book={book} />);

      fireEvent.click(screen.getByText('Want to Read'));
      expect(mockSetReadingStatus).toHaveBeenCalledWith(book, 'unread');
    });

    it('should call setReadingStatus with finished when Mark as Finished is clicked', async () => {
      const book = createMockBook();
      render(<BookCardMenu {...defaultProps} book={book} />);

      fireEvent.click(screen.getByText('Mark as Finished'));
      expect(mockSetReadingStatus).toHaveBeenCalledWith(book, 'finished');
    });

    it('should call onRename when Rename is clicked', () => {
      const onRename = vi.fn();
      render(<BookCardMenu {...defaultProps} onRename={onRename} />);

      fireEvent.click(screen.getByText('Rename'));
      expect(onRename).toHaveBeenCalledTimes(1);
    });

    it('should call onRemove when Remove is clicked', () => {
      const onRemove = vi.fn();
      render(<BookCardMenu {...defaultProps} onRemove={onRemove} />);

      fireEvent.click(screen.getByText('Remove'));
      expect(onRemove).toHaveBeenCalledTimes(1);
    });
  });

  describe('Book Context', () => {
    it('should pass the correct book to setReadingStatus for Want to Read', () => {
      const specificBook = createMockBook({
        hash: 'specific-book-hash',
        title: 'Specific Book',
      });
      render(<BookCardMenu {...defaultProps} book={specificBook} />);

      fireEvent.click(screen.getByText('Want to Read'));
      expect(mockSetReadingStatus).toHaveBeenCalledWith(specificBook, 'unread');
    });

    it('should pass the correct book to setReadingStatus for Mark as Finished', () => {
      const specificBook = createMockBook({
        hash: 'another-book-hash',
        title: 'Another Book',
      });
      render(<BookCardMenu {...defaultProps} book={specificBook} />);

      fireEvent.click(screen.getByText('Mark as Finished'));
      expect(mockSetReadingStatus).toHaveBeenCalledWith(specificBook, 'finished');
    });
  });

  describe('Multiple Actions', () => {
    it('should not interfere with other callbacks when clicking different items', () => {
      const onSelectMultiple = vi.fn();
      const onAddToCollection = vi.fn();
      const onRename = vi.fn();
      const onRemove = vi.fn();

      render(
        <BookCardMenu
          {...defaultProps}
          onSelectMultiple={onSelectMultiple}
          onAddToCollection={onAddToCollection}
          onRename={onRename}
          onRemove={onRemove}
        />,
      );

      fireEvent.click(screen.getByText('Select Multiple'));
      expect(onSelectMultiple).toHaveBeenCalledTimes(1);
      expect(onAddToCollection).not.toHaveBeenCalled();
      expect(onRename).not.toHaveBeenCalled();
      expect(onRemove).not.toHaveBeenCalled();
    });

    it('should handle multiple clicks on the same item', () => {
      const onSelectMultiple = vi.fn();
      render(<BookCardMenu {...defaultProps} onSelectMultiple={onSelectMultiple} />);

      fireEvent.click(screen.getByText('Select Multiple'));
      fireEvent.click(screen.getByText('Select Multiple'));
      fireEvent.click(screen.getByText('Select Multiple'));

      expect(onSelectMultiple).toHaveBeenCalledTimes(3);
    });
  });

  describe('Accessibility', () => {
    it('should have sr-only label for screen readers', () => {
      render(<BookCardMenu {...defaultProps} />);
      expect(screen.getByText('Book options')).toBeTruthy();
    });

    it('should have accessible button name', () => {
      render(<BookCardMenu {...defaultProps} />);
      const button = screen.getByRole('button', { name: /book options/i });
      expect(button).toBeTruthy();
    });
  });

  describe('Menu Item Order', () => {
    it('should render items in correct order', () => {
      render(<BookCardMenu {...defaultProps} />);
      const items = screen.getAllByTestId('dropdown-item');

      expect(items[0].textContent).toContain('Select Multiple');
      expect(items[1].textContent).toContain('Add to Collection');
      expect(items[2].textContent).toContain('Want to Read');
      expect(items[3].textContent).toContain('Mark as Finished');
      expect(items[4].textContent).toContain('Rename');
      expect(items[5].textContent).toContain('Remove');
    });
  });
});
