/**
 * OPDS relation constants per OPDS 1.2 and 2.0 specifications.
 */
export const OPDS_REL = {
  // Acquisition relations (OPDS 1.2 §7)
  ACQUISITION: 'http://opds-spec.org/acquisition',
  ACQUISITION_OPEN_ACCESS: 'http://opds-spec.org/acquisition/open-access',
  ACQUISITION_BORROW: 'http://opds-spec.org/acquisition/borrow',
  ACQUISITION_BUY: 'http://opds-spec.org/acquisition/buy',
  ACQUISITION_SAMPLE: 'http://opds-spec.org/acquisition/sample',
  ACQUISITION_SUBSCRIBE: 'http://opds-spec.org/acquisition/subscribe',

  // Image relations
  IMAGE: 'http://opds-spec.org/image',
  IMAGE_THUMBNAIL: 'http://opds-spec.org/image/thumbnail',
  // Legacy cover relations (pre-1.2 catalogs)
  COVER_LEGACY: 'http://opds-spec.org/cover',
  THUMBNAIL_LEGACY: 'http://opds-spec.org/thumbnail',

  // Navigation relations
  START: 'start',
  SUBSECTION: 'subsection',
  SORT_NEW: 'http://opds-spec.org/sort/new',
  SORT_POPULAR: 'http://opds-spec.org/sort/popular',
  FEATURED: 'http://opds-spec.org/featured',
  RECOMMENDED: 'http://opds-spec.org/recommended',
  SHELF: 'http://opds-spec.org/shelf',
  SUBSCRIPTIONS: 'http://opds-spec.org/subscriptions',
  CRAWLABLE: 'http://opds-spec.org/crawlable',

  // Standard Atom link relations
  SELF: 'self',
  ALTERNATE: 'alternate',
  RELATED: 'related',
  ENCLOSURE: 'enclosure',

  // Pagination (RFC 5005)
  FIRST: 'first',
  PREVIOUS: 'previous',
  NEXT: 'next',
  LAST: 'last',

  // Search
  SEARCH: 'search',

  // Facets
  FACET: 'http://opds-spec.org/facet',

  // Grouping
  GROUP: 'http://opds-spec.org/group',
} as const;

/**
 * All acquisition relation URIs for identifying acquisition links.
 */
export const OPDS_ACQUISITION_RELS = [
  OPDS_REL.ACQUISITION,
  OPDS_REL.ACQUISITION_OPEN_ACCESS,
  OPDS_REL.ACQUISITION_BORROW,
  OPDS_REL.ACQUISITION_BUY,
  OPDS_REL.ACQUISITION_SAMPLE,
  OPDS_REL.ACQUISITION_SUBSCRIBE,
] as const;

/**
 * All image relation URIs including legacy variants.
 */
export const OPDS_IMAGE_RELS = [
  OPDS_REL.IMAGE,
  OPDS_REL.IMAGE_THUMBNAIL,
  OPDS_REL.COVER_LEGACY,
  OPDS_REL.THUMBNAIL_LEGACY,
] as const;

/**
 * Pagination relation URIs.
 */
export const OPDS_PAGINATION_RELS = [
  OPDS_REL.FIRST,
  OPDS_REL.PREVIOUS,
  OPDS_REL.NEXT,
  OPDS_REL.LAST,
] as const;

/**
 * OPDS and related media type constants.
 */
export const OPDS_MEDIA_TYPES = {
  // OPDS feed types
  ATOM_FEED: 'application/atom+xml;profile=opds-catalog',
  ATOM_ENTRY: 'application/atom+xml;type=entry;profile=opds-catalog',
  OPDS_JSON: 'application/opds+json',
  OPENSEARCH: 'application/opensearchdescription+xml',

  // Generic XML/Atom
  ATOM: 'application/atom+xml',
  XML: 'application/xml',
  TEXT_XML: 'text/xml',

  // Ebook formats
  EPUB: 'application/epub+zip',
  PDF: 'application/pdf',
  MOBI: 'application/x-mobipocket-ebook',
  FB2: 'application/x-fictionbook+xml',
  FB2_ZIP: 'application/x-fictionbook+xml+zip',
  CBZ: 'application/vnd.comicbook+zip',
  CBR: 'application/vnd.comicbook-rar',
  DJVU: 'image/vnd.djvu',
  AZW3: 'application/x-mobi8-ebook',

  // DRM containers
  ADOBE_DRM: 'application/vnd.adobe.adept+xml',
  LCP: 'application/vnd.readium.lcp.license.v1.0+json',

  // Image types (for covers/thumbnails)
  JPEG: 'image/jpeg',
  PNG: 'image/png',
  GIF: 'image/gif',
  WEBP: 'image/webp',

  // HTML
  HTML: 'text/html',
  XHTML: 'application/xhtml+xml',
} as const;

/**
 * XML namespace URIs used in OPDS Atom feeds.
 */
export const OPDS_NS = {
  ATOM: 'http://www.w3.org/2005/Atom',
  OPDS: 'http://opds-spec.org/2010/catalog',
  DC: 'http://purl.org/dc/elements/1.1/',
  DCTERMS: 'http://purl.org/dc/terms/',
  OPENSEARCH: 'http://a9.com/-/spec/opensearch/1.1/',
  THR: 'http://purl.org/syndication/thread/1.0',
  FH: 'http://purl.org/syndication/history/1.0',
  SCHEMA: 'http://schema.org/',
} as const;

/**
 * Supported ebook formats for download, in order of preference.
 */
export const EBOOK_FORMAT_PRIORITY: ReadonlyArray<string> = [
  OPDS_MEDIA_TYPES.EPUB,
  OPDS_MEDIA_TYPES.PDF,
  OPDS_MEDIA_TYPES.CBZ,
  OPDS_MEDIA_TYPES.CBR,
  OPDS_MEDIA_TYPES.FB2,
  OPDS_MEDIA_TYPES.MOBI,
  OPDS_MEDIA_TYPES.DJVU,
] as const;

/**
 * Human-readable labels for ebook formats.
 */
export const FORMAT_LABELS: Readonly<Record<string, string>> = {
  [OPDS_MEDIA_TYPES.EPUB]: 'EPUB',
  [OPDS_MEDIA_TYPES.PDF]: 'PDF',
  [OPDS_MEDIA_TYPES.MOBI]: 'MOBI',
  [OPDS_MEDIA_TYPES.FB2]: 'FB2',
  [OPDS_MEDIA_TYPES.FB2_ZIP]: 'FB2',
  [OPDS_MEDIA_TYPES.CBZ]: 'CBZ',
  [OPDS_MEDIA_TYPES.CBR]: 'CBR',
  [OPDS_MEDIA_TYPES.DJVU]: 'DJVU',
  [OPDS_MEDIA_TYPES.AZW3]: 'AZW3',
};

/**
 * Human-readable labels for acquisition types.
 */
export const ACQUISITION_LABELS: Readonly<Record<string, string>> = {
  [OPDS_REL.ACQUISITION]: 'Download',
  [OPDS_REL.ACQUISITION_OPEN_ACCESS]: 'Free Download',
  [OPDS_REL.ACQUISITION_BORROW]: 'Borrow',
  [OPDS_REL.ACQUISITION_BUY]: 'Buy',
  [OPDS_REL.ACQUISITION_SAMPLE]: 'Sample',
  [OPDS_REL.ACQUISITION_SUBSCRIBE]: 'Subscribe',
};

/**
 * Default timeouts for OPDS operations (in milliseconds).
 */
export const OPDS_TIMEOUTS = {
  FEED_FETCH: 30_000,
  DOWNLOAD: 300_000,
  AUTH_PROBE: 10_000,
  SEARCH: 15_000,
  VALIDATION: 10_000,
} as const;
