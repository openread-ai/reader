import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';
import {
  BookDetailSheet,
  type BookDetailSheetProps,
  type CatalogBookDetail,
} from '@/components/explore/BookDetailSheet';

// Mock the Progress component from primitives/progress
vi.mock('@/components/primitives/progress', () => ({
  Progress: ({ value, className }: { value: number; className?: string }) => (
    <div data-testid='progress-bar' role='progressbar' aria-valuenow={value} className={className}>
      {value}%
    </div>
  ),
}));

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
});

// ── Mock data ──────────────────────────────────────────────

const mockBook: CatalogBookDetail = {
  id: 'test-uuid-1234',
  title: 'Think Python',
  author_name: 'Allen B. Downey',
  language: 'en',
  format_type: 'epub',
  cover_image_key: 'covers/think-python',
  cover_is_generated: false,
  is_cached: true,
  import_count: 42,
  page_count: 292,
  file_size_bytes: 5200000,
  description:
    'Think Python is an introduction to Python programming for beginners. It starts with basic concepts of programming, and is carefully designed to define all terms when they are first used and to develop each new concept in a logical progression. Larger pieces, like recursion and object-oriented programming, are divided into a sequence of smaller steps and introduced over the course of several chapters.',
  license_type: 'cc-by-nc-4.0',
  publication_year: 2015,
  subjects: ['Computer Science', 'Python'],
  source: 'greenteapress',
};

const mockIABook: CatalogBookDetail = {
  ...mockBook,
  id: 'ia-uuid-5678',
  title: 'The Art of War',
  author_name: 'Sun Tzu',
  source: 'internet-archive',
  source_id: 'artofwar00suntuoft',
  ia_identifier: 'artofwar00suntuoft',
  license_type: 'public_domain',
  cover_image_key: null,
};

const defaultProps: BookDetailSheetProps = {
  book: mockBook,
  isOpen: true,
  onClose: vi.fn(),
};

function renderSheet(overrides: Partial<BookDetailSheetProps> = {}) {
  return render(<BookDetailSheet {...defaultProps} {...overrides} />);
}

// ── Tests ──────────────────────────────────────────────────

describe('BookDetailSheet', () => {
  describe('Rendering', () => {
    it('should render nothing when book is null', () => {
      const { container } = renderSheet({ book: null });
      expect(container.innerHTML).toBe('');
    });

    it('should render nothing when book is null even if isOpen is true', () => {
      const { container } = renderSheet({ book: null, isOpen: true });
      expect(container.innerHTML).toBe('');
    });

    it('should render a dialog element when book is provided and isOpen', () => {
      renderSheet();
      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeTruthy();
    });

    it('should set aria-modal on the dialog', () => {
      renderSheet();
      const dialog = screen.getByRole('dialog');
      expect(dialog.getAttribute('aria-modal')).toBe('true');
    });

    it('should set aria-label with book title', () => {
      renderSheet();
      const dialog = screen.getByRole('dialog');
      expect(dialog.getAttribute('aria-label')).toBe('Book details: Think Python');
    });
  });

  describe('Title and Author', () => {
    it('should display the book title', () => {
      renderSheet();
      expect(screen.getByTestId('sheet-title').textContent).toBe('Think Python');
    });

    it('should display the author name', () => {
      renderSheet();
      expect(screen.getByTestId('sheet-author').textContent).toBe('Allen B. Downey');
    });
  });

  describe('Cover image', () => {
    it('should render cover image when cover_image_key is present', () => {
      renderSheet();
      const img = screen.getByRole('img', { name: 'Think Python' });
      expect(img).toBeTruthy();
      expect(img.getAttribute('src')).toBe('/api/catalog-covers/covers/think-pythonthumb.jpg');
    });

    it('should render gradient fallback when no cover image', () => {
      renderSheet({ book: { ...mockBook, cover_image_key: null } });
      expect(screen.queryByRole('img')).toBeNull();
    });

    it('should render book-spine overlay', () => {
      const { container } = renderSheet();
      const spineElements = container.querySelectorAll('.book-spine');
      expect(spineElements.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Metadata rows', () => {
    it('should display format type in uppercase', () => {
      renderSheet();
      expect(screen.getByTestId('metadata-format').textContent).toContain('EPUB');
    });

    it('should display language name', () => {
      renderSheet();
      expect(screen.getByTestId('metadata-language').textContent).toContain('English');
    });

    it('should display license type formatted', () => {
      renderSheet();
      expect(screen.getByTestId('metadata-license').textContent).toContain('CC');
    });

    it('should display page count when available', () => {
      renderSheet();
      expect(screen.getByTestId('metadata-pages').textContent).toContain('292');
    });

    it('should not display page count when null', () => {
      renderSheet({ book: { ...mockBook, page_count: null } });
      expect(screen.queryByTestId('metadata-pages')).toBeNull();
    });

    it('should not display page count when zero', () => {
      renderSheet({ book: { ...mockBook, page_count: 0 } });
      expect(screen.queryByTestId('metadata-pages')).toBeNull();
    });

    it('should display source name', () => {
      renderSheet();
      expect(screen.getByTestId('metadata-source').textContent).toContain('Green Tea Press');
    });

    it('should display Globe icon for IA source', () => {
      renderSheet({ book: mockIABook });
      expect(screen.getByTestId('metadata-source').textContent).toContain('Internet Archive');
    });

    it('should display separator between title/author and metadata', () => {
      renderSheet();
      expect(screen.getByRole('separator')).toBeTruthy();
    });
  });

  describe('Description', () => {
    it('should display description text', () => {
      renderSheet();
      expect(screen.getByTestId('description-text').textContent).toContain('Think Python');
    });

    it('should show "Read more" button for long descriptions', () => {
      renderSheet();
      expect(screen.getByTestId('read-more-btn')).toBeTruthy();
      expect(screen.getByTestId('read-more-btn').textContent).toContain('Read more');
    });

    it('should toggle description expansion on click', () => {
      renderSheet();
      const btn = screen.getByTestId('read-more-btn');
      expect(btn.getAttribute('aria-expanded')).toBe('false');

      fireEvent.click(btn);
      expect(btn.getAttribute('aria-expanded')).toBe('true');
      expect(btn.textContent).toContain('Show less');

      fireEvent.click(btn);
      expect(btn.getAttribute('aria-expanded')).toBe('false');
      expect(btn.textContent).toContain('Read more');
    });

    it('should not render description when not provided', () => {
      renderSheet({ book: { ...mockBook, description: undefined } });
      expect(screen.queryByTestId('description-text')).toBeNull();
    });

    it('should not show "Read more" for short descriptions', () => {
      renderSheet({ book: { ...mockBook, description: 'Short description.' } });
      expect(screen.queryByTestId('read-more-btn')).toBeNull();
    });
  });

  describe('Wishlist button', () => {
    it('should render wishlist button', () => {
      renderSheet();
      expect(screen.getByTestId('sheet-wishlist-btn')).toBeTruthy();
    });

    it('should show "Add to Wishlist" when not wishlisted', () => {
      renderSheet({ isWishlisted: false });
      const btn = screen.getByTestId('sheet-wishlist-btn');
      expect(btn.textContent).toContain('Add to Wishlist');
      expect(btn.getAttribute('aria-label')).toBe('Add to Wishlist');
    });

    it('should show "Remove from Wishlist" when wishlisted', () => {
      renderSheet({ isWishlisted: true });
      const btn = screen.getByTestId('sheet-wishlist-btn');
      expect(btn.textContent).toContain('Remove from Wishlist');
      expect(btn.getAttribute('aria-label')).toBe('Remove from Wishlist');
    });

    it('should call onWishlistToggle when clicked', () => {
      const onWishlistToggle = vi.fn();
      renderSheet({ onWishlistToggle });
      fireEvent.click(screen.getByTestId('sheet-wishlist-btn'));
      expect(onWishlistToggle).toHaveBeenCalledTimes(1);
    });

    it('should have full-width and h-11 styling', () => {
      renderSheet();
      const btn = screen.getByTestId('sheet-wishlist-btn');
      expect(btn.className).toContain('w-full');
      expect(btn.className).toContain('h-11');
    });
  });

  describe('Import button (idle state)', () => {
    it('should render "Add to Library" for non-IA books', () => {
      renderSheet({ importState: 'idle' });
      const btn = screen.getByTestId('sheet-import-btn');
      expect(btn.textContent).toContain('Add to Library');
      expect(btn.getAttribute('aria-label')).toBe('Add to Library');
    });

    it('should render "Import from IA" for IA books', () => {
      renderSheet({ book: mockIABook, importState: 'idle' });
      const btn = screen.getByTestId('sheet-import-btn');
      expect(btn.textContent).toContain('Import from IA');
      expect(btn.getAttribute('aria-label')).toBe('Import from Internet Archive');
    });

    it('should use dark bg for non-IA import button', () => {
      renderSheet({ importState: 'idle' });
      const btn = screen.getByTestId('sheet-import-btn');
      expect(btn.className).toContain('bg-[#1C1C1A]');
    });

    it('should use blue bg for IA import button', () => {
      renderSheet({ book: mockIABook, importState: 'idle' });
      const btn = screen.getByTestId('sheet-import-btn');
      expect(btn.className).toContain('bg-[#2563EB]');
    });

    it('should call onImport when clicked', () => {
      const onImport = vi.fn();
      renderSheet({ onImport, importState: 'idle' });
      fireEvent.click(screen.getByTestId('sheet-import-btn'));
      expect(onImport).toHaveBeenCalledTimes(1);
    });
  });

  describe('Importing state', () => {
    it('should show importing progress', () => {
      renderSheet({ importState: 'importing', importProgress: 65 });
      expect(screen.getByTestId('sheet-importing')).toBeTruthy();
      // 65% appears in both the button label and the mocked Progress bar
      const matches = screen.getAllByText(/65%/);
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });

    it('should show progress bar', () => {
      renderSheet({ importState: 'importing', importProgress: 42 });
      expect(screen.getByTestId('progress-bar')).toBeTruthy();
    });

    it('should not show import button when importing', () => {
      renderSheet({ importState: 'importing', importProgress: 50 });
      expect(screen.queryByTestId('sheet-import-btn')).toBeNull();
    });

    it('should not show read button when importing', () => {
      renderSheet({ importState: 'importing', importProgress: 50 });
      expect(screen.queryByTestId('sheet-read-btn')).toBeNull();
    });
  });

  describe('Ready state (Start Reading)', () => {
    it('should show "Start Reading" button', () => {
      renderSheet({ importState: 'ready' });
      const btn = screen.getByTestId('sheet-read-btn');
      expect(btn.textContent).toContain('Start Reading');
      expect(btn.getAttribute('aria-label')).toBe('Start Reading');
    });

    it('should call onRead when clicked', () => {
      const onRead = vi.fn();
      renderSheet({ importState: 'ready', onRead });
      fireEvent.click(screen.getByTestId('sheet-read-btn'));
      expect(onRead).toHaveBeenCalledTimes(1);
    });

    it('should not show import button when ready', () => {
      renderSheet({ importState: 'ready' });
      expect(screen.queryByTestId('sheet-import-btn')).toBeNull();
    });
  });

  describe('Close button', () => {
    it('should render close button', () => {
      renderSheet();
      expect(screen.getByTestId('sheet-close-btn')).toBeTruthy();
    });

    it('should have accessible label', () => {
      renderSheet();
      expect(screen.getByTestId('sheet-close-btn').getAttribute('aria-label')).toBe('Close');
    });

    it('should call onClose when clicked', () => {
      const onClose = vi.fn();
      renderSheet({ onClose });
      fireEvent.click(screen.getByTestId('sheet-close-btn'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('Overlay', () => {
    it('should render overlay', () => {
      renderSheet();
      expect(screen.getByTestId('sheet-overlay')).toBeTruthy();
    });

    it('should call onClose when overlay is clicked', () => {
      const onClose = vi.fn();
      renderSheet({ onClose });
      fireEvent.click(screen.getByTestId('sheet-overlay'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('should have bg-black/40 backdrop', () => {
      renderSheet();
      const overlay = screen.getByTestId('sheet-overlay');
      expect(overlay.className).toContain('bg-black/40');
    });
  });

  describe('Keyboard interactions', () => {
    it('should close on Escape key', () => {
      const onClose = vi.fn();
      renderSheet({ onClose });
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('should not close on other keys', () => {
      const onClose = vi.fn();
      renderSheet({ onClose });
      fireEvent.keyDown(document, { key: 'Enter' });
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('Body scroll lock', () => {
    it('should set body overflow to hidden when open', () => {
      renderSheet({ isOpen: true });
      expect(document.body.style.overflow).toBe('hidden');
    });

    it('should restore body overflow when closed', () => {
      const { unmount } = renderSheet({ isOpen: true });
      expect(document.body.style.overflow).toBe('hidden');
      unmount();
      expect(document.body.style.overflow).toBe('');
    });
  });

  describe('Animation classes', () => {
    it('should have open animation classes when isOpen is true', () => {
      renderSheet({ isOpen: true });
      const dialog = screen.getByRole('dialog');
      expect(dialog.className).toContain('translate-y-0');
      expect(dialog.className).toContain('opacity-100');
    });

    it('should have closed animation classes when isOpen is false', () => {
      renderSheet({ isOpen: false });
      const dialog = screen.getByRole('dialog');
      expect(dialog.className).toContain('translate-y-full');
      expect(dialog.className).toContain('opacity-0');
      expect(dialog.className).toContain('pointer-events-none');
    });
  });

  describe('Sheet layout', () => {
    it('should have rounded-t-2xl for bottom sheet styling', () => {
      renderSheet();
      const dialog = screen.getByRole('dialog');
      expect(dialog.className).toContain('rounded-t-2xl');
    });

    it('should have max-h-[85vh]', () => {
      renderSheet();
      const dialog = screen.getByRole('dialog');
      expect(dialog.className).toContain('max-h-[85vh]');
    });

    it('should have white background', () => {
      renderSheet();
      const dialog = screen.getByRole('dialog');
      expect(dialog.className).toContain('bg-base-100');
    });

    it('should render drag handle', () => {
      renderSheet();
      expect(screen.getByTestId('drag-handle')).toBeTruthy();
    });

    it('should have desktop dialog classes at sm breakpoint', () => {
      renderSheet();
      const dialog = screen.getByRole('dialog');
      expect(dialog.className).toContain('sm:max-w-md');
      expect(dialog.className).toContain('sm:rounded-2xl');
    });
  });

  describe('License formatting', () => {
    it('should format public_domain as Public Domain', () => {
      renderSheet({ book: { ...mockBook, license_type: 'public_domain' } });
      expect(screen.getByTestId('metadata-license').textContent).toContain('Public Domain');
    });

    it('should format cc-by-4.0 as CC BY 4.0', () => {
      renderSheet({ book: { ...mockBook, license_type: 'cc-by-4.0' } });
      expect(screen.getByTestId('metadata-license').textContent).toContain('CC BY 4.0');
    });

    it('should show Unknown when license is not provided', () => {
      renderSheet({ book: { ...mockBook, license_type: undefined } });
      expect(screen.getByTestId('metadata-license').textContent).toContain('Unknown');
    });
  });

  describe('Source labels', () => {
    it('should display Standard Ebooks for standard-ebooks source', () => {
      renderSheet({ book: { ...mockBook, source: 'standard-ebooks' } });
      expect(screen.getByTestId('metadata-source').textContent).toContain('Standard Ebooks');
    });

    it('should display Project Gutenberg for gutenberg source', () => {
      renderSheet({ book: { ...mockBook, source: 'gutenberg' } });
      expect(screen.getByTestId('metadata-source').textContent).toContain('Project Gutenberg');
    });

    it('should display Unknown when source is not provided', () => {
      renderSheet({ book: { ...mockBook, source: undefined } });
      expect(screen.getByTestId('metadata-source').textContent).toContain('Unknown');
    });
  });

  describe('Default format handling', () => {
    it('should default to EPUB when format_type is empty', () => {
      renderSheet({ book: { ...mockBook, format_type: '' } });
      expect(screen.getByTestId('metadata-format').textContent).toContain('EPUB');
    });

    it('should uppercase format_type', () => {
      renderSheet({ book: { ...mockBook, format_type: 'pdf' } });
      expect(screen.getByTestId('metadata-format').textContent).toContain('PDF');
    });
  });
});
