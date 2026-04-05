'use client';

import { useCallback, useRef, useState, useEffect } from 'react';
import Link from 'next/link';
import { ChevronRight, ChevronLeft } from 'lucide-react';
import { cn } from '@/utils/tailwind';
import { ExploreBookCard } from '@/components/explore/ExploreBookCard';
import type { ExploreBookCardProps } from '@/components/explore/ExploreBookCard';

// ── Types ───────────────────────────────────────────────

export interface CollectionRowProps {
  title: string;
  icon?: React.ReactNode;
  seeAllHref?: string;
  books: ExploreBookCardProps['book'][];
  isLoading?: boolean;
  wishlistedIds?: Set<string>;
  onWishlistToggle?: (bookId: string) => void;
  onImport?: (bookId: string) => void;
  onRead?: (bookId: string) => void;
  onCardTap?: (bookId: string) => void;
  className?: string;
}

// ── Skeleton Card ───────────────────────────────────────

function SkeletonCard() {
  return (
    <div className='w-[130px] flex-shrink-0 animate-pulse snap-start'>
      <div className='bg-base-200 aspect-[2/3] rounded-sm' />
      <div className='space-y-1.5 px-1 pt-2'>
        <div className='bg-base-200 h-[14px] w-4/5 rounded' />
        <div className='bg-base-200 h-[12px] w-3/5 rounded' />
        <div className='bg-base-200 h-[10px] w-2/5 rounded' />
      </div>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────

export function CollectionRow({
  title,
  icon,
  seeAllHref,
  books,
  isLoading = false,
  wishlistedIds,
  onWishlistToggle,
  onImport,
  onRead,
  onCardTap,
  className,
}: CollectionRowProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  // ── Scroll state detection ──────────────────────────

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    // Initial check
    updateScrollState();

    el.addEventListener('scroll', updateScrollState, { passive: true });
    const resizeObserver = new ResizeObserver(updateScrollState);
    resizeObserver.observe(el);

    return () => {
      el.removeEventListener('scroll', updateScrollState);
      resizeObserver.disconnect();
    };
  }, [updateScrollState, books]);

  // ── Scroll handlers ─────────────────────────────────

  const scrollBy = useCallback((direction: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    const scrollAmount = el.clientWidth * 0.75;
    el.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth',
    });
  }, []);

  // ── Loading state ───────────────────────────────────

  if (isLoading) {
    return (
      <section className={cn('', className)} aria-busy='true'>
        {/* Header */}
        <div className='mb-3 flex items-center justify-between px-4'>
          <div className='flex items-center gap-2'>
            {icon && (
              <span className='flex h-[18px] w-[18px] items-center justify-center'>{icon}</span>
            )}
            <h2 className='text-base-content text-[17px] font-bold'>{title}</h2>
          </div>
        </div>

        {/* Skeleton cards */}
        <div className='flex gap-2.5 overflow-hidden px-4'>
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      </section>
    );
  }

  // ── Empty state ─────────────────────────────────────

  if (books.length === 0) {
    return (
      <section className={cn('', className)}>
        {/* Header */}
        <div className='mb-3 flex items-center justify-between px-4'>
          <div className='flex items-center gap-2'>
            {icon && (
              <span className='flex h-[18px] w-[18px] items-center justify-center'>{icon}</span>
            )}
            <h2 className='text-base-content text-[17px] font-bold'>{title}</h2>
          </div>
        </div>

        <div className='px-4'>
          <div className='border-base-content/10 rounded-lg border border-dashed py-8 text-center'>
            <p className='text-base-content/50 text-sm'>No books in this collection</p>
          </div>
        </div>
      </section>
    );
  }

  // ── Default state ───────────────────────────────────

  return (
    <section className={cn('group/row', className)}>
      {/* Section header */}
      <div className='mb-3 flex items-center justify-between px-4'>
        <div className='flex items-center gap-2'>
          {icon && (
            <span className='flex h-[18px] w-[18px] items-center justify-center'>{icon}</span>
          )}
          <h2 className='text-base-content text-[17px] font-bold'>{title}</h2>
        </div>

        {seeAllHref && (
          <Link
            href={seeAllHref}
            className='text-base-content flex items-center gap-0.5 text-[14px] font-medium transition-opacity hover:opacity-70'
          >
            See All
            <ChevronRight className='h-4 w-4' aria-hidden='true' />
          </Link>
        )}
      </div>

      {/* Scrollable row container */}
      <div className='relative'>
        {/* Left scroll arrow — desktop only */}
        {canScrollLeft && (
          <button
            type='button'
            onClick={() => scrollBy('left')}
            className='bg-base-100/90 absolute left-1 top-1/2 z-10 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full shadow-md backdrop-blur-sm transition-opacity md:flex'
            aria-label='Scroll left'
          >
            <ChevronLeft className='text-base-content h-5 w-5' />
          </button>
        )}

        {/* Edge fade gradients — mobile only */}
        {canScrollLeft && (
          <div
            className='pointer-events-none absolute inset-y-0 left-0 z-[5] w-8 md:hidden'
            style={{
              maskImage: 'linear-gradient(to right, black, transparent)',
              WebkitMaskImage: 'linear-gradient(to right, black, transparent)',
              background: 'var(--color-base-100, white)',
            }}
          />
        )}
        {canScrollRight && (
          <div
            className='pointer-events-none absolute inset-y-0 right-0 z-[5] w-8 md:hidden'
            style={{
              maskImage: 'linear-gradient(to left, black, transparent)',
              WebkitMaskImage: 'linear-gradient(to left, black, transparent)',
              background: 'var(--color-base-100, white)',
            }}
          />
        )}

        {/* Books scroll row */}
        <div
          ref={scrollRef}
          className='flex snap-x snap-mandatory gap-2.5 overflow-x-auto scroll-smooth px-4 [&::-webkit-scrollbar]:hidden'
          style={{ scrollbarWidth: 'none' }}
        >
          {books.map((book) => (
            <div key={book.id} className='w-[130px] flex-shrink-0 snap-start'>
              <ExploreBookCard
                book={book}
                isWishlisted={wishlistedIds?.has(book.id) ?? false}
                onWishlistToggle={onWishlistToggle}
                onAction={onImport}
                onOpen={onRead}
                onCardTap={onCardTap}
                className='w-[130px]'
              />
            </div>
          ))}
        </div>

        {/* Right scroll arrow — desktop only */}
        {canScrollRight && (
          <button
            type='button'
            onClick={() => scrollBy('right')}
            className='bg-base-100/90 absolute right-1 top-1/2 z-10 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full shadow-md backdrop-blur-sm transition-opacity md:flex'
            aria-label='Scroll right'
          >
            <ChevronRight className='text-base-content h-5 w-5' />
          </button>
        )}
      </div>
    </section>
  );
}
