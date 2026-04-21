import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseAtom } from '@/app/opds/services/parsers/atomParser';

function readFixture(name: string): string {
  return readFileSync(join(__dirname, 'fixtures', name), 'utf-8');
}

describe('AtomParser', () => {
  describe('navigation feed', () => {
    it('parses a navigation feed correctly', () => {
      const xml = readFixture('gutenberg-navigation.xml');
      const result = parseAtom(xml);

      expect(result.type).toBe('feed');
      expect(result.feed).toBeDefined();
      expect(result.feed!.title).toBe('Project Gutenberg');
      expect(result.feed!.subtitle).toBe('Free ebooks since 1971');
      expect(result.feed!.id).toBe('urn:uuid:gutenberg-root');
    });

    it('extracts navigation entries', () => {
      const xml = readFixture('gutenberg-navigation.xml');
      const result = parseAtom(xml);

      expect(result.feed!.navigation.length).toBe(3);
      expect(result.feed!.publications.length).toBe(0);

      const popular = result.feed!.navigation[0]!;
      expect(popular.title).toBe('Popular');
      expect(popular.href).toBeTruthy();
    });

    it('extracts search template from links', () => {
      const xml = readFixture('gutenberg-navigation.xml');
      const result = parseAtom(xml);

      const searchLink = result.feed!.links.find((l) => l.rel === 'search');
      expect(searchLink).toBeDefined();
      expect(searchLink!.href).toContain('{searchTerms}');
    });

    it('extracts feed author', () => {
      const xml = readFixture('gutenberg-navigation.xml');
      const result = parseAtom(xml);

      expect(result.feed!.author).toBeDefined();
      expect(result.feed!.author!.name).toBe('Project Gutenberg');
      expect(result.feed!.author!.uri).toBe('https://www.gutenberg.org');
    });
  });

  describe('acquisition feed', () => {
    it('parses an acquisition feed with publications', () => {
      const xml = readFixture('acquisition-feed.xml');
      const result = parseAtom(xml);

      expect(result.type).toBe('feed');
      expect(result.feed!.publications.length).toBe(3);
    });

    it('parses publication metadata', () => {
      const xml = readFixture('acquisition-feed.xml');
      const result = parseAtom(xml);
      const pub = result.feed!.publications[0]!;

      expect(pub.title).toBe('Pride and Prejudice');
      expect(pub.id).toBe('urn:isbn:9780141439518');
      expect(pub.authors.length).toBe(1);
      expect(pub.authors[0]!.name).toBe('Jane Austen');
      expect(pub.authors[0]!.uri).toBe('https://en.wikipedia.org/wiki/Jane_Austen');
      expect(pub.language).toBe('en');
      expect(pub.publisher).toBe('Public Domain');
      expect(pub.published).toBe('1813-01-28');
      expect(pub.rights).toBe('Public Domain');
    });

    it('parses acquisition links', () => {
      const xml = readFixture('acquisition-feed.xml');
      const result = parseAtom(xml);
      const pub = result.feed!.publications[0]!;

      expect(pub.acquisitionLinks.length).toBe(2);

      const epubLink = pub.acquisitionLinks.find((l) => l.type === 'application/epub+zip');
      expect(epubLink).toBeDefined();
      expect(epubLink!.rel).toBe('http://opds-spec.org/acquisition/open-access');
      expect(epubLink!.href).toBe('/books/pride.epub');
    });

    it('parses all acquisition link types', () => {
      const xml = readFixture('acquisition-feed.xml');
      const result = parseAtom(xml);
      const pub = result.feed!.publications[1]!; // A Study in Scarlet

      // generic acquisition, buy, borrow, sample
      expect(pub.acquisitionLinks.length).toBe(4);

      const buyLink = pub.acquisitionLinks.find(
        (l) => l.rel === 'http://opds-spec.org/acquisition/buy',
      );
      expect(buyLink).toBeDefined();
      expect(buyLink!.price).toEqual({ value: 4.99, currency: 'USD' });

      const borrowLink = pub.acquisitionLinks.find(
        (l) => l.rel === 'http://opds-spec.org/acquisition/borrow',
      );
      expect(borrowLink).toBeDefined();
      expect(borrowLink!.availability).toBeDefined();
      expect(borrowLink!.availability!.state).toBe('available');
    });

    it('parses indirect acquisition chains', () => {
      const xml = readFixture('acquisition-feed.xml');
      const result = parseAtom(xml);
      const drmPub = result.feed!.publications[2]!; // DRM Protected Book

      expect(drmPub.acquisitionLinks.length).toBe(1);
      const link = drmPub.acquisitionLinks[0]!;
      expect(link.type).toBe('application/vnd.adobe.adept+xml');
      expect(link.indirectAcquisition).toBeDefined();
      expect(link.indirectAcquisition!.length).toBeGreaterThan(0);
      expect(link.indirectAcquisition![0]!.type).toBe('application/epub+zip');
    });

    it('parses images (cover and thumbnail)', () => {
      const xml = readFixture('acquisition-feed.xml');
      const result = parseAtom(xml);
      const pub = result.feed!.publications[0]!;

      expect(pub.images.length).toBe(2);
      const cover = pub.images.find((i) => i.rel === 'http://opds-spec.org/image');
      const thumb = pub.images.find((i) => i.rel === 'http://opds-spec.org/image/thumbnail');
      expect(cover).toBeDefined();
      expect(thumb).toBeDefined();
    });

    it('parses subjects/categories', () => {
      const xml = readFixture('acquisition-feed.xml');
      const result = parseAtom(xml);
      const pub = result.feed!.publications[0]!;

      expect(pub.subjects.length).toBe(2);
      expect(pub.subjects[0]!.name).toBe('Fiction / Classics');
      expect(pub.subjects[0]!.code).toBe('FIC004000');
      expect(pub.subjects[0]!.scheme).toBe('http://www.bisg.org/standards/bisac');
    });

    it('parses identifiers', () => {
      const xml = readFixture('acquisition-feed.xml');
      const result = parseAtom(xml);
      const pub = result.feed!.publications[0]!;

      expect(pub.identifiers.length).toBeGreaterThan(0);
      const isbn = pub.identifiers.find((i) => i.scheme === 'isbn');
      expect(isbn).toBeDefined();
      expect(isbn!.value).toBe('9780141439518');
    });

    it('parses content element', () => {
      const xml = readFixture('acquisition-feed.xml');
      const result = parseAtom(xml);
      const pub = result.feed!.publications[0]!;

      expect(pub.content).toBeDefined();
      expect(pub.content!.type).toBe('html');
    });

    it('parses contributors', () => {
      const xml = readFixture('acquisition-feed.xml');
      const result = parseAtom(xml);
      const pub = result.feed!.publications[1]!; // A Study in Scarlet

      expect(pub.contributors.length).toBe(1);
      expect(pub.contributors[0]!.name).toBe('John H. Watson');
    });
  });

  describe('facets', () => {
    it('parses facet groups', () => {
      const xml = readFixture('acquisition-feed.xml');
      const result = parseAtom(xml);

      expect(result.feed!.facets.length).toBe(2); // Format, Language
      const formatGroup = result.feed!.facets.find((g) => g.title === 'Format');
      expect(formatGroup).toBeDefined();
      expect(formatGroup!.facets.length).toBe(2);
      expect(formatGroup!.facets[0]!.title).toBe('EPUB');
      expect(formatGroup!.facets[0]!.count).toBe(42);
    });

    it('detects active facets', () => {
      const xml = readFixture('acquisition-feed.xml');
      const result = parseAtom(xml);

      const langGroup = result.feed!.facets.find((g) => g.title === 'Language');
      expect(langGroup).toBeDefined();
      const englishFacet = langGroup!.facets.find((f) => f.title === 'English');
      expect(englishFacet?.active).toBe(true);
    });
  });

  describe('pagination', () => {
    it('parses pagination links', () => {
      const xml = readFixture('acquisition-feed.xml');
      const result = parseAtom(xml);

      expect(result.feed!.pagination).toBeDefined();
      expect(result.feed!.pagination!.next).toBeTruthy();
    });

    it('parses OpenSearch pagination metadata', () => {
      const xml = readFixture('acquisition-feed.xml');
      const result = parseAtom(xml);

      expect(result.feed!.pagination!.totalResults).toBe(60);
      expect(result.feed!.pagination!.itemsPerPage).toBe(20);
      expect(result.feed!.pagination!.startIndex).toBe(0);
    });

    it('marks feed as not complete when paginated', () => {
      const xml = readFixture('acquisition-feed.xml');
      const result = parseAtom(xml);

      expect(result.feed!.isComplete).toBe(false);
    });
  });

  describe('error handling', () => {
    it('returns error for invalid XML', () => {
      const result = parseAtom('<not valid xml');
      expect(result.type).toBe('error');
      expect(result.error).toBeTruthy();
    });

    it('returns error for unknown root element', () => {
      const result = parseAtom('<?xml version="1.0"?><html><body>Not OPDS</body></html>');
      expect(result.type).toBe('error');
    });
  });
});
