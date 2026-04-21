import { describe, it, expect } from 'vitest';
import {
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
  OPDS_REL,
} from '@/app/opds/types';
import type { OPDSAcquisitionLink, OPDSFeed, OPDSLink, OPDSPublication } from '@/app/opds/types';

function createMockFeed(overrides: Partial<OPDSFeed> = {}): OPDSFeed {
  return {
    id: 'test-feed',
    title: 'Test Feed',
    updated: '2024-01-01T00:00:00Z',
    links: [],
    publications: [],
    navigation: [],
    facets: [],
    groups: [],
    isComplete: true,
    feedType: 'navigation',
    ...overrides,
  };
}

function createMockPublication(overrides: Partial<OPDSPublication> = {}): OPDSPublication {
  return {
    id: 'test-pub',
    title: 'Test Publication',
    authors: [{ name: 'Test Author' }],
    contributors: [],
    images: [],
    subjects: [],
    acquisitionLinks: [],
    links: [],
    identifiers: [],
    ...overrides,
  };
}

function createMockLink(overrides: Partial<OPDSLink> = {}): OPDSLink {
  return {
    href: 'https://example.com/test',
    ...overrides,
  };
}

function createMockAcqLink(overrides: Partial<OPDSAcquisitionLink> = {}): OPDSAcquisitionLink {
  return {
    href: 'https://example.com/book.epub',
    rel: OPDS_REL.ACQUISITION,
    type: 'application/epub+zip',
    ...overrides,
  };
}

describe('Type Guards', () => {
  describe('isNavigationFeed', () => {
    it('returns true for navigation feeds', () => {
      const feed = createMockFeed({ feedType: 'navigation' });
      expect(isNavigationFeed(feed)).toBe(true);
    });

    it('returns false for acquisition feeds', () => {
      const feed = createMockFeed({ feedType: 'acquisition' });
      expect(isNavigationFeed(feed)).toBe(false);
    });

    it('returns false for mixed feeds', () => {
      const feed = createMockFeed({ feedType: 'mixed' });
      expect(isNavigationFeed(feed)).toBe(false);
    });
  });

  describe('isAcquisitionFeed', () => {
    it('returns true for acquisition feeds', () => {
      const feed = createMockFeed({ feedType: 'acquisition' });
      expect(isAcquisitionFeed(feed)).toBe(true);
    });

    it('returns true for mixed feeds (they have publications)', () => {
      const feed = createMockFeed({ feedType: 'mixed' });
      expect(isAcquisitionFeed(feed)).toBe(true);
    });

    it('returns false for navigation feeds', () => {
      const feed = createMockFeed({ feedType: 'navigation' });
      expect(isAcquisitionFeed(feed)).toBe(false);
    });
  });

  describe('isMixedFeed', () => {
    it('returns true for mixed feeds', () => {
      const feed = createMockFeed({ feedType: 'mixed' });
      expect(isMixedFeed(feed)).toBe(true);
    });

    it('returns false for pure navigation feeds', () => {
      const feed = createMockFeed({ feedType: 'navigation' });
      expect(isMixedFeed(feed)).toBe(false);
    });

    it('returns false for pure acquisition feeds', () => {
      const feed = createMockFeed({ feedType: 'acquisition' });
      expect(isMixedFeed(feed)).toBe(false);
    });
  });

  describe('isAcquisitionLink', () => {
    it('identifies acquisition links by rel', () => {
      expect(isAcquisitionLink(createMockLink({ rel: OPDS_REL.ACQUISITION }))).toBe(true);
      expect(isAcquisitionLink(createMockLink({ rel: OPDS_REL.ACQUISITION_OPEN_ACCESS }))).toBe(
        true,
      );
      expect(isAcquisitionLink(createMockLink({ rel: OPDS_REL.ACQUISITION_BUY }))).toBe(true);
    });

    it('returns false for non-acquisition links', () => {
      expect(isAcquisitionLink(createMockLink({ rel: 'self' }))).toBe(false);
      expect(isAcquisitionLink(createMockLink({ rel: 'search' }))).toBe(false);
      expect(isAcquisitionLink(createMockLink({}))).toBe(false);
    });
  });

  describe('acquisition type guards', () => {
    it('isOpenAccessLink identifies open-access links', () => {
      expect(isOpenAccessLink(createMockAcqLink({ rel: OPDS_REL.ACQUISITION_OPEN_ACCESS }))).toBe(
        true,
      );
      expect(isOpenAccessLink(createMockAcqLink({ rel: OPDS_REL.ACQUISITION_BUY }))).toBe(false);
    });

    it('isBorrowLink identifies borrow links', () => {
      expect(isBorrowLink(createMockAcqLink({ rel: OPDS_REL.ACQUISITION_BORROW }))).toBe(true);
      expect(isBorrowLink(createMockAcqLink({ rel: OPDS_REL.ACQUISITION }))).toBe(false);
    });

    it('isBuyLink identifies buy links', () => {
      expect(isBuyLink(createMockAcqLink({ rel: OPDS_REL.ACQUISITION_BUY }))).toBe(true);
    });

    it('isSampleLink identifies sample links', () => {
      expect(isSampleLink(createMockAcqLink({ rel: OPDS_REL.ACQUISITION_SAMPLE }))).toBe(true);
    });

    it('isSubscribeLink identifies subscribe links', () => {
      expect(isSubscribeLink(createMockAcqLink({ rel: OPDS_REL.ACQUISITION_SUBSCRIBE }))).toBe(
        true,
      );
    });
  });

  describe('hasIndirectAcquisition', () => {
    it('returns true when indirect acquisition exists', () => {
      const link = createMockAcqLink({
        indirectAcquisition: [{ type: 'application/epub+zip' }],
      });
      expect(hasIndirectAcquisition(link)).toBe(true);
    });

    it('returns false when no indirect acquisition', () => {
      expect(hasIndirectAcquisition(createMockAcqLink())).toBe(false);
      expect(hasIndirectAcquisition(createMockAcqLink({ indirectAcquisition: [] }))).toBe(false);
    });
  });

  describe('isSearchLink', () => {
    it('identifies search links', () => {
      expect(isSearchLink(createMockLink({ rel: 'search' }))).toBe(true);
      expect(isSearchLink(createMockLink({ rel: 'self' }))).toBe(false);
    });
  });

  describe('isPaginationLink', () => {
    it('identifies pagination links', () => {
      expect(isPaginationLink(createMockLink({ rel: 'next' }))).toBe(true);
      expect(isPaginationLink(createMockLink({ rel: 'previous' }))).toBe(true);
      expect(isPaginationLink(createMockLink({ rel: 'first' }))).toBe(true);
      expect(isPaginationLink(createMockLink({ rel: 'last' }))).toBe(true);
      expect(isPaginationLink(createMockLink({ rel: 'self' }))).toBe(false);
    });
  });

  describe('hasFreeDownload', () => {
    it('returns true if publication has open-access links', () => {
      const pub = createMockPublication({
        acquisitionLinks: [createMockAcqLink({ rel: OPDS_REL.ACQUISITION_OPEN_ACCESS })],
      });
      expect(hasFreeDownload(pub)).toBe(true);
    });

    it('returns false if no open-access links', () => {
      const pub = createMockPublication({
        acquisitionLinks: [createMockAcqLink({ rel: OPDS_REL.ACQUISITION_BUY })],
      });
      expect(hasFreeDownload(pub)).toBe(false);
    });
  });

  describe('runtime shape checks', () => {
    it('isOPDSFeedLike validates feed shape', () => {
      expect(isOPDSFeedLike(createMockFeed())).toBe(true);
      expect(isOPDSFeedLike(null)).toBe(false);
      expect(isOPDSFeedLike({})).toBe(false);
      expect(isOPDSFeedLike({ title: 'test' })).toBe(false);
      expect(isOPDSFeedLike({ title: 'test', links: [], publications: [], navigation: [] })).toBe(
        false,
      );
      // Missing isComplete should fail
      expect(
        isOPDSFeedLike({
          title: 'test',
          links: [],
          publications: [],
          navigation: [],
          feedType: 'navigation',
        }),
      ).toBe(false);
      // With isComplete should pass
      expect(
        isOPDSFeedLike({
          title: 'test',
          links: [],
          publications: [],
          navigation: [],
          isComplete: true,
          feedType: 'navigation',
        }),
      ).toBe(true);
    });

    it('isOPDSPublicationLike validates publication shape', () => {
      expect(isOPDSPublicationLike(createMockPublication())).toBe(true);
      expect(isOPDSPublicationLike(null)).toBe(false);
      expect(isOPDSPublicationLike({})).toBe(false);
      expect(
        isOPDSPublicationLike({ id: '1', title: 'test', authors: [], acquisitionLinks: [] }),
      ).toBe(true);
    });
  });
});
