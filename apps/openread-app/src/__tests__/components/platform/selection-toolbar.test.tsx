import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';
import { SelectionToolbar } from '@/components/platform/selection-toolbar';

// Mock EnvContext
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    appService: null,
    envConfig: {},
  }),
}));

// Mock Button component
vi.mock('@/components/primitives/button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    className,
    title,
    'data-testid': testId,
    ...props
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    className?: string;
    title?: string;
    'data-testid'?: string;
    [key: string]: unknown;
  }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      className={className}
      title={title}
      data-testid={testId}
      {...props}
    >
      {children}
    </button>
  ),
}));

// Mock functions
const mockSelectAll = vi.fn();
const mockClearSelection = vi.fn();
const mockSetSelectMode = vi.fn();
const mockBulkSetReadingStatus = vi.fn().mockResolvedValue(undefined);
const mockBulkRemove = vi.fn().mockResolvedValue(undefined);
const mockBulkAddToCollection = vi.fn();

// Mock the library view store
vi.mock('@/store/libraryViewStore', () => ({
  useLibraryViewStore: vi.fn(() => ({
    selectedBooks: ['book-1', 'book-2'],
    selectAll: mockSelectAll,
    clearSelection: mockClearSelection,
    setSelectMode: mockSetSelectMode,
  })),
}));

// Mock the book actions hook
vi.mock('@/hooks/useBookActions', () => ({
  useBookActions: () => ({
    bulkSetReadingStatus: mockBulkSetReadingStatus,
    bulkRemove: mockBulkRemove,
    bulkAddToCollection: mockBulkAddToCollection,
  }),
}));

// Mock the dialogs
vi.mock('@/components/platform/add-to-collection-dialog', () => ({
  AddToCollectionDialog: ({
    open,
    onOpenChange,
    bookHashes,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    bookHashes: string[];
  }) =>
    open ? (
      <div data-testid='collection-dialog' data-book-hashes={bookHashes.join(',')}>
        <button onClick={() => onOpenChange(false)} data-testid='close-collection-dialog'>
          Close
        </button>
      </div>
    ) : null,
}));

vi.mock('@/components/platform/remove-book-dialog', () => ({
  RemoveBookDialog: ({
    open,
    onOpenChange,
    bookHashes,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    bookHashes: string[];
  }) =>
    open ? (
      <div data-testid='remove-dialog' data-book-hashes={bookHashes.join(',')}>
        <button onClick={() => onOpenChange(false)} data-testid='close-remove-dialog'>
          Close
        </button>
      </div>
    ) : null,
}));

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  FolderPlus: () => <span data-testid='folder-plus-icon' />,
  BookmarkPlus: () => <span data-testid='bookmark-plus-icon' />,
  CheckCircle2: () => <span data-testid='check-circle-icon' />,
  Trash2: () => <span data-testid='trash-icon' />,
  X: () => <span data-testid='x-icon' />,
}));

// Import the mock for modification in tests
import { useLibraryViewStore } from '@/store/libraryViewStore';

describe('SelectionToolbar', () => {
  const allHashes = ['book-1', 'book-2', 'book-3', 'book-4'];
  const defaultProps = {
    totalCount: 4,
    allBookHashes: allHashes,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to default mock
    vi.mocked(useLibraryViewStore).mockReturnValue({
      selectedBooks: ['book-1', 'book-2'],
      selectAll: mockSelectAll,
      clearSelection: mockClearSelection,
      setSelectMode: mockSetSelectMode,
    });
  });

  afterEach(() => {
    cleanup();
  });

  describe('Selection Count Display', () => {
    it('should show selection count', () => {
      render(<SelectionToolbar {...defaultProps} />);
      expect(screen.getByTestId('selection-count').textContent).toBe('2 of 4 selected');
    });

    it('should update count based on selectedBooks', () => {
      vi.mocked(useLibraryViewStore).mockReturnValue({
        selectedBooks: ['book-1'],
        selectAll: mockSelectAll,
        clearSelection: mockClearSelection,
        setSelectMode: mockSetSelectMode,
      });

      render(<SelectionToolbar {...defaultProps} />);
      expect(screen.getByTestId('selection-count').textContent).toBe('1 of 4 selected');
    });

    it('should show 0 selected when no books selected', () => {
      vi.mocked(useLibraryViewStore).mockReturnValue({
        selectedBooks: [],
        selectAll: mockSelectAll,
        clearSelection: mockClearSelection,
        setSelectMode: mockSetSelectMode,
      });

      render(<SelectionToolbar {...defaultProps} />);
      expect(screen.getByTestId('selection-count').textContent).toBe('0 of 4 selected');
    });
  });

  describe('Select All Button', () => {
    it('should call selectAll with all hashes', () => {
      render(<SelectionToolbar {...defaultProps} />);
      fireEvent.click(screen.getByTestId('select-all-button'));
      expect(mockSelectAll).toHaveBeenCalledWith(allHashes);
    });

    it('should be disabled when all books are selected', () => {
      vi.mocked(useLibraryViewStore).mockReturnValue({
        selectedBooks: allHashes,
        selectAll: mockSelectAll,
        clearSelection: mockClearSelection,
        setSelectMode: mockSetSelectMode,
      });

      render(<SelectionToolbar {...defaultProps} />);
      expect(screen.getByTestId('select-all-button').hasAttribute('disabled')).toBe(true);
    });

    it('should be enabled when not all books are selected', () => {
      render(<SelectionToolbar {...defaultProps} />);
      expect(screen.getByTestId('select-all-button').hasAttribute('disabled')).toBe(false);
    });
  });

  describe('Clear Button', () => {
    it('should call clearSelection', () => {
      render(<SelectionToolbar {...defaultProps} />);
      fireEvent.click(screen.getByTestId('clear-button'));
      expect(mockClearSelection).toHaveBeenCalled();
    });

    it('should be disabled when no selection', () => {
      vi.mocked(useLibraryViewStore).mockReturnValue({
        selectedBooks: [],
        selectAll: mockSelectAll,
        clearSelection: mockClearSelection,
        setSelectMode: mockSetSelectMode,
      });

      render(<SelectionToolbar {...defaultProps} />);
      expect(screen.getByTestId('clear-button').hasAttribute('disabled')).toBe(true);
    });

    it('should be enabled when there is a selection', () => {
      render(<SelectionToolbar {...defaultProps} />);
      expect(screen.getByTestId('clear-button').hasAttribute('disabled')).toBe(false);
    });
  });

  describe('Cancel Button', () => {
    it('should exit select mode on cancel', () => {
      render(<SelectionToolbar {...defaultProps} />);
      fireEvent.click(screen.getByTestId('cancel-button'));
      expect(mockSetSelectMode).toHaveBeenCalledWith(false);
    });
  });

  describe('Want to Read Action', () => {
    it('should call bulkSetReadingStatus with unread status', async () => {
      render(<SelectionToolbar {...defaultProps} />);
      fireEvent.click(screen.getByTestId('want-to-read-button'));
      expect(mockBulkSetReadingStatus).toHaveBeenCalledWith(['book-1', 'book-2'], 'unread');
    });

    it('should have correct title attribute', () => {
      render(<SelectionToolbar {...defaultProps} />);
      expect(screen.getByTestId('want-to-read-button').getAttribute('title')).toBe(
        'Add to Want to Read',
      );
    });

    it('should be disabled when no selection', () => {
      vi.mocked(useLibraryViewStore).mockReturnValue({
        selectedBooks: [],
        selectAll: mockSelectAll,
        clearSelection: mockClearSelection,
        setSelectMode: mockSetSelectMode,
      });

      render(<SelectionToolbar {...defaultProps} />);
      expect(screen.getByTestId('want-to-read-button').hasAttribute('disabled')).toBe(true);
    });
  });

  describe('Finished Action', () => {
    it('should call bulkSetReadingStatus with finished status', async () => {
      render(<SelectionToolbar {...defaultProps} />);
      fireEvent.click(screen.getByTestId('finished-button'));
      expect(mockBulkSetReadingStatus).toHaveBeenCalledWith(['book-1', 'book-2'], 'finished');
    });

    it('should have correct title attribute', () => {
      render(<SelectionToolbar {...defaultProps} />);
      expect(screen.getByTestId('finished-button').getAttribute('title')).toBe('Mark as Finished');
    });

    it('should be disabled when no selection', () => {
      vi.mocked(useLibraryViewStore).mockReturnValue({
        selectedBooks: [],
        selectAll: mockSelectAll,
        clearSelection: mockClearSelection,
        setSelectMode: mockSetSelectMode,
      });

      render(<SelectionToolbar {...defaultProps} />);
      expect(screen.getByTestId('finished-button').hasAttribute('disabled')).toBe(true);
    });
  });

  describe('Collection Dialog', () => {
    it('should open collection dialog when button clicked', () => {
      render(<SelectionToolbar {...defaultProps} />);

      // Dialog should not be visible initially
      expect(screen.queryByTestId('collection-dialog')).toBeNull();

      // Click the collection button
      fireEvent.click(screen.getByTestId('collection-button'));

      // Dialog should now be visible
      expect(screen.getByTestId('collection-dialog')).toBeTruthy();
    });

    it('should pass selected books to collection dialog', () => {
      render(<SelectionToolbar {...defaultProps} />);
      fireEvent.click(screen.getByTestId('collection-button'));

      const dialog = screen.getByTestId('collection-dialog');
      expect(dialog.getAttribute('data-book-hashes')).toBe('book-1,book-2');
    });

    it('should be disabled when no selection', () => {
      vi.mocked(useLibraryViewStore).mockReturnValue({
        selectedBooks: [],
        selectAll: mockSelectAll,
        clearSelection: mockClearSelection,
        setSelectMode: mockSetSelectMode,
      });

      render(<SelectionToolbar {...defaultProps} />);
      expect(screen.getByTestId('collection-button').hasAttribute('disabled')).toBe(true);
    });
  });

  describe('Remove Dialog', () => {
    it('should open remove dialog when button clicked', () => {
      render(<SelectionToolbar {...defaultProps} />);

      // Dialog should not be visible initially
      expect(screen.queryByTestId('remove-dialog')).toBeNull();

      // Click the remove button
      fireEvent.click(screen.getByTestId('remove-button'));

      // Dialog should now be visible
      expect(screen.getByTestId('remove-dialog')).toBeTruthy();
    });

    it('should pass selected books to remove dialog', () => {
      render(<SelectionToolbar {...defaultProps} />);
      fireEvent.click(screen.getByTestId('remove-button'));

      const dialog = screen.getByTestId('remove-dialog');
      expect(dialog.getAttribute('data-book-hashes')).toBe('book-1,book-2');
    });

    it('should be disabled when no selection', () => {
      vi.mocked(useLibraryViewStore).mockReturnValue({
        selectedBooks: [],
        selectAll: mockSelectAll,
        clearSelection: mockClearSelection,
        setSelectMode: mockSetSelectMode,
      });

      render(<SelectionToolbar {...defaultProps} />);
      expect(screen.getByTestId('remove-button').hasAttribute('disabled')).toBe(true);
    });

    it('should have error styling', () => {
      render(<SelectionToolbar {...defaultProps} />);
      const removeButton = screen.getByTestId('remove-button');
      expect(removeButton.className).toContain('text-error');
    });
  });

  describe('Disabled State', () => {
    it('should disable all action buttons when no selection', () => {
      vi.mocked(useLibraryViewStore).mockReturnValue({
        selectedBooks: [],
        selectAll: mockSelectAll,
        clearSelection: mockClearSelection,
        setSelectMode: mockSetSelectMode,
      });

      render(<SelectionToolbar {...defaultProps} />);

      expect(screen.getByTestId('collection-button').hasAttribute('disabled')).toBe(true);
      expect(screen.getByTestId('want-to-read-button').hasAttribute('disabled')).toBe(true);
      expect(screen.getByTestId('finished-button').hasAttribute('disabled')).toBe(true);
      expect(screen.getByTestId('remove-button').hasAttribute('disabled')).toBe(true);
      expect(screen.getByTestId('clear-button').hasAttribute('disabled')).toBe(true);
    });

    it('should enable action buttons when there is a selection', () => {
      render(<SelectionToolbar {...defaultProps} />);

      expect(screen.getByTestId('collection-button').hasAttribute('disabled')).toBe(false);
      expect(screen.getByTestId('want-to-read-button').hasAttribute('disabled')).toBe(false);
      expect(screen.getByTestId('finished-button').hasAttribute('disabled')).toBe(false);
      expect(screen.getByTestId('remove-button').hasAttribute('disabled')).toBe(false);
      expect(screen.getByTestId('clear-button').hasAttribute('disabled')).toBe(false);
    });
  });

  describe('Styling and Layout', () => {
    it('should have fixed positioning at bottom', () => {
      const { container } = render(<SelectionToolbar {...defaultProps} />);
      const toolbar = container.querySelector('.fixed.bottom-0');
      expect(toolbar).toBeTruthy();
    });

    it('should have z-50 for overlay stacking', () => {
      const { container } = render(<SelectionToolbar {...defaultProps} />);
      const toolbar = container.querySelector('.z-50');
      expect(toolbar).toBeTruthy();
    });

    it('should have border and shadow', () => {
      const { container } = render(<SelectionToolbar {...defaultProps} />);
      const toolbar = container.querySelector('.border-t.shadow-lg');
      expect(toolbar).toBeTruthy();
    });

    it('should render icons for all action buttons', () => {
      render(<SelectionToolbar {...defaultProps} />);
      expect(screen.getByTestId('folder-plus-icon')).toBeTruthy();
      expect(screen.getByTestId('bookmark-plus-icon')).toBeTruthy();
      expect(screen.getByTestId('check-circle-icon')).toBeTruthy();
      expect(screen.getByTestId('trash-icon')).toBeTruthy();
      expect(screen.getByTestId('x-icon')).toBeTruthy();
    });
  });

  describe('No Selection Actions', () => {
    beforeEach(() => {
      vi.mocked(useLibraryViewStore).mockReturnValue({
        selectedBooks: [],
        selectAll: mockSelectAll,
        clearSelection: mockClearSelection,
        setSelectMode: mockSetSelectMode,
      });
    });

    it('should not call bulkSetReadingStatus for Want to Read when no selection', async () => {
      render(<SelectionToolbar {...defaultProps} />);
      // Button is disabled, verify the disabled state
      const button = screen.getByTestId('want-to-read-button');
      expect(button.hasAttribute('disabled')).toBe(true);
    });

    it('should not call bulkSetReadingStatus for Finished when no selection', async () => {
      render(<SelectionToolbar {...defaultProps} />);
      const button = screen.getByTestId('finished-button');
      expect(button.hasAttribute('disabled')).toBe(true);
    });
  });
});
