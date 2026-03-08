import clsx from 'clsx';
import Image from 'next/image';
import { memo, useRef, useState } from 'react';
import { Book } from '@/types/book';
import { LibraryCoverFitType, LibraryViewModeType } from '@/types/settings';
import { formatAuthors, formatTitle } from '@/utils/book';

interface BookCoverProps {
  book: Book;
  mode?: LibraryViewModeType;
  coverFit?: LibraryCoverFitType;
  className?: string;
  imageClassName?: string;
  showSpine?: boolean;
  isPreview?: boolean;
  onImageError?: () => void;
}

const BookCover: React.FC<BookCoverProps> = memo<BookCoverProps>(
  ({
    book,
    mode = 'grid',
    coverFit = 'crop',
    showSpine = false,
    className,
    imageClassName,
    isPreview,
    onImageError,
  }) => {
    const coverRef = useRef<HTMLDivElement>(null);
    const [imageLoaded, setImageLoaded] = useState(false);
    // Track which coverSrc failed so error resets when source changes
    const [failedSrc, setFailedSrc] = useState<string | null>(null);

    const coverSrc = book.coverImageUrl || book.metadata?.coverImageUrl || null;
    const imageError = coverSrc !== null && failedSrc === coverSrc;
    const shouldShowSpine = showSpine && imageLoaded && !imageError;

    // Determine fallback state:
    // - Has cover source → show image (hide fallback)
    // - No cover, no error → show skeleton (cover may be loading)
    // - No cover, error → show title/author text
    const showImage = !!coverSrc && !imageError;
    const showSkeleton = !coverSrc && !imageError;
    const showTextFallback = !coverSrc && imageError;

    return (
      <div
        ref={coverRef}
        className={clsx('book-cover-container relative flex h-full w-full', className)}
      >
        {/* Cover image */}
        {coverSrc &&
          (coverFit === 'crop' ? (
            <Image
              src={coverSrc}
              alt={book.title}
              fill={true}
              className={clsx(
                'cover-image crop-cover-img object-cover',
                !showImage && 'invisible',
                imageClassName,
              )}
              onLoad={() => {
                setImageLoaded(true);
              }}
              onError={() => {
                setImageLoaded(false);
                setFailedSrc(coverSrc);
                onImageError?.();
              }}
            />
          ) : (
            <div className={clsx('flex h-full w-full justify-start')}>
              <div
                className={clsx(
                  'flex h-full max-h-full items-end',
                  mode === 'grid' ? 'items-end' : 'items-center',
                )}
              >
                <Image
                  src={coverSrc}
                  alt={book.title}
                  width={0}
                  height={0}
                  sizes='100vw'
                  className={clsx(
                    'cover-image fit-cover-img h-auto max-h-full w-auto max-w-full shadow-md',
                    !showImage && 'invisible',
                    imageClassName,
                  )}
                  onLoad={() => {
                    setImageLoaded(true);
                  }}
                  onError={() => {
                    setImageLoaded(false);
                    setFailedSrc(coverSrc);
                    onImageError?.();
                  }}
                />
                <div
                  className={`book-spine absolute inset-0 ${shouldShowSpine ? 'visible' : 'invisible'}`}
                />
              </div>
            </div>
          ))}

        {/* Spine overlay for crop mode */}
        {coverFit === 'crop' && (
          <div
            className={`book-spine absolute inset-0 ${shouldShowSpine ? 'visible' : 'invisible'}`}
          />
        )}

        {/* Skeleton: shown while cover is loading/downloading */}
        {showSkeleton && (
          <div
            className={clsx(
              'absolute inset-0',
              isPreview ? 'bg-base-200/50' : 'bg-base-100',
              imageClassName,
            )}
          >
            <div className='bg-base-300 h-full w-full animate-pulse rounded' />
          </div>
        )}

        {/* Text fallback: shown only when image fails to load */}
        {showTextFallback && (
          <div
            className={clsx(
              'absolute inset-0 p-2',
              'text-neutral-content text-center font-serif font-medium',
              isPreview ? 'bg-base-200/50' : 'bg-base-100',
              imageClassName,
            )}
          >
            <div className='flex h-1/2 items-center justify-center'>
              <span
                className={clsx(
                  isPreview ? 'line-clamp-2' : mode === 'grid' ? 'line-clamp-3' : 'line-clamp-2',
                  isPreview ? 'text-[0.5em]' : mode === 'grid' ? 'text-lg' : 'text-sm',
                )}
              >
                {formatTitle(book.title)}
              </span>
            </div>
            <div className='h-1/6'></div>
            <div className='flex h-1/3 items-center justify-center'>
              <span
                className={clsx(
                  'text-neutral-content/50 line-clamp-1',
                  isPreview ? 'text-[0.4em]' : mode === 'grid' ? 'text-base' : 'text-xs',
                )}
              >
                {formatAuthors(book.author)}
              </span>
            </div>
          </div>
        )}
      </div>
    );
  },
  (prevProps, nextProps) => {
    return (
      prevProps.book.coverImageUrl === nextProps.book.coverImageUrl &&
      prevProps.book.metadata?.coverImageUrl === nextProps.book.metadata?.coverImageUrl &&
      prevProps.book.updatedAt === nextProps.book.updatedAt &&
      prevProps.mode === nextProps.mode &&
      prevProps.coverFit === nextProps.coverFit &&
      prevProps.isPreview === nextProps.isPreview &&
      prevProps.showSpine === nextProps.showSpine &&
      prevProps.className === nextProps.className &&
      prevProps.imageClassName === nextProps.imageClassName
    );
  },
);

BookCover.displayName = 'BookCover';

export default BookCover;
