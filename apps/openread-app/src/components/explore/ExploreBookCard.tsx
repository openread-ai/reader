'use client';

import { memo, useState } from 'react';
import { Heart, Globe, Check, Plus } from 'lucide-react';
import { cn } from '@/utils/tailwind';
import { Progress } from '@/components/primitives/progress';
import type { CatalogBook } from '@/types/catalog';

// ── Cover color palettes ────────────────────────────────
// Matches the Figma design's gradient cover system:
// each palette has a gradient pair (from/to) and a text color.

export const COVER_PALETTES = [
  { from: '#4a3f2e', to: '#3a3222', text: '#d4c4a8' }, // warm orange
  { from: '#2e3a44', to: '#223040', text: '#b8c9d4' }, // cool azure
  { from: '#2e3e2e', to: '#223422', text: '#a8c4a8' }, // green
  { from: '#362e44', to: '#2a2236', text: '#c4a8d4' }, // violet
  { from: '#443e2e', to: '#342e22', text: '#d4cca8' }, // gold
  { from: '#2e3844', to: '#222e40', text: '#a8bcd4' }, // steel blue
] as const;

export function getCoverPalette(id: string | null | undefined) {
  const key = id || 'default';
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
  }
  return COVER_PALETTES[Math.abs(hash) % COVER_PALETTES.length]!;
}

// ── Language display names (native script per design spec) ──

export const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  hi: '\u0939\u093F\u0928\u094D\u0926\u0940',
  ta: '\u0BA4\u0BAE\u0BBF\u0BB4\u0BCD',
  te: '\u0C24\u0C46\u0C32\u0C41\u0C17\u0C41',
  bn: '\u09AC\u09BE\u0982\u09B2\u09BE',
  mr: '\u092E\u0930\u09BE\u0920\u0940',
  gu: '\u0A97\u0AC1\u0A9C\u0AB0\u0ABE\u0AA4\u0AC0',
  kn: '\u0C95\u0CA8\u0CCD\u0CA8\u0CA1',
  ml: '\u0D2E\u0D32\u0D2F\u0D3E\u0D33\u0D02',
  pa: '\u0A2A\u0A70\u0A1C\u0A3E\u0A2C\u0A40',
  ur: '\u0627\u0631\u062F\u0648',
  sa: '\u0938\u0902\u0938\u094D\u0915\u0943\u0924',
  fr: 'French',
  de: 'German',
  es: 'Spanish',
  pt: 'Portuguese',
};

export function getLanguageName(code: string): string {
  return LANGUAGE_NAMES[code] || code.toUpperCase();
}

// ── Types ───────────────────────────────────────────────

type CardState = 'default' | 'importing' | 'in-library';

export interface ExploreBookCardProps {
  book: CatalogBook;
  isIA?: boolean;
  isWishlisted?: boolean;
  state?: CardState;
  importProgress?: number; // 0-100
  onWishlistToggle?: (bookId: string) => void;
  onAction?: (bookId: string) => void;
  onOpen?: (bookId: string) => void;
  onCardTap?: (bookId: string) => void;
  className?: string;
}

// ── Cover sub-component ─────────────────────────────────

const BOOK_COVER_CLASS =
  'relative aspect-[2/3] overflow-hidden rounded-sm transition-transform duration-200 lg:group-hover:scale-[1.02]';

function CoverImage({
  book,
  palette,
  isIA,
}: {
  book: CatalogBook;
  palette: (typeof COVER_PALETTES)[number];
  isIA: boolean;
}) {
  const [imgError, setImgError] = useState(false);
  const coverUrl = book.cover_image_key
    ? `/api/catalog-covers/${book.cover_image_key}thumb.jpg`
    : null;

  const gradientBg = (
    <div
      className='absolute inset-0 flex items-center justify-center px-4'
      style={{
        background: `linear-gradient(135deg, ${palette.from} 0%, ${palette.to} 100%)`,
      }}
    >
      <p
        className='text-center text-sm font-semibold leading-tight lg:text-base'
        style={{ color: palette.text }}
      >
        {book.title.length > 40 ? `${book.title.slice(0, 40)}...` : book.title}
      </p>
    </div>
  );

  const iaBadge = isIA ? (
    <div
      className='absolute left-1.5 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm'
      aria-label='Internet Archive book'
    >
      <Globe className='h-3.5 w-3.5 text-white' />
    </div>
  ) : null;

  const spineOverlay = <div className='book-spine absolute inset-0 rounded-sm' />;

  // Show real cover image if available and not errored
  if (coverUrl && !imgError) {
    return (
      <div className={BOOK_COVER_CLASS}>
        {/* Gradient background shown while image loads */}
        {gradientBg}
        {/* eslint-disable-next-line @next/next/no-img-element -- External catalog covers proxied from R2; next/image requires explicit domain allowlist */}
        <img
          src={coverUrl}
          alt={book.title}
          className='absolute inset-0 h-full w-full object-cover'
          loading='lazy'
          onError={() => setImgError(true)}
        />
        {spineOverlay}
        {iaBadge}
      </div>
    );
  }

  // Fallback: gradient with title text
  return (
    <div
      className={cn(BOOK_COVER_CLASS, 'flex items-center justify-center px-4')}
      style={{
        background: `linear-gradient(135deg, ${palette.from} 0%, ${palette.to} 100%)`,
      }}
    >
      <p
        className='text-center text-sm font-semibold leading-tight lg:text-base'
        style={{ color: palette.text }}
      >
        {book.title.length > 40 ? `${book.title.slice(0, 40)}...` : book.title}
      </p>
      {spineOverlay}
      {iaBadge}
    </div>
  );
}

// ── Main component ──────────────────────────────────────

export const ExploreBookCard = memo(function ExploreBookCard({
  book,
  isIA = false,
  isWishlisted = false,
  state = 'default',
  importProgress = 0,
  onWishlistToggle,
  onAction,
  onOpen,
  onCardTap,
  className,
}: ExploreBookCardProps) {
  const palette = getCoverPalette(book.id || book.ia_identifier || book.title);
  const formatLabel = (book.format_type || 'epub').toUpperCase();
  const langLabel = getLanguageName(book.language);

  const handleCardClick = () => {
    onCardTap?.(book.id);
  };

  return (
    <div className={cn('group flex h-full flex-col transition-shadow duration-200', className)}>
      {/* Tappable cover area — opens detail sheet */}
      <button
        type='button'
        className='cursor-pointer text-left'
        onClick={handleCardClick}
        aria-label={`View details for ${book.title}`}
        data-testid={`card-tap-${book.id}`}
      >
        <CoverImage book={book} palette={palette} isIA={isIA} />
      </button>

      {/* Metadata — also tappable for detail sheet */}
      <div className='flex flex-1 flex-col gap-0.5 px-2 pb-3 pt-2'>
        <button
          type='button'
          className='cursor-pointer text-left'
          onClick={handleCardClick}
          tabIndex={-1}
        >
          <h3 className='text-base-content line-clamp-2 text-[15px] font-semibold leading-tight'>
            {book.title}
          </h3>
          <p className='text-base-content/60 line-clamp-1 text-[13px]'>{book.author_name}</p>
          <p className='text-base-content/40 text-xs'>
            {langLabel} · {formatLabel}
          </p>
        </button>

        {/* Actions row — pinned to bottom */}
        <div className='mt-auto flex items-center justify-between pt-1.5'>
          {/* Wishlist heart — 44x44 tap target */}
          <button
            type='button'
            className={cn(
              'flex h-11 w-11 items-center justify-center transition-colors',
              isWishlisted ? 'text-[#C45B4A]' : 'text-base-content/30 hover:text-[#C45B4A]',
            )}
            aria-label={isWishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
            onClick={() => onWishlistToggle?.(book.id)}
          >
            <Heart className='h-[22px] w-[22px]' fill={isWishlisted ? 'currentColor' : 'none'} />
          </button>

          {/* Action button / progress / in-library */}
          {state === 'default' && (
            <button
              type='button'
              className='flex h-9 items-center gap-1 rounded-md bg-[#1C1C1A] px-3 text-[13px] font-medium text-white transition-colors hover:bg-[#2a2a28]'
              aria-label='Add to Library'
              onClick={() => onAction?.(book.id)}
            >
              <Plus className='h-4 w-4' />
              <span>Add</span>
            </button>
          )}

          {state === 'importing' && (
            <div className='flex flex-1 flex-col gap-1 pl-2'>
              <div className='flex items-center justify-between text-[12px]'>
                <span className='text-base-content/60'>Adding...</span>
                <span className='text-base-content/40'>{importProgress}%</span>
              </div>
              <Progress value={importProgress} className='bg-base-content/10 h-1.5' />
            </div>
          )}

          {state === 'in-library' && (
            <button
              type='button'
              className='text-base-content/60 hover:bg-base-200 flex h-9 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-colors'
              aria-label='Open book'
              onClick={() => onOpen?.(book.id)}
            >
              <Check className='h-4 w-4' />
              <span>Open</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
});
