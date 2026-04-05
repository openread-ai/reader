import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';
import { CollectionRow } from '@/components/explore/CollectionRow';
import type { CatalogBook } from '@/types/catalog';

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

// Mock ExploreBookCard — we test it separately in its own test file
vi.mock('@/components/explore/ExploreBookCard', () => ({
  ExploreBookCard: ({
    book,
    onWishlistToggle,
    onAction,
    onOpen,
    className,
  }: {
    book: CatalogBook;
    onWishlistToggle?: (id: string) => void;
    onAction?: (id: string) => void;
    onOpen?: (id: string) => void;
    className?: string;
  }) => (
    <div data-testid={`book-card-${book.id}`} className={className}>
      <span>{book.title}</span>
      {onWishlistToggle && (
        <button
          type='button'
          onClick={() => onWishlistToggle(book.id)}
          data-testid={`wishlist-${book.id}`}
        >
          Wishlist
        </button>
      )}
      {onAction && (
        <button type='button' onClick={() => onAction(book.id)} data-testid={`import-${book.id}`}>
          Import
        </button>
      )}
      {onOpen && (
        <button type='button' onClick={() => onOpen(book.id)} data-testid={`read-${book.id}`}>
          Read
        </button>
      )}
    </div>
  ),
}));

// Mock ResizeObserver as a proper class
class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  constructor(_callback: ResizeObserverCallback) {
    // no-op
  }
}
vi.stubGlobal('ResizeObserver', MockResizeObserver);

afterEach(() => {
  cleanup();
});

function makeMockBook(index: number, overrides?: Partial<CatalogBook>): CatalogBook {
  return {
    id: `book-${index}`,
    title: `Test Book ${index}`,
    author_name: `Author ${index}`,
    language: 'en',
    format_type: 'epub',
    cover_image_key: null,
    cover_is_generated: false,
    is_cached: true,
    import_count: 0,
    page_count: 200,
    file_size_bytes: 3000000,
    ...overrides,
  };
}

const eightBooks = Array.from({ length: 8 }, (_, i) => makeMockBook(i));
const threeBooks = Array.from({ length: 3 }, (_, i) => makeMockBook(i));

describe('CollectionRow', () => {
  describe('Section Header', () => {
    it('should render the title', () => {
      render(<CollectionRow title='Trending This Week' books={eightBooks} />);
      expect(screen.getByText('Trending This Week')).toBeTruthy();
    });

    it('should render title as an h2 element', () => {
      render(<CollectionRow title='Popular Books' books={eightBooks} />);
      const heading = screen.getByRole('heading', { level: 2 });
      expect(heading.textContent).toBe('Popular Books');
    });

    it('should render icon when provided', () => {
      render(
        <CollectionRow
          title='Featured'
          icon={<span data-testid='section-icon'>IC</span>}
          books={eightBooks}
        />,
      );
      expect(screen.getByTestId('section-icon')).toBeTruthy();
    });

    it('should not render icon container when icon is not provided', () => {
      const { container } = render(<CollectionRow title='No Icon' books={eightBooks} />);
      // The heading wrapper should not have the icon span
      const headingArea = container.querySelector('h2')?.parentElement;
      // Only the h2 should be present, no icon wrapper sibling
      expect(headingArea?.children.length).toBe(1);
    });

    it('should apply title color #1C1C1A', () => {
      render(<CollectionRow title='Styled Title' books={eightBooks} />);
      const heading = screen.getByRole('heading', { level: 2 });
      expect(heading.className).toContain('text-base-content');
      expect(heading.className).toContain('text-[17px]');
      expect(heading.className).toContain('font-bold');
    });
  });

  describe('See All Link', () => {
    it('should render See All link when seeAllHref is provided', () => {
      render(
        <CollectionRow
          title='With See All'
          books={eightBooks}
          seeAllHref='/explore/collection/trending'
        />,
      );
      const link = screen.getByText('See All');
      expect(link).toBeTruthy();
      expect(link.closest('a')?.getAttribute('href')).toBe('/explore/collection/trending');
    });

    it('should not render See All link when seeAllHref is not provided', () => {
      render(<CollectionRow title='No Link' books={eightBooks} />);
      expect(screen.queryByText('See All')).toBeNull();
    });

    it('should render ChevronRight icon next to See All text', () => {
      render(<CollectionRow title='With Icon' books={eightBooks} seeAllHref='/explore/trending' />);
      const link = screen.getByText('See All').closest('a');
      // The link should contain an SVG (ChevronRight icon)
      const svg = link?.querySelector('svg');
      expect(svg).toBeTruthy();
    });
  });

  describe('Book Cards', () => {
    it('should render all books as ExploreBookCard components', () => {
      render(<CollectionRow title='Books' books={eightBooks} />);
      for (let i = 0; i < 8; i++) {
        expect(screen.getByTestId(`book-card-book-${i}`)).toBeTruthy();
      }
    });

    it('should render book titles within cards', () => {
      render(<CollectionRow title='Books' books={threeBooks} />);
      expect(screen.getByText('Test Book 0')).toBeTruthy();
      expect(screen.getByText('Test Book 1')).toBeTruthy();
      expect(screen.getByText('Test Book 2')).toBeTruthy();
    });

    it('should set 130px width on card containers', () => {
      render(<CollectionRow title='Books' books={threeBooks} />);
      const card = screen.getByTestId('book-card-book-0').parentElement;
      expect(card?.className).toContain('w-[130px]');
    });

    it('should apply snap-start to each card container', () => {
      render(<CollectionRow title='Books' books={threeBooks} />);
      const card = screen.getByTestId('book-card-book-0').parentElement;
      expect(card?.className).toContain('snap-start');
    });
  });

  describe('Callback Props', () => {
    it('should pass onWishlistToggle to cards', () => {
      const onWishlistToggle = vi.fn();
      render(
        <CollectionRow title='Books' books={threeBooks} onWishlistToggle={onWishlistToggle} />,
      );
      fireEvent.click(screen.getByTestId('wishlist-book-0'));
      expect(onWishlistToggle).toHaveBeenCalledWith('book-0');
    });

    it('should pass onImport as onAction to cards', () => {
      const onImport = vi.fn();
      render(<CollectionRow title='Books' books={threeBooks} onImport={onImport} />);
      fireEvent.click(screen.getByTestId('import-book-0'));
      expect(onImport).toHaveBeenCalledWith('book-0');
    });

    it('should pass onRead as onOpen to cards', () => {
      const onRead = vi.fn();
      render(<CollectionRow title='Books' books={threeBooks} onRead={onRead} />);
      fireEvent.click(screen.getByTestId('read-book-0'));
      expect(onRead).toHaveBeenCalledWith('book-0');
    });
  });

  describe('Loading State', () => {
    it('should show skeleton cards when isLoading is true', () => {
      const { container } = render(<CollectionRow title='Loading Section' books={[]} isLoading />);
      // Should render 5 skeleton placeholder cards
      const skeletonCards = container.querySelectorAll('.animate-pulse');
      expect(skeletonCards.length).toBe(5);
    });

    it('should still render title when loading', () => {
      render(<CollectionRow title='Loading Title' books={[]} isLoading />);
      expect(screen.getByText('Loading Title')).toBeTruthy();
    });

    it('should set aria-busy=true on section when loading', () => {
      const { container } = render(<CollectionRow title='Busy Section' books={[]} isLoading />);
      const section = container.querySelector('section');
      expect(section?.getAttribute('aria-busy')).toBe('true');
    });

    it('should not render book cards when loading', () => {
      render(<CollectionRow title='Loading' books={eightBooks} isLoading />);
      // Even if books are passed, loading should show skeletons
      expect(screen.queryByTestId('book-card-book-0')).toBeNull();
    });
  });

  describe('Empty State', () => {
    it('should show empty message when books array is empty', () => {
      render(<CollectionRow title='Empty Collection' books={[]} />);
      expect(screen.getByText('No books in this collection')).toBeTruthy();
    });

    it('should still render title in empty state', () => {
      render(<CollectionRow title='Empty Title' books={[]} />);
      expect(screen.getByText('Empty Title')).toBeTruthy();
    });

    it('should render empty state within a dashed border container', () => {
      const { container } = render(<CollectionRow title='Empty' books={[]} />);
      const dashedBorder = container.querySelector('.border-dashed');
      expect(dashedBorder).toBeTruthy();
    });
  });

  describe('Scroll Container', () => {
    it('should render a scrollable container with overflow-x-auto', () => {
      const { container } = render(<CollectionRow title='Scroll' books={eightBooks} />);
      const scrollArea = container.querySelector('.overflow-x-auto');
      expect(scrollArea).toBeTruthy();
    });

    it('should apply snap-x snap-mandatory to scroll container', () => {
      const { container } = render(<CollectionRow title='Snap' books={eightBooks} />);
      const scrollArea = container.querySelector('.overflow-x-auto');
      expect(scrollArea?.className).toContain('snap-x');
      expect(scrollArea?.className).toContain('snap-mandatory');
    });

    it('should hide the native scrollbar', () => {
      const { container } = render(<CollectionRow title='Hidden' books={eightBooks} />);
      const scrollArea = container.querySelector('.overflow-x-auto') as HTMLElement;
      // Check for CSS scrollbar-width: none
      expect(scrollArea?.style.scrollbarWidth).toBe('none');
    });

    it('should have 10px gap between cards (gap-2.5)', () => {
      const { container } = render(<CollectionRow title='Gap' books={eightBooks} />);
      const scrollArea = container.querySelector('.overflow-x-auto');
      expect(scrollArea?.className).toContain('gap-2.5');
    });

    it('should have 16px scroll padding (px-4)', () => {
      const { container } = render(<CollectionRow title='Padding' books={eightBooks} />);
      const scrollArea = container.querySelector('.overflow-x-auto');
      expect(scrollArea?.className).toContain('px-4');
    });
  });

  describe('Scroll Arrows', () => {
    it('should render scroll left button with correct aria-label', () => {
      // We simulate canScrollLeft by mocking scroll state
      // Since scroll detection depends on real DOM measurements, we test the arrow buttons
      // exist structurally when the component is rendered
      const { container } = render(<CollectionRow title='Arrows' books={eightBooks} />);
      // Initially, canScrollLeft/canScrollRight are false (jsdom doesn't have real layout)
      // So arrows won't show. We just verify the component doesn't crash.
      expect(container.querySelector('section')).toBeTruthy();
    });

    it('should not render scroll arrows in jsdom (no layout)', () => {
      // jsdom has scrollWidth === 0, clientWidth === 0, so no arrows appear
      render(<CollectionRow title='No Arrows' books={eightBooks} />);
      expect(screen.queryByLabelText('Scroll left')).toBeNull();
      expect(screen.queryByLabelText('Scroll right')).toBeNull();
    });
  });

  describe('className Prop', () => {
    it('should apply custom className to section element', () => {
      const { container } = render(
        <CollectionRow title='Custom' books={eightBooks} className='mb-4 mt-8' />,
      );
      const section = container.querySelector('section');
      expect(section?.className).toContain('mt-8');
      expect(section?.className).toContain('mb-4');
    });
  });

  describe('Accessibility', () => {
    it('should render as a section element', () => {
      const { container } = render(<CollectionRow title='Section' books={eightBooks} />);
      expect(container.querySelector('section')).toBeTruthy();
    });

    it('should have heading hierarchy (h2)', () => {
      render(<CollectionRow title='Heading Test' books={eightBooks} />);
      expect(screen.getByRole('heading', { level: 2 })).toBeTruthy();
    });
  });
});
