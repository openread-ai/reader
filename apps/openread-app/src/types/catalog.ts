/** A book from the public catalog (Explore page). */
export interface CatalogBook {
  id: string;
  title: string;
  author_name: string;
  language: string;
  format_type: string;
  cover_image_key: string | null;
  cover_is_generated: boolean;
  is_cached: boolean;
  import_count: number;
  page_count: number | null;
  file_size_bytes: number | null;
  source?: string;
  source_id?: string;
  ia_identifier?: string;
  cover_url?: string;
}

/** A curated collection of catalog books. */
export interface CatalogCollection {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  sort_order: number;
  book_count: number;
}

/** Collection with its books pre-loaded. */
export interface CollectionWithBooks extends CatalogCollection {
  books: CatalogBook[];
}

/** Import lifecycle states. */
export type ImportStatus = 'idle' | 'importing' | 'ready' | 'error';

export interface ImportState {
  status: ImportStatus;
  progress?: number;
  bookId?: string;
  bookHash?: string;
  downloadUrl?: string;
  error?: string;
}

/** API response shapes for catalog endpoints. */
export interface CatalogBrowseResponse {
  books: CatalogBook[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ImportApiResponse {
  status: 'ready' | 'preparing';
  download_url?: string;
  book_id?: string;
  book_hash?: string;
}

export interface StatusApiResponse {
  caching_status: string;
}
