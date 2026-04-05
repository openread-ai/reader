/**
 * @module @openread/types/book
 * Book entity and related types for the OpenRead platform.
 */

/**
 * Supported ebook file formats.
 *
 * Primary formats (full feature support):
 * - epub: EPUB 2.0/3.0 ebooks
 * - pdf: PDF documents
 *
 * Additional formats (basic support):
 * - mobi: Kindle MOBI format
 * - azw: Kindle AZW format
 * - azw3: Kindle AZW3/KF8 format
 * - fb2: FictionBook format
 * - fbz: FictionBook ZIP archive
 * - cbz: Comic book archive (ZIP)
 * - txt: Plain text files
 * - md: Markdown files
 */
export type BookFormat = 'epub' | 'pdf' | 'mobi' | 'azw' | 'azw3' | 'fb2' | 'fbz' | 'cbz' | 'txt' | 'md';

/**
 * File type classification for the files table.
 * - book: The actual ebook content file
 * - cover: Cover image (PNG, JPG)
 * - other: Metadata, thumbnails, extracted resources
 */
export type FileType = 'book' | 'cover' | 'other';

/**
 * Core book identity shared across platform and local app types.
 *
 * This interface captures the minimal set of fields that every Book representation
 * must have, enabling shared utilities that work with any Book-like object.
 * All date fields use epoch-millisecond numbers.
 */
export interface BookCore {
  /**
   * Partial MD5 hash of the file content, used as content identifier.
   * Computed by hashing multiple 1KB samples at exponentially increasing offsets.
   */
  hash: string;
  /** Book title. */
  title: string;
  /** File format of the book. */
  format: BookFormat;
  /** Epoch-ms timestamp of creation. */
  createdAt: number;
  /** Epoch-ms timestamp of last update. */
  updatedAt: number;
}

/**
 * Book entity representing an uploaded ebook in the platform.
 *
 * This is the canonical representation of a book as returned by the API.
 * Extends BookCore with platform-specific fields (id, userId, storage, etc.).
 */
export interface Book extends BookCore {
  /**
   * Unique identifier (UUID v4).
   * @example "550e8400-e29b-41d4-a716-446655440000"
   */
  id: string;

  /**
   * MD5 hash of extracted metadata (title, authors, identifiers).
   * Used for grouping different editions of the same book.
   * Null for sync-only books where metadata hash hasn't been computed.
   * @example "d41d8cd98f00b204e9800998ecf8427e"
   */
  metaHash: string | null;

  /**
   * Author name(s) extracted from metadata.
   * Null if author information is not available.
   * @example "F. Scott Fitzgerald"
   */
  author: string | null;

  /**
   * File size in bytes.
   * Null for sync-only books where file size is unknown.
   * @example 1048576
   */
  sizeBytes: number | null;

  /**
   * Storage path in R2 bucket.
   * Format: users/{userId}/books/{id}.{format}
   * Null for sync-only books that haven't been uploaded.
   * @example "users/123/books/550e8400-e29b-41d4-a716-446655440000.epub"
   */
  storagePath: string | null;

  /**
   * Owner user ID (UUID).
   * @example "123e4567-e89b-12d3-a456-426614174000"
   */
  userId: string;

  /**
   * Catalog book ID if this book was imported from the free catalog.
   * Null for user-uploaded books.
   * When non-null, the storagePath points to a shared R2 file (catalog/books/...)
   * that must NOT be deleted when the user removes this book from their library.
   */
  catalogBookId: string | null;
}
