/**
 * OPDS domain types barrel export.
 */

// Core types
export type {
  OPDSCatalog,
  OPDSFeed,
  OPDSFeedType,
  OPDSNavigationEntry,
  OPDSPublication,
  OPDSPerson,
  OPDSLink,
  OPDSAcquisitionLink,
  OPDSAcquisitionRel,
  OPDSPrice,
  OPDSIndirectAcquisition,
  OPDSAvailability,
  OPDSImage,
  OPDSSubject,
  OPDSIdentifier,
  OPDSSeries,
  OPDSContent,
  OPDSFacet,
  OPDSFacetGroup,
  OPDSGroup,
  OPDSPagination,
  OPDSSearchDescriptor,
  OPDSSearchParameter,
} from './opds';

// Result types
export type {
  OPDSBrowseResult,
  OPDSDownloadResult,
  OPDSValidationResult,
  OPDSAcquisitionOption,
  OPDSError,
  OPDSErrorCode,
} from './results';

// Constants
export {
  OPDS_REL,
  OPDS_ACQUISITION_RELS,
  OPDS_IMAGE_RELS,
  OPDS_PAGINATION_RELS,
  OPDS_MEDIA_TYPES,
  OPDS_NS,
  EBOOK_FORMAT_PRIORITY,
  FORMAT_LABELS,
  ACQUISITION_LABELS,
  OPDS_TIMEOUTS,
} from './constants';

// Type guards
export {
  classifyFeedType,
  isNavigationFeed,
  isAcquisitionFeed,
  isMixedFeed,
  isAcquisitionLink,
  isOpenAccessLink,
  isBorrowLink,
  isBuyLink,
  isSampleLink,
  isSubscribeLink,
  hasIndirectAcquisition,
  isSearchLink,
  isPaginationLink,
  hasFreeDownload,
  isOPDSFeedLike,
  isOPDSPublicationLike,
} from './guards';
