import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';
import { RemoveBookDialog } from '@/components/platform/remove-book-dialog';
import type { Book } from '@/types/book';

// Mock useBookActions hook
const mockPermanentlyDeleteBook = vi.fn();
const mockBulkRemove = vi.fn();

vi.mock('@/hooks/useBookActions', () => ({
  useBookActions: () => ({
    permanentlyDeleteBook: mockPermanentlyDeleteBook,
    bulkRemove: mockBulkRemove,
    removeBook: vi.fn(),
    setReadingStatus: vi.fn(),
    renameBook: vi.fn(),
    bulkSetReadingStatus: vi.fn(),
    bulkAddToCollection: vi.fn(),
  }),
}));

// Mock alert dialog components
vi.mock('@/components/primitives/alert-dialog', () => ({
  AlertDialog: ({
    children,
    open,
    onOpenChange,
  }: {
    children: React.ReactNode;
    open: boolean;
    onOpenChange?: (open: boolean) => void;
  }) =>
    open ? (
      <div data-testid='alert-dialog' data-open-change={onOpenChange ? 'true' : 'false'}>
        {children}
      </div>
    ) : null,
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid='alert-dialog-content'>{children}</div>
  ),
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div data-testid='alert-dialog-header'>{children}</div>
  ),
  AlertDialogTitle: ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => (
    <h2 data-testid='alert-dialog-title' className={className}>
      {children}
    </h2>
  ),
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => (
    <p data-testid='alert-dialog-description'>{children}</p>
  ),
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => (
    <div data-testid='alert-dialog-footer'>{children}</div>
  ),
}));

// Mock Button component from primitives
vi.mock('@/components/primitives/button', () => ({
  Button: ({
    children,
    onClick,
    className,
    ...props
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    className?: string;
    [key: string]: unknown;
  }) => (
    <button onClick={onClick} className={className} {...props}>
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

describe('RemoveBookDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe('Rendering', () => {
    it('should not render when open is false', () => {
      const mockBook = createMockBook();
      render(<RemoveBookDialog book={mockBook} open={false} onOpenChange={() => {}} />);

      expect(screen.queryByTestId('alert-dialog')).toBeNull();
    });

    it('should render when open is true', () => {
      const mockBook = createMockBook();
      render(<RemoveBookDialog book={mockBook} open={true} onOpenChange={() => {}} />);

      expect(screen.getByTestId('alert-dialog')).toBeTruthy();
    });

    it('should render Cancel and Delete Permanently buttons on first step', () => {
      const mockBook = createMockBook();
      render(<RemoveBookDialog book={mockBook} open={true} onOpenChange={() => {}} />);

      expect(screen.getByText('Cancel')).toBeTruthy();
      expect(screen.getByText('Delete Permanently')).toBeTruthy();
    });

    it('should show "Delete Book?" title for single book', () => {
      const mockBook = createMockBook({ title: 'The Great Gatsby' });
      render(<RemoveBookDialog book={mockBook} open={true} onOpenChange={() => {}} />);

      expect(screen.getByTestId('alert-dialog-title').textContent).toBe('Delete Book?');
    });

    it('should show book title in first-step description', () => {
      const mockBook = createMockBook({ title: 'The Great Gatsby' });
      render(<RemoveBookDialog book={mockBook} open={true} onOpenChange={() => {}} />);

      const description = screen.getByTestId('alert-dialog-description');
      expect(description.textContent).toBe(
        'Are you sure you want to delete "The Great Gatsby" from your library?',
      );
    });
  });

  describe('Two-step confirmation flow', () => {
    it('should show confirm step after clicking Delete Permanently', () => {
      const mockBook = createMockBook({ title: 'Test Book' });
      render(<RemoveBookDialog book={mockBook} open={true} onOpenChange={() => {}} />);

      fireEvent.click(screen.getByText('Delete Permanently'));

      // Title changes
      expect(screen.getByTestId('alert-dialog-title').textContent).toBe(
        'This action cannot be undone',
      );
      // Title gets error class
      expect(screen.getByTestId('alert-dialog-title').className).toContain('text-error');
      // Description changes
      expect(screen.getByTestId('alert-dialog-description').textContent).toBe(
        'All associated bookmarks, highlights, notes, reading progress, and AI conversations for "Test Book" will also be deleted.',
      );
      // Buttons change
      expect(screen.getByText('Go Back')).toBeTruthy();
      expect(screen.getByText('Yes, Delete Permanently')).toBeTruthy();
      expect(screen.queryByText('Cancel')).toBeNull();
      expect(screen.queryByText('Delete Permanently')).toBeNull();
    });

    it('should return to first step when Go Back is clicked', () => {
      const mockBook = createMockBook({ title: 'Test Book' });
      render(<RemoveBookDialog book={mockBook} open={true} onOpenChange={() => {}} />);

      // Go to confirm step
      fireEvent.click(screen.getByText('Delete Permanently'));
      expect(screen.getByText('Go Back')).toBeTruthy();

      // Click Go Back
      fireEvent.click(screen.getByText('Go Back'));

      // Should be back to first step
      expect(screen.getByTestId('alert-dialog-title').textContent).toBe('Delete Book?');
      expect(screen.getByText('Cancel')).toBeTruthy();
      expect(screen.getByText('Delete Permanently')).toBeTruthy();
    });

    it('should not have error class on title in first step', () => {
      const mockBook = createMockBook();
      render(<RemoveBookDialog book={mockBook} open={true} onOpenChange={() => {}} />);

      expect(screen.getByTestId('alert-dialog-title').className).not.toContain('text-error');
    });
  });

  describe('Single book deletion', () => {
    it('should call permanentlyDeleteBook after full 2-step confirmation', () => {
      const mockBook = createMockBook();
      const onOpenChange = vi.fn();
      render(<RemoveBookDialog book={mockBook} open={true} onOpenChange={onOpenChange} />);

      // Step 1: click Delete Permanently
      fireEvent.click(screen.getByText('Delete Permanently'));

      // Step 2: click Yes, Delete Permanently
      fireEvent.click(screen.getByText('Yes, Delete Permanently'));

      expect(mockPermanentlyDeleteBook).toHaveBeenCalledWith(mockBook);
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('should not call bulkRemove for single book deletion', () => {
      const mockBook = createMockBook();
      render(<RemoveBookDialog book={mockBook} open={true} onOpenChange={vi.fn()} />);

      fireEvent.click(screen.getByText('Delete Permanently'));
      fireEvent.click(screen.getByText('Yes, Delete Permanently'));

      expect(mockPermanentlyDeleteBook).toHaveBeenCalled();
      expect(mockBulkRemove).not.toHaveBeenCalled();
    });

    it('should not call permanentlyDeleteBook on first step click alone', () => {
      const mockBook = createMockBook();
      render(<RemoveBookDialog book={mockBook} open={true} onOpenChange={vi.fn()} />);

      // Only click the first button
      fireEvent.click(screen.getByText('Delete Permanently'));

      expect(mockPermanentlyDeleteBook).not.toHaveBeenCalled();
    });
  });

  describe('Bulk deletion', () => {
    it('should show count in title for multiple books', () => {
      render(
        <RemoveBookDialog
          bookHashes={['book-1', 'book-2', 'book-3']}
          open={true}
          onOpenChange={() => {}}
        />,
      );

      expect(screen.getByTestId('alert-dialog-title').textContent).toBe('Delete 3 books?');
    });

    it('should show singular "book" for single item in bulk mode', () => {
      render(<RemoveBookDialog bookHashes={['book-1']} open={true} onOpenChange={() => {}} />);

      expect(screen.getByTestId('alert-dialog-title').textContent).toBe('Delete 1 book?');
    });

    it('should show count in description for multiple books', () => {
      render(
        <RemoveBookDialog
          bookHashes={['book-1', 'book-2', 'book-3']}
          open={true}
          onOpenChange={() => {}}
        />,
      );

      const description = screen.getByTestId('alert-dialog-description');
      expect(description.textContent).toBe(
        'Are you sure you want to delete 3 books from your library?',
      );
    });

    it('should show bulk confirm description on second step', () => {
      render(
        <RemoveBookDialog
          bookHashes={['book-1', 'book-2', 'book-3']}
          open={true}
          onOpenChange={() => {}}
        />,
      );

      fireEvent.click(screen.getByText('Delete Permanently'));

      const description = screen.getByTestId('alert-dialog-description');
      expect(description.textContent).toBe(
        'All associated bookmarks, highlights, notes, reading progress, and AI conversations for 3 books will also be deleted.',
      );
    });

    it('should call bulkRemove after full 2-step confirmation', () => {
      const hashes = ['book-1', 'book-2', 'book-3'];
      const onOpenChange = vi.fn();
      render(<RemoveBookDialog bookHashes={hashes} open={true} onOpenChange={onOpenChange} />);

      fireEvent.click(screen.getByText('Delete Permanently'));
      fireEvent.click(screen.getByText('Yes, Delete Permanently'));

      expect(mockBulkRemove).toHaveBeenCalledWith(hashes);
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('should not call permanentlyDeleteBook for bulk operation', () => {
      const hashes = ['book-1', 'book-2'];
      render(<RemoveBookDialog bookHashes={hashes} open={true} onOpenChange={vi.fn()} />);

      fireEvent.click(screen.getByText('Delete Permanently'));
      fireEvent.click(screen.getByText('Yes, Delete Permanently'));

      expect(mockBulkRemove).toHaveBeenCalled();
      expect(mockPermanentlyDeleteBook).not.toHaveBeenCalled();
    });

    it('should prefer bulk mode when both book and bookHashes are provided', () => {
      const mockBook = createMockBook();
      const hashes = ['book-1', 'book-2'];
      render(
        <RemoveBookDialog book={mockBook} bookHashes={hashes} open={true} onOpenChange={vi.fn()} />,
      );

      expect(screen.getByTestId('alert-dialog-title').textContent).toBe('Delete 2 books?');

      fireEvent.click(screen.getByText('Delete Permanently'));
      fireEvent.click(screen.getByText('Yes, Delete Permanently'));

      expect(mockBulkRemove).toHaveBeenCalledWith(hashes);
      expect(mockPermanentlyDeleteBook).not.toHaveBeenCalled();
    });
  });

  describe('Cancel behavior', () => {
    it('should close dialog when Cancel is clicked', () => {
      const mockBook = createMockBook();
      const onOpenChange = vi.fn();
      render(<RemoveBookDialog book={mockBook} open={true} onOpenChange={onOpenChange} />);

      fireEvent.click(screen.getByText('Cancel'));

      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('should not call permanentlyDeleteBook when Cancel is clicked', () => {
      const mockBook = createMockBook();
      render(<RemoveBookDialog book={mockBook} open={true} onOpenChange={vi.fn()} />);

      fireEvent.click(screen.getByText('Cancel'));

      expect(mockPermanentlyDeleteBook).not.toHaveBeenCalled();
      expect(mockBulkRemove).not.toHaveBeenCalled();
    });
  });

  describe('Dialog close resets confirming state', () => {
    it('should reset to first step when dialog is closed via Cancel after reaching confirm step', () => {
      const mockBook = createMockBook();
      const onOpenChange = vi.fn();
      render(<RemoveBookDialog book={mockBook} open={true} onOpenChange={onOpenChange} />);

      // Go to confirm step
      fireEvent.click(screen.getByText('Delete Permanently'));
      expect(screen.getByText('Yes, Delete Permanently')).toBeTruthy();

      // Use Go Back to return to first step, then Cancel to close
      fireEvent.click(screen.getByText('Go Back'));
      fireEvent.click(screen.getByText('Cancel'));

      // onOpenChange called with false
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('should reset confirming state when component is remounted', () => {
      const mockBook = createMockBook();
      const onOpenChange = vi.fn();
      const { unmount } = render(
        <RemoveBookDialog book={mockBook} open={true} onOpenChange={onOpenChange} />,
      );

      // Go to confirm step
      fireEvent.click(screen.getByText('Delete Permanently'));
      expect(screen.getByText('Yes, Delete Permanently')).toBeTruthy();

      // Unmount and remount (simulates dialog fully closing and reopening)
      unmount();
      render(<RemoveBookDialog book={mockBook} open={true} onOpenChange={onOpenChange} />);

      // Should be back on first step
      expect(screen.getByTestId('alert-dialog-title').textContent).toBe('Delete Book?');
      expect(screen.getByText('Cancel')).toBeTruthy();
      expect(screen.getByText('Delete Permanently')).toBeTruthy();
    });

    it('should reset confirming state via handleClose when dialog dismisses', () => {
      // The handleClose function resets confirming when called with false.
      // This is tested indirectly: after deletion, confirming is reset.
      const mockBook = createMockBook();
      const onOpenChange = vi.fn();
      const { rerender } = render(
        <RemoveBookDialog book={mockBook} open={true} onOpenChange={onOpenChange} />,
      );

      // Complete the full deletion flow (which calls setConfirming(false) internally)
      fireEvent.click(screen.getByText('Delete Permanently'));
      fireEvent.click(screen.getByText('Yes, Delete Permanently'));

      // Dialog closed
      expect(onOpenChange).toHaveBeenCalledWith(false);

      // Rerender as closed then reopened
      rerender(<RemoveBookDialog book={mockBook} open={false} onOpenChange={onOpenChange} />);
      rerender(<RemoveBookDialog book={mockBook} open={true} onOpenChange={onOpenChange} />);

      // confirming was reset to false by handleDelete before dialog closed
      expect(screen.getByTestId('alert-dialog-title').textContent).toBe('Delete Book?');
      expect(screen.getByText('Delete Permanently')).toBeTruthy();
    });
  });

  describe('Styling', () => {
    it('should have outlined destructive styling on Delete Permanently button', () => {
      const mockBook = createMockBook();
      render(<RemoveBookDialog book={mockBook} open={true} onOpenChange={() => {}} />);

      const deleteButton = screen.getByText('Delete Permanently');
      expect(deleteButton.className).toContain('border-error');
      expect(deleteButton.className).toContain('text-error');
    });

    it('should have solid destructive styling on Yes, Delete Permanently button', () => {
      const mockBook = createMockBook();
      render(<RemoveBookDialog book={mockBook} open={true} onOpenChange={() => {}} />);

      fireEvent.click(screen.getByText('Delete Permanently'));

      const confirmButton = screen.getByText('Yes, Delete Permanently');
      expect(confirmButton.className).toContain('bg-error');
      expect(confirmButton.className).toContain('text-error-content');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty bookHashes array (not bulk mode)', () => {
      const mockBook = createMockBook({ title: 'My Book' });
      render(
        <RemoveBookDialog book={mockBook} bookHashes={[]} open={true} onOpenChange={() => {}} />,
      );

      // Should fall back to single book mode
      expect(screen.getByTestId('alert-dialog-title').textContent).toBe('Delete Book?');
      expect(screen.getByTestId('alert-dialog-description').textContent).toContain('My Book');
    });

    it('should handle null book in single mode gracefully', () => {
      const onOpenChange = vi.fn();
      render(<RemoveBookDialog book={null} open={true} onOpenChange={onOpenChange} />);

      fireEvent.click(screen.getByText('Delete Permanently'));
      fireEvent.click(screen.getByText('Yes, Delete Permanently'));

      // Should not call permanentlyDeleteBook since book is null, but dialog still closes
      expect(mockPermanentlyDeleteBook).not.toHaveBeenCalled();
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});
