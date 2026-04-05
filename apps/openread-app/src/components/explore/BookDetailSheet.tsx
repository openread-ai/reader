'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Heart, BookOpen, Globe, X, ChevronDown, Loader2 } from 'lucide-react';
import { cn } from '@/utils/tailwind';
import { Progress } from '@/components/primitives/progress';
import { getCoverPalette, getLanguageName } from './ExploreBookCard';
import type { CatalogBook } from '@/types/catalog';

// ── Extended type for detail view ──────────────────────────

/** CatalogBook with additional fields returned by the detail endpoint. */
export interface CatalogBookDetail extends CatalogBook {
  description?: string;
  license_type?: string;
  publication_year?: number | null;
  subjects?: string[];
}

// ── Props ──────────────────────────────────────────────────

export interface BookDetailSheetProps {
  book: CatalogBookDetail | null;
  isOpen: boolean;
  onClose: () => void;
  isWishlisted?: boolean;
  importState?: 'idle' | 'importing' | 'ready';
  importProgress?: number;
  onWishlistToggle?: () => void;
  onImport?: () => void;
  onRead?: () => void;
}

// ── Source display helpers ──────────────────────────────────

const SOURCE_LABELS: Record<string, string> = {
  'standard-ebooks': 'Standard Ebooks',
  openstax: 'OpenStax',
  goalkicker: 'GoalKicker',
  greenteapress: 'Green Tea Press',
  doab: 'DOAB',
  oapen: 'OAPEN',
  gutenberg: 'Project Gutenberg',
  'internet-archive': 'Internet Archive',
};

function getSourceLabel(source?: string): string {
  if (!source) return 'Unknown';
  return SOURCE_LABELS[source] || source;
}

function isIASource(source?: string): boolean {
  return source === 'internet-archive';
}

// ── License display ────────────────────────────────────────

function formatLicense(license?: string): string {
  if (!license) return 'Unknown';
  if (license === 'public_domain') return 'Public Domain';
  // Format cc-by-4.0 -> CC BY 4.0
  if (license.startsWith('cc-')) {
    return license.replace('cc-', 'CC ').replace(/-/g, ' ').toUpperCase();
  }
  return license;
}

// ── Cover sub-component ────────────────────────────────────

function DetailCover({ book }: { book: CatalogBookDetail }) {
  const [imgError, setImgError] = useState(false);
  const palette = getCoverPalette(book.id);
  const coverUrl = book.cover_image_key
    ? `/api/catalog-covers/${book.cover_image_key}thumb.jpg`
    : null;

  if (coverUrl && !imgError) {
    return (
      <div className='relative mx-auto h-[280px] w-[200px] overflow-hidden rounded-sm'>
        {/* Gradient behind while loading */}
        <div
          className='absolute inset-0'
          style={{
            background: `linear-gradient(135deg, ${palette.from} 0%, ${palette.to} 100%)`,
          }}
        />
        {/* eslint-disable-next-line @next/next/no-img-element -- Catalog cover proxied from R2 */}
        <img
          src={coverUrl}
          alt={book.title}
          className='relative h-full w-full object-cover'
          loading='eager'
          onError={() => setImgError(true)}
        />
        <div className='book-spine absolute inset-0 rounded-sm' />
      </div>
    );
  }

  return (
    <div className='relative mx-auto h-[280px] w-[200px] overflow-hidden rounded-sm'>
      <div
        className='flex h-full w-full items-center justify-center px-4'
        style={{
          background: `linear-gradient(135deg, ${palette.from} 0%, ${palette.to} 100%)`,
        }}
      >
        <p
          className='text-center text-sm font-semibold leading-tight'
          style={{ color: palette.text }}
        >
          {book.title.length > 60 ? `${book.title.slice(0, 60)}...` : book.title}
        </p>
      </div>
      <div className='book-spine absolute inset-0 rounded-sm' />
    </div>
  );
}

// ── Metadata row ───────────────────────────────────────────

function MetadataRow({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) {
  return (
    <div
      className='flex items-center justify-between py-1'
      data-testid={`metadata-${label.toLowerCase()}`}
    >
      <span className='text-base-content/60 text-[14px]'>{label}</span>
      <span className='text-base-content flex items-center gap-1.5 text-[14px]'>
        {icon}
        {value}
      </span>
    </div>
  );
}

// ── Description with Read more ─────────────────────────────

function ExpandableDescription({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);

  if (!text) return null;

  return (
    <div className='mt-3'>
      <p
        className={cn(
          'text-base-content/60 text-[13px] leading-relaxed',
          !expanded && 'line-clamp-3',
        )}
        data-testid='description-text'
      >
        {text}
      </p>
      {text.length > 150 && (
        <button
          type='button'
          className='text-base-content mt-1 flex items-center gap-0.5 text-[13px] font-medium hover:underline'
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          data-testid='read-more-btn'
        >
          {expanded ? 'Show less' : 'Read more'}
          <ChevronDown
            className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')}
          />
        </button>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────

export function BookDetailSheet({
  book,
  isOpen,
  onClose,
  isWishlisted = false,
  importState = 'idle',
  importProgress = 0,
  onWishlistToggle,
  onImport,
  onRead,
}: BookDetailSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // ── Focus trap & escape key ────────────────────────────

  useEffect(() => {
    if (!isOpen) return;

    // Store the element that had focus before opening
    previousFocusRef.current = document.activeElement as HTMLElement;

    // Focus the sheet container
    const timer = setTimeout(() => {
      sheetRef.current?.focus();
    }, 50);

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      // Focus trap
      if (e.key === 'Tab' && sheetRef.current) {
        const focusable = sheetRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;

        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', handleKeyDown);
      // Restore focus
      previousFocusRef.current?.focus();
    };
  }, [isOpen, onClose]);

  // ── Prevent body scroll when open ──────────────────────

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // ── Click overlay to close ─────────────────────────────

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose],
  );

  if (!book) return null;

  const isIA = isIASource(book.source);
  const formatLabel = (book.format_type || 'epub').toUpperCase();
  const langLabel = getLanguageName(book.language);
  const sourceLabel = getSourceLabel(book.source);
  const licenseLabel = formatLicense(book.license_type);

  return (
    <>
      {/* Overlay */}
      <div
        className={cn(
          'fixed inset-0 z-50 bg-black/40 transition-opacity duration-200',
          isOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={handleOverlayClick}
        data-testid='sheet-overlay'
        aria-hidden='true'
      />

      {/* Sheet / Dialog container */}
      <div
        ref={sheetRef}
        role='dialog'
        aria-modal='true'
        aria-label={`Book details: ${book.title}`}
        tabIndex={-1}
        data-testid='book-detail-sheet'
        className={cn(
          'fixed z-50 outline-none transition-all duration-300 ease-out',
          // Mobile: bottom sheet
          'bg-base-100 inset-x-0 bottom-0 max-h-[85vh] rounded-t-2xl shadow-xl',
          // Desktop: centered dialog
          'sm:inset-auto sm:left-1/2 sm:top-1/2 sm:max-h-[85vh] sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl',
          // Animation
          isOpen
            ? 'translate-y-0 opacity-100 sm:scale-100'
            : 'pointer-events-none translate-y-full opacity-0 sm:translate-y-0 sm:scale-95',
        )}
      >
        {/* Drag handle (mobile only) */}
        <div className='flex justify-center pt-3 sm:hidden'>
          <div className='bg-base-300 h-1 w-10 rounded-full' data-testid='drag-handle' />
        </div>

        {/* Close button */}
        <button
          type='button'
          className='text-base-content/60 hover:bg-base-200 hover:text-base-content absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full transition-colors'
          onClick={onClose}
          aria-label='Close'
          data-testid='sheet-close-btn'
        >
          <X className='h-4 w-4' />
        </button>

        {/* Scrollable content */}
        <div className='overflow-y-auto px-6 pb-6 pt-4'>
          {/* Cover */}
          <DetailCover book={book} />

          {/* Title & Author */}
          <h2
            className='text-base-content mt-4 text-center text-[20px] font-bold leading-tight'
            data-testid='sheet-title'
          >
            {book.title}
          </h2>
          <p
            className='text-base-content/60 mt-1 text-center text-[15px]'
            data-testid='sheet-author'
          >
            {book.author_name}
          </p>

          {/* Separator */}
          <div className='bg-base-300 my-4 h-px' role='separator' />

          {/* Metadata rows */}
          <div className='space-y-0.5' data-testid='sheet-metadata'>
            <MetadataRow label='Format' value={formatLabel} />
            <MetadataRow label='Language' value={langLabel} />
            <MetadataRow label='License' value={licenseLabel} />
            {book.page_count != null && book.page_count > 0 && (
              <MetadataRow label='Pages' value={String(book.page_count)} />
            )}
            <MetadataRow
              label='Source'
              value={sourceLabel}
              icon={isIA ? <Globe className='h-3.5 w-3.5 text-[#2563EB]' /> : undefined}
            />
          </div>

          {/* Description */}
          {book.description && <ExpandableDescription text={book.description} />}

          {/* Action buttons */}
          <div className='mt-6 space-y-3' data-testid='sheet-actions'>
            {/* Wishlist button */}
            <button
              type='button'
              className={cn(
                'flex h-11 w-full items-center justify-center gap-2 rounded-lg border text-[14px] font-medium transition-colors',
                isWishlisted
                  ? 'border-[#C45B4A] text-[#C45B4A]'
                  : 'border-base-300 text-base-content hover:bg-base-200',
              )}
              onClick={onWishlistToggle}
              aria-label={isWishlisted ? 'Remove from Wishlist' : 'Add to Wishlist'}
              data-testid='sheet-wishlist-btn'
            >
              <Heart className='h-[18px] w-[18px]' fill={isWishlisted ? 'currentColor' : 'none'} />
              {isWishlisted ? 'Remove from Wishlist' : 'Add to Wishlist'}
            </button>

            {/* Import button (idle state) */}
            {importState === 'idle' && (
              <button
                type='button'
                className={cn(
                  'flex h-11 w-full items-center justify-center gap-2 rounded-lg text-[14px] font-medium text-white transition-colors',
                  isIA ? 'bg-[#2563EB] hover:bg-[#1d4ed8]' : 'bg-[#1C1C1A] hover:bg-[#2a2a28]',
                )}
                onClick={onImport}
                aria-label={isIA ? 'Import from Internet Archive' : 'Add to Library'}
                data-testid='sheet-import-btn'
              >
                {isIA ? (
                  <>
                    <Globe className='h-4 w-4' />
                    Import from IA
                  </>
                ) : (
                  'Add to Library'
                )}
              </button>
            )}

            {/* Importing state with progress */}
            {importState === 'importing' && (
              <div className='space-y-2' data-testid='sheet-importing'>
                <button
                  type='button'
                  className='text-base-content bg-base-content/10 flex h-11 w-full items-center justify-center gap-2 rounded-lg text-[14px] font-medium'
                  disabled
                  aria-label='Importing'
                >
                  <Loader2 className='h-4 w-4 animate-spin' />
                  Importing... {importProgress}%
                </button>
                <Progress value={importProgress} className='bg-base-content/10 h-1.5' />
              </div>
            )}

            {/* Ready state — Start Reading */}
            {importState === 'ready' && (
              <button
                type='button'
                className='flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#1C1C1A] text-[14px] font-medium text-white transition-colors hover:bg-[#2a2a28]'
                onClick={onRead}
                aria-label='Start Reading'
                data-testid='sheet-read-btn'
              >
                <BookOpen className='h-4 w-4' />
                Start Reading
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
