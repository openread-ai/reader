/**
 * Core OPDS domain types for OPDS 1.2 and 2.0 data structures.
 *
 * These types are framework-agnostic and represent the canonical
 * data model for the OPDS subsystem.
 */

/**
 * Represents an OPDS catalog - a root entry point for browsing.
 */
export interface OPDSCatalog {
  /** Unique identifier for this catalog */
  id: string;
  /** Display name */
  name: string;
  /** Root feed URL */
  url: string;
  /** Optional description */
  description?: string;
  /** Icon emoji or URL */
  icon?: string;
  /** Whether authentication is required */
  requiresAuth: boolean;
  /** Timestamp when catalog was added (ISO 8601) */
  createdAt: string;
  /** Timestamp when catalog was last accessed (ISO 8601) */
  lastAccessedAt?: string;
  /** Whether catalog is temporarily disabled */
  disabled?: boolean;
}

/**
 * Feed type discriminator.
 */
export type OPDSFeedType = 'navigation' | 'acquisition' | 'mixed';

/**
 * Represents a parsed OPDS feed (Navigation or Acquisition).
 */
export interface OPDSFeed {
  /** Feed identifier (Atom id) */
  id: string;
  /** Feed title */
  title: string;
  /** Feed subtitle/tagline */
  subtitle?: string;
  /** Last updated timestamp (ISO 8601) */
  updated: string;
  /** Feed author */
  author?: OPDSPerson;
  /** Feed icon URL */
  icon?: string;
  /** Feed links (navigation, self, etc.) */
  links: OPDSLink[];
  /** Publications in this feed (Acquisition feed) */
  publications: OPDSPublication[];
  /** Navigation entries (Navigation feed) */
  navigation: OPDSNavigationEntry[];
  /** Facet groups for filtering */
  facets: OPDSFacetGroup[];
  /** Grouped entries */
  groups: OPDSGroup[];
  /** Pagination info */
  pagination?: OPDSPagination;
  /** Whether this is a complete feed (no pagination needed) */
  isComplete: boolean;
  /** OpenSearch descriptor if available */
  search?: OPDSSearchDescriptor;
  /** Feed type discriminant derived from content */
  feedType: OPDSFeedType;
}

/**
 * Navigation entry in a Navigation feed.
 */
export interface OPDSNavigationEntry {
  /** Entry identifier */
  id: string;
  /** Entry title */
  title: string;
  /** Entry summary/description */
  summary?: string;
  /** Link to the target feed */
  href: string;
  /** Link relation */
  rel?: string;
  /** Media type */
  type?: string;
  /** Number of items (if known) */
  count?: number;
  /** Last updated */
  updated?: string;
}

/**
 * Represents a publication (book, document, etc.).
 */
export interface OPDSPublication {
  /** Publication identifier (Atom id or ISBN, etc.) */
  id: string;
  /** Title */
  title: string;
  /** Subtitle */
  subtitle?: string;
  /** Authors */
  authors: OPDSPerson[];
  /** Contributors (editors, translators, etc.) */
  contributors: OPDSPerson[];
  /** Publisher name */
  publisher?: string;
  /** Publication date */
  published?: string;
  /** Last modified date */
  updated?: string;
  /** Language code (ISO 639-1) */
  language?: string;
  /** Summary/description (may contain HTML) */
  summary?: string;
  /** Full content/description */
  content?: OPDSContent;
  /** Cover/thumbnail images */
  images: OPDSImage[];
  /** Subject categories/tags */
  subjects: OPDSSubject[];
  /** Acquisition links */
  acquisitionLinks: OPDSAcquisitionLink[];
  /** Other links (related, alternate, etc.) */
  links: OPDSLink[];
  /** Identifiers (ISBN, DOI, etc.) */
  identifiers: OPDSIdentifier[];
  /** Series information */
  series?: OPDSSeries;
  /** Rights/license information */
  rights?: string;
  /** Source feed URL */
  sourceFeed?: string;
}

/**
 * Person (author, contributor, etc.).
 */
export interface OPDSPerson {
  /** Display name */
  name: string;
  /** URI (website, VIAF, etc.) */
  uri?: string;
  /** Sort key (e.g. "Austen, Jane") */
  sortAs?: string;
}

/**
 * Generic link.
 */
export interface OPDSLink {
  /** Link target URL */
  href: string;
  /** Link relation(s) */
  rel?: string;
  /** Media type of the target */
  type?: string;
  /** Link title */
  title?: string;
  /** Target language */
  hreflang?: string;
  /** Content length in bytes */
  length?: number;
}

/**
 * Acquisition link with additional metadata.
 */
export interface OPDSAcquisitionLink extends OPDSLink {
  /** Price information */
  price?: OPDSPrice;
  /** Indirect acquisition chain (DRM, container formats) */
  indirectAcquisition?: OPDSIndirectAcquisition[];
  /** Availability status */
  availability?: OPDSAvailability;
  /** Number of copies available (library lending) */
  copies?: number;
  /** Number of holds/reservations (library lending) */
  holds?: number;
}

/**
 * Acquisition relation types per OPDS 1.2 spec.
 */
export type OPDSAcquisitionRel =
  | 'http://opds-spec.org/acquisition'
  | 'http://opds-spec.org/acquisition/open-access'
  | 'http://opds-spec.org/acquisition/borrow'
  | 'http://opds-spec.org/acquisition/buy'
  | 'http://opds-spec.org/acquisition/sample'
  | 'http://opds-spec.org/acquisition/subscribe';

/**
 * Price information for paid acquisitions.
 */
export interface OPDSPrice {
  /** Numeric price value */
  value: number;
  /** ISO 4217 currency code */
  currency: string;
}

/**
 * Indirect acquisition (container formats, DRM, etc.).
 * Forms a chain: e.g. ACSM -> EPUB means download ACSM to get EPUB.
 */
export interface OPDSIndirectAcquisition {
  /** MIME type of the indirect format */
  type: string;
  /** Nested indirect acquisitions */
  indirectAcquisition?: OPDSIndirectAcquisition[];
}

/**
 * Availability status for borrow/subscribe acquisitions.
 */
export interface OPDSAvailability {
  /** Current availability state */
  state: 'available' | 'unavailable' | 'reserved' | 'ready';
  /** Available since (ISO 8601) */
  since?: string;
  /** Available until (ISO 8601) */
  until?: string;
}

/**
 * Image (cover, thumbnail).
 */
export interface OPDSImage {
  /** Image URL */
  href: string;
  /** MIME type */
  type?: string;
  /** Image relation */
  rel: string;
  /** Image width in pixels */
  width?: number;
  /** Image height in pixels */
  height?: number;
}

/**
 * Subject/category classification.
 */
export interface OPDSSubject {
  /** Human-readable label */
  name: string;
  /** Machine-readable code */
  code?: string;
  /** Classification scheme URI */
  scheme?: string;
}

/**
 * Identifier (ISBN, DOI, etc.).
 */
export interface OPDSIdentifier {
  /** Identifier value */
  value: string;
  /** Identifier scheme (isbn, doi, uuid, etc.) */
  scheme?: string;
}

/**
 * Series information.
 */
export interface OPDSSeries {
  /** Series name */
  name: string;
  /** Position within the series */
  position?: number;
}

/**
 * Content element (description, annotation).
 */
export interface OPDSContent {
  /** Content text */
  value: string;
  /** Content type */
  type: 'text' | 'html' | 'xhtml';
}

/**
 * Facet for filtering.
 */
export interface OPDSFacet {
  /** Facet label */
  title: string;
  /** Facet link */
  href: string;
  /** Number of items matching this facet */
  count?: number;
  /** Whether this facet is currently active */
  active?: boolean;
}

/**
 * Facet group.
 */
export interface OPDSFacetGroup {
  /** Group label (e.g. "Author", "Language") */
  title: string;
  /** Facets within this group */
  facets: OPDSFacet[];
}

/**
 * Group of entries (for grouped/featured feeds).
 */
export interface OPDSGroup {
  /** Group title */
  title: string;
  /** Group links (self, alternate) */
  links: OPDSLink[];
  /** Publications in this group */
  publications: OPDSPublication[];
  /** Navigation entries in this group */
  navigation: OPDSNavigationEntry[];
}

/**
 * Pagination metadata (RFC 5005 + OpenSearch).
 */
export interface OPDSPagination {
  /** Link to first page */
  first?: string;
  /** Link to previous page */
  previous?: string;
  /** Link to next page */
  next?: string;
  /** Link to last page */
  last?: string;
  /** Total number of results (from opensearch:totalResults) */
  totalResults?: number;
  /** Results per page (from opensearch:itemsPerPage) */
  itemsPerPage?: number;
  /** Current start index (from opensearch:startIndex) */
  startIndex?: number;
}

/**
 * OpenSearch descriptor.
 */
export interface OPDSSearchDescriptor {
  /** Search template URL with placeholders */
  template: string;
  /** Supported search parameters */
  parameters: OPDSSearchParameter[];
  /** Short name of the search engine */
  shortName?: string;
  /** Description of the search engine */
  description?: string;
}

/**
 * Search parameter definition.
 */
export interface OPDSSearchParameter {
  /** Parameter name */
  name: string;
  /** Template placeholder value */
  value: string;
  /** Whether the parameter is required */
  required?: boolean;
  /** Human-readable title */
  title?: string;
  /** Namespace (for OpenSearch extensions) */
  ns?: string | null;
}
