'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { cn } from '@/utils/tailwind';

// ── Types ───────────────────────────────────────────────

export interface CategoryNode {
  label: string;
  subjects: string[];
  children: { label: string; subject: string }[];
}

export interface CategoryPillsProps {
  /** Fires when category/subcategory selection changes */
  onCategoryChange?: (subjects: string[] | undefined) => void;
  /** Fires with raw category/subcategory values for breadcrumb rendering */
  onSelectionChange?: (category: CategoryNode | null, subcategory: string | null) => void;
  /** Enable sticky positioning */
  sticky?: boolean;
  /** Additional class name */
  className?: string;
}

// ── Category tree data ──────────────────────────────────

export const CATEGORY_TREE: CategoryNode[] = [
  {
    label: 'Engineering',
    subjects: ['Engineering', 'Architecture', 'Technology'],
    children: [
      { label: 'Architecture', subject: 'Architecture' },
      { label: 'Technology', subject: 'Technology' },
    ],
  },
  {
    label: 'Science',
    subjects: ['Science', 'Physics', 'Chemistry', 'Biology', 'Astronomy', 'Geology', 'Botany'],
    children: [
      { label: 'Physics', subject: 'Physics' },
      { label: 'Chemistry', subject: 'Chemistry' },
      { label: 'Biology', subject: 'Biology' },
      { label: 'Astronomy', subject: 'Astronomy' },
      { label: 'Geology', subject: 'Geology' },
      { label: 'Botany', subject: 'Botany' },
    ],
  },
  {
    label: 'Computer Science',
    subjects: [
      'Computer Science',
      'Programming',
      'Web Development',
      'Python',
      'JavaScript',
      'Databases',
      'Data Science',
      'Systems Programming',
      'Java',
      'SQL',
      'C',
      'C++',
      'C#',
      '.NET',
      'Ruby',
      'PHP',
      'Perl',
      'Kotlin',
      'Swift',
      'Haskell',
      'R',
      'Bash',
      'Go',
      'React',
      'Angular',
      'Node.js',
      'Git',
      'Linux',
      'iOS',
      'Android',
      'Mobile Development',
    ],
    children: [
      { label: 'Programming', subject: 'Programming' },
      { label: 'Web Development', subject: 'Web Development' },
      { label: 'Python', subject: 'Python' },
      { label: 'JavaScript', subject: 'JavaScript' },
      { label: 'Databases', subject: 'Databases' },
      { label: 'Data Science', subject: 'Data Science' },
      { label: 'Systems Programming', subject: 'Systems Programming' },
      { label: 'Java', subject: 'Java' },
      { label: 'Mobile Development', subject: 'Mobile Development' },
      { label: 'Linux', subject: 'Linux' },
      { label: 'SQL', subject: 'SQL' },
      { label: 'C / C++', subject: 'C' },
      { label: '.NET', subject: '.NET' },
    ],
  },
  {
    label: 'History',
    subjects: ['History', 'Biography', 'Nonfiction'],
    children: [
      { label: 'Biography', subject: 'Biography' },
      { label: 'Nonfiction', subject: 'Nonfiction' },
    ],
  },
  {
    label: 'Medicine',
    subjects: ['Medicine', 'Nursing'],
    children: [{ label: 'Nursing', subject: 'Nursing' }],
  },
  {
    label: 'Social Sciences',
    subjects: ['Social Sciences', 'Psychology', 'Education'],
    children: [
      { label: 'Psychology', subject: 'Psychology' },
      { label: 'Education', subject: 'Education' },
    ],
  },
  {
    label: 'Business & Economics',
    subjects: ['Business & Economics', 'Business', 'Economics'],
    children: [
      { label: 'Business', subject: 'Business' },
      { label: 'Economics', subject: 'Economics' },
    ],
  },
  {
    label: 'Mathematics',
    subjects: ['Mathematics', 'Math', 'Statistics'],
    children: [{ label: 'Statistics', subject: 'Statistics' }],
  },
  {
    label: 'Philosophy',
    subjects: ['Philosophy'],
    children: [],
  },
  {
    label: 'Religion',
    subjects: ['Religion'],
    children: [],
  },
  {
    label: 'Literature',
    subjects: ['Literature', 'Fiction', 'Poetry', 'Drama', 'Criticism'],
    children: [
      { label: 'Fiction', subject: 'Fiction' },
      { label: 'Poetry', subject: 'Poetry' },
      { label: 'Drama', subject: 'Drama' },
      { label: 'Criticism', subject: 'Criticism' },
    ],
  },
  {
    label: 'Arts',
    subjects: ['Arts', 'Music', 'Visual Arts'],
    children: [
      { label: 'Music', subject: 'Music' },
      { label: 'Visual Arts', subject: 'Visual Arts' },
    ],
  },
  {
    label: 'Education',
    subjects: ['Education', 'Pedagogy', 'Curriculum', 'Assessment'],
    children: [
      { label: 'Pedagogy', subject: 'Pedagogy' },
      { label: 'Curriculum', subject: 'Curriculum' },
      { label: 'Assessment', subject: 'Assessment' },
    ],
  },
];

const MAX_VISIBLE_PILLS = 10;

// ── Pill style constants ────────────────────────────────

const PILL_ACTIVE = 'bg-base-content text-base-100';
const PILL_INACTIVE = 'bg-base-100 border border-base-300 text-base-content/60 hover:bg-base-200';
const PILL_MORE =
  'bg-base-100 border border-dashed border-base-300 text-base-content/60 hover:bg-base-200';

const PILL_BASE =
  'h-8 flex-shrink-0 whitespace-nowrap rounded-full px-3.5 text-[13px] font-medium transition-colors font-[Inter,system-ui,sans-serif] cursor-pointer select-none';

const SUB_PILL_BASE =
  'h-7 flex-shrink-0 whitespace-nowrap rounded-full px-3 text-xs font-medium transition-colors font-[Inter,system-ui,sans-serif] cursor-pointer select-none';

// ── Component ───────────────────────────────────────────

export function CategoryPills({
  onCategoryChange,
  onSelectionChange,
  sticky = false,
  className,
}: CategoryPillsProps) {
  const [activeCategory, setActiveCategory] = useState<CategoryNode | null>(null);
  const [activeSubcategory, setActiveSubcategory] = useState<string | null>(null);
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [showAllSubcategories, setShowAllSubcategories] = useState(false);

  // Ref for keyboard navigation
  const pillContainerRef = useRef<HTMLDivElement>(null);
  const subPillContainerRef = useRef<HTMLDivElement>(null);

  const handleCategoryClick = useCallback(
    (cat: CategoryNode | null) => {
      setActiveCategory(cat);
      setActiveSubcategory(null);
      setShowAllSubcategories(false);

      const subjects = cat ? cat.subjects : undefined;
      onCategoryChange?.(subjects);
      onSelectionChange?.(cat, null);
    },
    [onCategoryChange, onSelectionChange],
  );

  const handleSubcategoryClick = useCallback(
    (sub: string | null) => {
      setActiveSubcategory(sub);

      const subjects = sub ? [sub] : activeCategory?.subjects;
      onCategoryChange?.(subjects);
      onSelectionChange?.(activeCategory ?? null, sub);
    },
    [activeCategory, onCategoryChange, onSelectionChange],
  );

  // Keyboard navigation within tablist
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, containerRef: React.RefObject<HTMLDivElement | null>) => {
      const container = containerRef.current;
      if (!container) return;

      const tabs = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
      const currentIndex = tabs.findIndex((tab) => tab === document.activeElement);
      if (currentIndex === -1) return;

      let nextIndex = currentIndex;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        nextIndex = (currentIndex + 1) % tabs.length;
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
      } else if (e.key === 'Home') {
        e.preventDefault();
        nextIndex = 0;
      } else if (e.key === 'End') {
        e.preventDefault();
        nextIndex = tabs.length - 1;
      }

      tabs[nextIndex]?.focus();
    },
    [],
  );

  // Determine which top-level pills to show
  const visibleCategories = showAllCategories
    ? CATEGORY_TREE
    : CATEGORY_TREE.slice(0, MAX_VISIBLE_PILLS);
  const hiddenCount = CATEGORY_TREE.length - MAX_VISIBLE_PILLS;

  // Subcategories for the active parent
  const subcategories = activeCategory?.children ?? [];
  const visibleSubcategories = showAllSubcategories
    ? subcategories
    : subcategories.slice(0, MAX_VISIBLE_PILLS);
  const hiddenSubCount = subcategories.length - MAX_VISIBLE_PILLS;

  // Focus first subcategory pill when subcategory row appears
  useEffect(() => {
    if (activeCategory && subcategories.length > 0 && subPillContainerRef.current) {
      const firstTab = subPillContainerRef.current.querySelector<HTMLButtonElement>('[role="tab"]');
      // Don't auto-focus to avoid jarring UX; just ensure it's navigable
      firstTab?.setAttribute('tabindex', '0');
    }
  }, [activeCategory, subcategories.length]);

  return (
    <div
      className={cn('flex flex-col gap-2', sticky && 'sticky top-0 z-10', className)}
      data-testid='category-pills'
    >
      {/* Top-level category pills */}
      {/* eslint-disable-next-line jsx-a11y/interactive-supports-focus -- tablist delegates focus to child tabs via roving tabindex */}
      <div
        ref={pillContainerRef}
        role='tablist'
        aria-label='Book categories'
        className='scrollbar-none flex flex-wrap gap-2'
        onKeyDown={(e) => handleKeyDown(e, pillContainerRef)}
      >
        {/* "All" pill */}
        <button
          type='button'
          role='tab'
          aria-selected={!activeCategory}
          tabIndex={!activeCategory ? 0 : -1}
          onClick={() => handleCategoryClick(null)}
          className={cn(PILL_BASE, !activeCategory ? PILL_ACTIVE : PILL_INACTIVE)}
        >
          All
        </button>

        {visibleCategories.map((cat) => {
          const isActive = activeCategory?.label === cat.label;
          return (
            <button
              key={cat.label}
              type='button'
              role='tab'
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              onClick={() => handleCategoryClick(isActive ? null : cat)}
              className={cn(PILL_BASE, isActive ? PILL_ACTIVE : PILL_INACTIVE)}
            >
              {cat.label}
            </button>
          );
        })}

        {!showAllCategories && hiddenCount > 0 && (
          <button
            type='button'
            onClick={() => setShowAllCategories(true)}
            className={cn(PILL_BASE, PILL_MORE)}
            data-testid='more-categories-button'
          >
            +{hiddenCount} more
          </button>
        )}
      </div>

      {/* Subcategory pills */}
      {activeCategory && subcategories.length > 0 && (
        // eslint-disable-next-line jsx-a11y/interactive-supports-focus -- tablist delegates focus to child tabs via roving tabindex
        <div
          ref={subPillContainerRef}
          role='tablist'
          aria-label={`${activeCategory.label} subcategories`}
          className='scrollbar-none flex flex-wrap gap-2 pb-1'
          onKeyDown={(e) => handleKeyDown(e, subPillContainerRef)}
          data-testid='subcategory-pills'
        >
          {/* "All {Category}" pill */}
          <button
            type='button'
            role='tab'
            aria-selected={!activeSubcategory}
            tabIndex={!activeSubcategory ? 0 : -1}
            onClick={() => handleSubcategoryClick(null)}
            className={cn(SUB_PILL_BASE, !activeSubcategory ? PILL_ACTIVE : PILL_INACTIVE)}
          >
            All {activeCategory.label}
          </button>

          {visibleSubcategories.map((sub) => {
            const isActive = activeSubcategory === sub.subject;
            return (
              <button
                key={sub.subject}
                type='button'
                role='tab'
                aria-selected={isActive}
                tabIndex={isActive ? 0 : -1}
                onClick={() => handleSubcategoryClick(isActive ? null : sub.subject)}
                className={cn(SUB_PILL_BASE, isActive ? PILL_ACTIVE : PILL_INACTIVE)}
              >
                {sub.label}
              </button>
            );
          })}

          {!showAllSubcategories && hiddenSubCount > 0 && (
            <button
              type='button'
              onClick={() => setShowAllSubcategories(true)}
              className={cn(SUB_PILL_BASE, PILL_MORE)}
              data-testid='more-subcategories-button'
            >
              +{hiddenSubCount} more
            </button>
          )}
        </div>
      )}
    </div>
  );
}
