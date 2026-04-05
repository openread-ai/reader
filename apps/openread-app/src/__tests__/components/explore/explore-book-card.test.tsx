import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';
import {
  ExploreBookCard,
  getCoverPalette,
  getLanguageName,
  COVER_PALETTES,
  LANGUAGE_NAMES,
} from '@/components/explore/ExploreBookCard';
import type { CatalogBook } from '@/types/catalog';

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
});

const mockBook: CatalogBook = {
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
};

describe('ExploreBookCard', () => {
  describe('Rendering', () => {
    it('should render title and author', () => {
      render(<ExploreBookCard book={mockBook} />);
      // Title appears in both the gradient background and the metadata h3
      const titles = screen.getAllByText('Think Python');
      expect(titles.length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Allen B. Downey')).toBeTruthy();
    });

    it('should render language and format', () => {
      render(<ExploreBookCard book={mockBook} />);
      expect(screen.getByText(/English/)).toBeTruthy();
      expect(screen.getByText(/EPUB/)).toBeTruthy();
    });

    it('should render native language name for Hindi', () => {
      const hindiBook: CatalogBook = { ...mockBook, language: 'hi' };
      render(<ExploreBookCard book={hindiBook} />);
      expect(screen.getByText(/\u0939\u093F\u0928\u094D\u0926\u0940/)).toBeTruthy();
    });

    it('should render cover image when cover_image_key is present', () => {
      render(<ExploreBookCard book={mockBook} />);
      const img = screen.getByRole('img', { name: 'Think Python' });
      expect(img).toBeTruthy();
      expect(img.getAttribute('src')).toBe('/api/catalog-covers/covers/think-pythonthumb.jpg');
      expect(img.getAttribute('loading')).toBe('lazy');
    });

    it('should render gradient fallback when no cover image', () => {
      const noCoverBook: CatalogBook = { ...mockBook, cover_image_key: null };
      render(<ExploreBookCard book={noCoverBook} />);
      // No img element should be present
      expect(screen.queryByRole('img')).toBeNull();
      // Title should still show (in gradient fallback and metadata)
      const titles = screen.getAllByText('Think Python');
      expect(titles.length).toBeGreaterThanOrEqual(1);
    });

    it('should apply className prop', () => {
      const { container } = render(<ExploreBookCard book={mockBook} className='w-48' />);
      const outerDiv = container.firstElementChild;
      expect(outerDiv?.className).toContain('w-48');
    });

    it('should render book-spine overlay on covers', () => {
      const { container } = render(<ExploreBookCard book={mockBook} />);
      const spineElements = container.querySelectorAll('.book-spine');
      expect(spineElements.length).toBeGreaterThanOrEqual(1);
    });

    it('should render book-spine overlay on gradient fallback covers', () => {
      const noCoverBook: CatalogBook = { ...mockBook, cover_image_key: null };
      const { container } = render(<ExploreBookCard book={noCoverBook} />);
      const spineElements = container.querySelectorAll('.book-spine');
      expect(spineElements.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Default state - Add button (local books)', () => {
    it('should render Add button for local catalog books', () => {
      render(<ExploreBookCard book={mockBook} />);
      const addBtn = screen.getByRole('button', { name: /add to library/i });
      expect(addBtn).toBeTruthy();
    });

    it('should call onAction when Add button is clicked', () => {
      const onAction = vi.fn();
      render(<ExploreBookCard book={mockBook} onAction={onAction} />);
      fireEvent.click(screen.getByRole('button', { name: /add to library/i }));
      expect(onAction).toHaveBeenCalledWith('test-uuid-1234');
    });
  });

  describe('IA state - Import button', () => {
    it('should render Import button for IA books', () => {
      render(<ExploreBookCard book={mockBook} isIA />);
      const importBtn = screen.getByRole('button', { name: /add to library/i });
      expect(importBtn).toBeTruthy();
    });

    it('should call onAction when Import button is clicked', () => {
      const onAction = vi.fn();
      render(<ExploreBookCard book={mockBook} isIA onAction={onAction} />);
      fireEvent.click(screen.getByRole('button', { name: /add to library/i }));
      expect(onAction).toHaveBeenCalledWith('test-uuid-1234');
    });

    it('should show IA badge when isIA is true', () => {
      render(<ExploreBookCard book={mockBook} isIA />);
      const badges = screen.getAllByLabelText(/internet archive/i);
      expect(badges.length).toBeGreaterThanOrEqual(1);
    });

    it('should not show IA badge when isIA is false', () => {
      render(<ExploreBookCard book={mockBook} />);
      expect(screen.queryByLabelText(/internet archive/i)).toBeNull();
    });
  });

  describe('Wishlist heart', () => {
    it('should render wishlist button', () => {
      render(<ExploreBookCard book={mockBook} />);
      const heartBtn = screen.getByRole('button', { name: /wishlist/i });
      expect(heartBtn).toBeTruthy();
    });

    it('should show filled heart when wishlisted', () => {
      render(<ExploreBookCard book={mockBook} isWishlisted />);
      const heartBtn = screen.getByRole('button', { name: /remove from wishlist/i });
      expect(heartBtn).toBeTruthy();
    });

    it('should show outline heart when not wishlisted', () => {
      render(<ExploreBookCard book={mockBook} isWishlisted={false} />);
      const heartBtn = screen.getByRole('button', { name: /add to wishlist/i });
      expect(heartBtn).toBeTruthy();
    });

    it('should call onWishlistToggle when heart is clicked', () => {
      const onToggle = vi.fn();
      render(<ExploreBookCard book={mockBook} onWishlistToggle={onToggle} />);
      fireEvent.click(screen.getByRole('button', { name: /wishlist/i }));
      expect(onToggle).toHaveBeenCalledWith('test-uuid-1234');
    });

    it('should have 44px tap target (h-11 w-11)', () => {
      render(<ExploreBookCard book={mockBook} />);
      const heartBtn = screen.getByRole('button', { name: /wishlist/i });
      expect(heartBtn.className).toContain('h-11');
      expect(heartBtn.className).toContain('w-11');
    });
  });

  describe('Importing state', () => {
    it('should display progress bar when importing', () => {
      render(<ExploreBookCard book={mockBook} state='importing' importProgress={60} />);
      expect(screen.getByText(/adding/i)).toBeTruthy();
      // Percentage appears in both the span and the mocked Progress
      const percentages = screen.getAllByText(/60%/);
      expect(percentages.length).toBeGreaterThanOrEqual(1);
    });

    it('should show 0% progress at start of import', () => {
      render(<ExploreBookCard book={mockBook} state='importing' importProgress={0} />);
      expect(screen.getByText(/adding/i)).toBeTruthy();
      // Percentage appears in both the span and the mocked Progress
      const percentages = screen.getAllByText(/0%/);
      expect(percentages.length).toBeGreaterThanOrEqual(1);
    });

    it('should not show Add button when importing', () => {
      render(<ExploreBookCard book={mockBook} state='importing' importProgress={60} />);
      expect(screen.queryByRole('button', { name: /add to library/i })).toBeNull();
    });

    it('should still show wishlist heart when importing', () => {
      render(<ExploreBookCard book={mockBook} state='importing' importProgress={60} />);
      expect(screen.getByRole('button', { name: /wishlist/i })).toBeTruthy();
    });
  });

  describe('In-library state', () => {
    it('should display Open button when in library', () => {
      render(<ExploreBookCard book={mockBook} state='in-library' />);
      const openBtn = screen.getByRole('button', { name: /open/i });
      expect(openBtn).toBeTruthy();
    });

    it('should call onOpen when Open button is clicked', () => {
      const onOpen = vi.fn();
      render(<ExploreBookCard book={mockBook} state='in-library' onOpen={onOpen} />);
      fireEvent.click(screen.getByRole('button', { name: /open/i }));
      expect(onOpen).toHaveBeenCalledWith('test-uuid-1234');
    });

    it('should not show Add button when in library', () => {
      render(<ExploreBookCard book={mockBook} state='in-library' />);
      expect(screen.queryByRole('button', { name: /add to library/i })).toBeNull();
    });
  });

  describe('Long title handling', () => {
    it('should render long title with line-clamp-2', () => {
      const longTitleBook: CatalogBook = {
        ...mockBook,
        title:
          'A Comprehensive Introduction to the Theory and Practice of Modern Distributed Systems Architecture',
      };
      render(<ExploreBookCard book={longTitleBook} />);
      const titleEl = screen.getByText(longTitleBook.title);
      expect(titleEl.className).toContain('line-clamp-2');
    });
  });

  describe('Format display', () => {
    it('should uppercase the format type', () => {
      render(<ExploreBookCard book={mockBook} />);
      expect(screen.getByText(/EPUB/)).toBeTruthy();
    });

    it('should default to EPUB when format_type is empty', () => {
      const noFormatBook: CatalogBook = { ...mockBook, format_type: '' };
      render(<ExploreBookCard book={noFormatBook} />);
      expect(screen.getByText(/EPUB/)).toBeTruthy();
    });
  });
});

describe('getCoverPalette', () => {
  it('should return a valid palette for any string', () => {
    const palette = getCoverPalette('test-id');
    expect(palette).toHaveProperty('from');
    expect(palette).toHaveProperty('to');
    expect(palette).toHaveProperty('text');
  });

  it('should return deterministic results', () => {
    const palette1 = getCoverPalette('same-id');
    const palette2 = getCoverPalette('same-id');
    expect(palette1).toBe(palette2);
  });

  it('should return different palettes for different IDs', () => {
    // With 6 palettes, different strings should produce different results
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const palettes = ids.map(getCoverPalette);
    const unique = new Set(palettes.map((p) => p.from));
    // At least 2 different palettes should be produced
    expect(unique.size).toBeGreaterThanOrEqual(2);
  });

  it('should always return a palette from COVER_PALETTES', () => {
    const palette = getCoverPalette('any-random-string');
    expect(COVER_PALETTES).toContain(palette);
  });
});

describe('getLanguageName', () => {
  it('should return English for en', () => {
    expect(getLanguageName('en')).toBe('English');
  });

  it('should return native Hindi for hi', () => {
    expect(getLanguageName('hi')).toBe('\u0939\u093F\u0928\u094D\u0926\u0940');
  });

  it('should return uppercased code for unknown languages', () => {
    expect(getLanguageName('xx')).toBe('XX');
  });

  it('should have entries for all documented languages', () => {
    const expected = [
      'en',
      'hi',
      'ta',
      'te',
      'bn',
      'mr',
      'gu',
      'kn',
      'ml',
      'pa',
      'ur',
      'sa',
      'fr',
      'de',
      'es',
      'pt',
    ];
    for (const code of expected) {
      expect(LANGUAGE_NAMES[code]).toBeTruthy();
    }
  });
});
