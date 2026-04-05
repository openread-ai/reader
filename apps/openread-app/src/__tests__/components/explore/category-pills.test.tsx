import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';
import { CategoryPills, CATEGORY_TREE } from '@/components/explore/CategoryPills';

afterEach(() => {
  cleanup();
});

describe('CategoryPills', () => {
  describe('Rendering', () => {
    it('should render All pill as active by default', () => {
      render(<CategoryPills />);
      const allPill = screen.getByRole('tab', { name: 'All' });
      expect(allPill).toBeTruthy();
      expect(allPill.getAttribute('aria-selected')).toBe('true');
    });

    it('should render top-level categories', () => {
      render(<CategoryPills />);
      expect(screen.getByRole('tab', { name: 'Science' })).toBeTruthy();
      expect(screen.getByRole('tab', { name: 'Computer Science' })).toBeTruthy();
      expect(screen.getByRole('tab', { name: 'History' })).toBeTruthy();
      expect(screen.getByRole('tab', { name: 'Engineering' })).toBeTruthy();
      expect(screen.getByRole('tab', { name: 'Medicine' })).toBeTruthy();
    });

    it('should have tablist role on container', () => {
      render(<CategoryPills />);
      const tablists = screen.getAllByRole('tablist');
      expect(tablists.length).toBeGreaterThanOrEqual(1);
    });

    it('should have aria-label on tablist', () => {
      render(<CategoryPills />);
      const tablist = screen.getByRole('tablist', { name: 'Book categories' });
      expect(tablist).toBeTruthy();
    });
  });

  describe('+N more button', () => {
    it('should show +N more button when categories exceed limit', () => {
      render(<CategoryPills />);
      // CATEGORY_TREE has 13 items, limit is 10, so 3 are hidden
      const moreBtn = screen.getByTestId('more-categories-button');
      expect(moreBtn).toBeTruthy();
      expect(moreBtn.textContent).toContain('more');
    });

    it('should expand all categories when +N more is clicked', () => {
      render(<CategoryPills />);
      // Literature, Arts, Education are hidden (indices 10, 11, 12)
      expect(screen.queryByRole('tab', { name: 'Literature' })).toBeNull();

      fireEvent.click(screen.getByTestId('more-categories-button'));

      expect(screen.getByRole('tab', { name: 'Literature' })).toBeTruthy();
      expect(screen.getByRole('tab', { name: 'Arts' })).toBeTruthy();
      expect(screen.getByRole('tab', { name: 'Education' })).toBeTruthy();
    });

    it('should hide the +N more button after expansion', () => {
      render(<CategoryPills />);
      fireEvent.click(screen.getByTestId('more-categories-button'));
      expect(screen.queryByTestId('more-categories-button')).toBeNull();
    });
  });

  describe('Category selection', () => {
    it('should select category and show subcategories', () => {
      const onChange = vi.fn();
      render(<CategoryPills onCategoryChange={onChange} />);

      fireEvent.click(screen.getByRole('tab', { name: 'Science' }));

      // Science pill should now be active
      expect(screen.getByRole('tab', { name: 'Science' }).getAttribute('aria-selected')).toBe(
        'true',
      );

      // "All" pill should be inactive
      expect(screen.getByRole('tab', { name: 'All' }).getAttribute('aria-selected')).toBe('false');

      // Subcategories should appear
      expect(screen.getByRole('tab', { name: 'Physics' })).toBeTruthy();
      expect(screen.getByRole('tab', { name: 'Chemistry' })).toBeTruthy();
      expect(screen.getByRole('tab', { name: 'Biology' })).toBeTruthy();

      // Callback should fire with Science subjects
      expect(onChange).toHaveBeenCalledWith(
        expect.arrayContaining(['Science', 'Physics', 'Chemistry', 'Biology']),
      );
    });

    it('should deselect category when clicked again (toggle back to All)', () => {
      const onChange = vi.fn();
      render(<CategoryPills onCategoryChange={onChange} />);

      const sciencePill = screen.getByRole('tab', { name: 'Science' });
      fireEvent.click(sciencePill); // Select
      fireEvent.click(sciencePill); // Deselect

      // "All" should be active again
      expect(screen.getByRole('tab', { name: 'All' }).getAttribute('aria-selected')).toBe('true');

      // Callback fires with undefined
      expect(onChange).toHaveBeenLastCalledWith(undefined);
    });

    it('should switch between categories', () => {
      const onChange = vi.fn();
      render(<CategoryPills onCategoryChange={onChange} />);

      fireEvent.click(screen.getByRole('tab', { name: 'Science' }));
      fireEvent.click(screen.getByRole('tab', { name: 'History' }));

      // History should be active, Science should not
      expect(screen.getByRole('tab', { name: 'History' }).getAttribute('aria-selected')).toBe(
        'true',
      );
      expect(screen.getByRole('tab', { name: 'Science' }).getAttribute('aria-selected')).toBe(
        'false',
      );

      // Subcategories should be History's children
      expect(screen.getByRole('tab', { name: 'Biography' })).toBeTruthy();
    });

    it('should call onSelectionChange with category node', () => {
      const onSelect = vi.fn();
      render(<CategoryPills onSelectionChange={onSelect} />);

      fireEvent.click(screen.getByRole('tab', { name: 'Science' }));

      expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ label: 'Science' }), null);
    });
  });

  describe('Subcategory selection', () => {
    it('should select subcategory and narrow subjects', () => {
      const onChange = vi.fn();
      render(<CategoryPills onCategoryChange={onChange} />);

      // Select parent first
      fireEvent.click(screen.getByRole('tab', { name: 'Science' }));

      // Then select subcategory
      fireEvent.click(screen.getByRole('tab', { name: 'Physics' }));

      expect(onChange).toHaveBeenLastCalledWith(['Physics']);
    });

    it('should show "All {Category}" pill as active by default', () => {
      render(<CategoryPills />);
      fireEvent.click(screen.getByRole('tab', { name: 'Science' }));

      const allSciencePill = screen.getByRole('tab', { name: 'All Science' });
      expect(allSciencePill.getAttribute('aria-selected')).toBe('true');
    });

    it('should deselect subcategory when "All {Category}" is clicked', () => {
      const onChange = vi.fn();
      render(<CategoryPills onCategoryChange={onChange} />);

      fireEvent.click(screen.getByRole('tab', { name: 'Science' }));
      fireEvent.click(screen.getByRole('tab', { name: 'Physics' }));
      fireEvent.click(screen.getByRole('tab', { name: 'All Science' }));

      // Should go back to all Science subjects
      expect(onChange).toHaveBeenLastCalledWith(
        expect.arrayContaining(['Science', 'Physics', 'Chemistry']),
      );
    });

    it('should toggle subcategory off when clicked again', () => {
      const onChange = vi.fn();
      render(<CategoryPills onCategoryChange={onChange} />);

      fireEvent.click(screen.getByRole('tab', { name: 'Science' }));
      fireEvent.click(screen.getByRole('tab', { name: 'Physics' }));
      fireEvent.click(screen.getByRole('tab', { name: 'Physics' }));

      // Toggling off the active subcategory should return to "All {Category}"
      const scienceNode = CATEGORY_TREE.find((c) => c.label === 'Science');
      expect(onChange).toHaveBeenLastCalledWith(scienceNode?.subjects);
    });

    it('should show +N more button for subcategories when they exceed limit', () => {
      render(<CategoryPills />);
      // Computer Science has 13 children, so +3 more should show
      fireEvent.click(screen.getByRole('tab', { name: 'Computer Science' }));

      expect(screen.getByTestId('more-subcategories-button')).toBeTruthy();
    });

    it('should expand all subcategories when +N more is clicked', () => {
      render(<CategoryPills />);
      fireEvent.click(screen.getByRole('tab', { name: 'Computer Science' }));

      // .NET is the 13th child, should be hidden initially
      expect(screen.queryByRole('tab', { name: '.NET' })).toBeNull();

      fireEvent.click(screen.getByTestId('more-subcategories-button'));

      expect(screen.getByRole('tab', { name: '.NET' })).toBeTruthy();
      expect(screen.queryByTestId('more-subcategories-button')).toBeNull();
    });

    it('should hide subcategories when selecting "All"', () => {
      render(<CategoryPills />);
      fireEvent.click(screen.getByRole('tab', { name: 'Science' }));
      expect(screen.getByTestId('subcategory-pills')).toBeTruthy();

      fireEvent.click(screen.getByRole('tab', { name: 'All' }));
      expect(screen.queryByTestId('subcategory-pills')).toBeNull();
    });

    it('should call onSelectionChange with subcategory', () => {
      const onSelect = vi.fn();
      render(<CategoryPills onSelectionChange={onSelect} />);

      fireEvent.click(screen.getByRole('tab', { name: 'Science' }));
      fireEvent.click(screen.getByRole('tab', { name: 'Physics' }));

      expect(onSelect).toHaveBeenLastCalledWith(
        expect.objectContaining({ label: 'Science' }),
        'Physics',
      );
    });
  });

  describe('Sticky positioning', () => {
    it('should render with sticky class when sticky prop is true', () => {
      render(<CategoryPills sticky />);
      const container = screen.getByTestId('category-pills');
      expect(container.className).toContain('sticky');
    });

    it('should not render sticky class by default', () => {
      render(<CategoryPills />);
      const container = screen.getByTestId('category-pills');
      expect(container.className).not.toContain('sticky');
    });
  });

  describe('Custom className', () => {
    it('should apply custom className', () => {
      render(<CategoryPills className='px-6' />);
      const container = screen.getByTestId('category-pills');
      expect(container.className).toContain('px-6');
    });
  });

  describe('Categories without subcategories', () => {
    it('should not show subcategory row for categories with no children', () => {
      render(<CategoryPills />);
      fireEvent.click(screen.getByRole('tab', { name: 'Philosophy' }));

      // Philosophy has no children, so subcategory row should not appear
      expect(screen.queryByTestId('subcategory-pills')).toBeNull();
    });
  });

  describe('CATEGORY_TREE data export', () => {
    it('should export CATEGORY_TREE with correct structure', () => {
      expect(Array.isArray(CATEGORY_TREE)).toBe(true);
      expect(CATEGORY_TREE.length).toBeGreaterThan(10);

      // Check structure of first node
      const first = CATEGORY_TREE[0];
      expect(first).toHaveProperty('label');
      expect(first).toHaveProperty('subjects');
      expect(first).toHaveProperty('children');
      expect(Array.isArray(first.subjects)).toBe(true);
      expect(Array.isArray(first.children)).toBe(true);
    });
  });

  describe('Accessibility', () => {
    it('should set aria-selected=false on inactive pills', () => {
      render(<CategoryPills />);
      const sciencePill = screen.getByRole('tab', { name: 'Science' });
      expect(sciencePill.getAttribute('aria-selected')).toBe('false');
    });

    it('should update aria-selected when category changes', () => {
      render(<CategoryPills />);
      const sciencePill = screen.getByRole('tab', { name: 'Science' });

      fireEvent.click(sciencePill);
      expect(sciencePill.getAttribute('aria-selected')).toBe('true');

      fireEvent.click(sciencePill);
      expect(sciencePill.getAttribute('aria-selected')).toBe('false');
    });

    it('should have tabindex management for roving tabindex', () => {
      render(<CategoryPills />);
      // Active pill should have tabindex 0
      const allPill = screen.getByRole('tab', { name: 'All' });
      expect(allPill.getAttribute('tabindex')).toBe('0');

      // Inactive pills should have tabindex -1
      const sciencePill = screen.getByRole('tab', { name: 'Science' });
      expect(sciencePill.getAttribute('tabindex')).toBe('-1');
    });

    it('should have subcategory tablist with aria-label', () => {
      render(<CategoryPills />);
      fireEvent.click(screen.getByRole('tab', { name: 'Science' }));

      const subTablist = screen.getByRole('tablist', { name: 'Science subcategories' });
      expect(subTablist).toBeTruthy();
    });
  });
});
