/**
 * Type guard functions for runtime validation of OPDS data structures.
 */

import type {
  OPDSAcquisitionLink,
  OPDSFeed,
  OPDSFeedType,
  OPDSLink,
  OPDSPublication,
} from './opds';
import { OPDS_ACQUISITION_RELS, OPDS_REL } from './constants';

/**
 * Check if a feed is a navigation-only feed.
 * Delegates to the feedType discriminant set by parsers.
 */
export function isNavigationFeed(feed: OPDSFeed): boolean {
  return feed.feedType === 'navigation';
}

/**
 * Check if a feed is an acquisition feed (has publications).
 * Delegates to the feedType discriminant set by parsers.
 */
export function isAcquisitionFeed(feed: OPDSFeed): boolean {
  return feed.feedType === 'acquisition' || feed.feedType === 'mixed';
}

/**
 * Check if a feed is a mixed feed (both navigation and publications).
 * Delegates to the feedType discriminant set by parsers.
 */
export function isMixedFeed(feed: OPDSFeed): boolean {
  return feed.feedType === 'mixed';
}

/**
 * Compute the feed type from navigation and publication arrays.
 * Used by parsers to populate the feedType field.
 */
export function classifyFeedType(navigationCount: number, publicationCount: number): OPDSFeedType {
  if (navigationCount > 0 && publicationCount > 0) return 'mixed';
  if (publicationCount > 0) return 'acquisition';
  return 'navigation';
}

/**
 * Check if a link is an acquisition link.
 */
export function isAcquisitionLink(link: OPDSLink): link is OPDSAcquisitionLink {
  if (!link.rel) return false;
  return OPDS_ACQUISITION_RELS.some((rel) => link.rel === rel || link.rel?.startsWith(rel));
}

/**
 * Check if a link is an open-access (free download) link.
 */
export function isOpenAccessLink(link: OPDSAcquisitionLink): boolean {
  return link.rel === OPDS_REL.ACQUISITION_OPEN_ACCESS;
}

/**
 * Check if a link is a borrow link (library lending).
 */
export function isBorrowLink(link: OPDSAcquisitionLink): boolean {
  return link.rel === OPDS_REL.ACQUISITION_BORROW;
}

/**
 * Check if a link is a buy link.
 */
export function isBuyLink(link: OPDSAcquisitionLink): boolean {
  return link.rel === OPDS_REL.ACQUISITION_BUY;
}

/**
 * Check if a link is a sample link.
 */
export function isSampleLink(link: OPDSAcquisitionLink): boolean {
  return link.rel === OPDS_REL.ACQUISITION_SAMPLE;
}

/**
 * Check if a link is a subscribe link.
 */
export function isSubscribeLink(link: OPDSAcquisitionLink): boolean {
  return link.rel === OPDS_REL.ACQUISITION_SUBSCRIBE;
}

/**
 * Check if a link has indirect acquisition (DRM or container format).
 */
export function hasIndirectAcquisition(link: OPDSAcquisitionLink): boolean {
  return (link.indirectAcquisition?.length ?? 0) > 0;
}

/**
 * Check if a link is a search link.
 */
export function isSearchLink(link: OPDSLink): boolean {
  return link.rel === OPDS_REL.SEARCH;
}

/**
 * Check if a link is a pagination link.
 */
export function isPaginationLink(link: OPDSLink): boolean {
  return (
    link.rel === OPDS_REL.FIRST ||
    link.rel === OPDS_REL.PREVIOUS ||
    link.rel === OPDS_REL.NEXT ||
    link.rel === OPDS_REL.LAST
  );
}

/**
 * Check if a publication has any free (open-access) download links.
 */
export function hasFreeDownload(publication: OPDSPublication): boolean {
  return publication.acquisitionLinks.some(isOpenAccessLink);
}

/**
 * Check if an object looks like a valid OPDSFeed (runtime shape check).
 */
export function isOPDSFeedLike(obj: unknown): obj is OPDSFeed {
  if (!obj || typeof obj !== 'object') return false;
  const feed = obj as Record<string, unknown>;
  return (
    typeof feed.title === 'string' &&
    Array.isArray(feed.links) &&
    Array.isArray(feed.publications) &&
    Array.isArray(feed.navigation) &&
    typeof feed.isComplete === 'boolean' &&
    (feed.feedType === 'navigation' || feed.feedType === 'acquisition' || feed.feedType === 'mixed')
  );
}

/**
 * Check if an object looks like a valid OPDSPublication (runtime shape check).
 */
export function isOPDSPublicationLike(obj: unknown): obj is OPDSPublication {
  if (!obj || typeof obj !== 'object') return false;
  const pub = obj as Record<string, unknown>;
  return (
    typeof pub.id === 'string' &&
    typeof pub.title === 'string' &&
    Array.isArray(pub.authors) &&
    Array.isArray(pub.acquisitionLinks)
  );
}
