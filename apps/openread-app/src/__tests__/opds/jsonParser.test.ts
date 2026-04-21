import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseJson } from '@/app/opds/services/parsers/jsonParser';

function readFixture(name: string): string {
  return readFileSync(join(__dirname, 'fixtures', name), 'utf-8');
}

describe('JsonParser', () => {
  describe('OPDS 2.0 feed', () => {
    it('parses a complete OPDS 2.0 feed', () => {
      const json = readFixture('opds2-feed.json');
      const result = parseJson(json);

      expect(result.type).toBe('feed');
      expect(result.feed).toBeDefined();
      expect(result.feed!.title).toBe('Test OPDS 2.0 Feed');
      expect(result.feed!.id).toBe('urn:uuid:test-opds2');
      expect(result.feed!.subtitle).toBe('A test feed for OPDS 2.0 parsing');
    });

    it('parses navigation entries', () => {
      const json = readFixture('opds2-feed.json');
      const result = parseJson(json);

      expect(result.feed!.navigation.length).toBe(2);
      expect(result.feed!.navigation[0]!.title).toBe('New Releases');
      expect(result.feed!.navigation[0]!.href).toBe('/opds2/new');
    });

    it('parses publications', () => {
      const json = readFixture('opds2-feed.json');
      const result = parseJson(json);

      expect(result.feed!.publications.length).toBe(1);
      const pub = result.feed!.publications[0]!;

      expect(pub.title).toBe('Moby Dick');
      expect(pub.id).toBe('urn:isbn:9781503280786');
      expect(pub.authors.length).toBe(1);
      expect(pub.authors[0]!.name).toBe('Herman Melville');
      expect(pub.authors[0]!.sortAs).toBe('Melville, Herman');
      expect(pub.language).toBe('en');
      expect(pub.published).toBe('1851-10-18');
    });

    it('parses acquisition links from publications', () => {
      const json = readFixture('opds2-feed.json');
      const result = parseJson(json);
      const pub = result.feed!.publications[0]!;

      expect(pub.acquisitionLinks.length).toBe(2);
      const epubLink = pub.acquisitionLinks.find((l) => l.type === 'application/epub+zip');
      expect(epubLink).toBeDefined();
      expect(epubLink!.rel).toBe('http://opds-spec.org/acquisition/open-access');
    });

    it('parses images with dimensions', () => {
      const json = readFixture('opds2-feed.json');
      const result = parseJson(json);
      const pub = result.feed!.publications[0]!;

      expect(pub.images.length).toBe(2);
      const thumb = pub.images.find((i) => i.rel === 'http://opds-spec.org/image/thumbnail');
      expect(thumb).toBeDefined();
      expect(thumb!.width).toBe(200);
      expect(thumb!.height).toBe(300);
    });

    it('parses subjects', () => {
      const json = readFixture('opds2-feed.json');
      const result = parseJson(json);
      const pub = result.feed!.publications[0]!;

      expect(pub.subjects.length).toBe(1);
      expect(pub.subjects[0]!.name).toBe('Adventure');
    });

    it('parses series information', () => {
      const json = readFixture('opds2-feed.json');
      const result = parseJson(json);
      const pub = result.feed!.publications[0]!;

      expect(pub.series).toBeDefined();
      expect(pub.series!.name).toBe('Great American Novels');
      expect(pub.series!.position).toBe(1);
    });

    it('parses groups', () => {
      const json = readFixture('opds2-feed.json');
      const result = parseJson(json);

      expect(result.feed!.groups.length).toBe(1);
      expect(result.feed!.groups[0]!.title).toBe('Featured');
      expect(result.feed!.groups[0]!.publications.length).toBe(1);
    });

    it('parses pagination from links', () => {
      const json = readFixture('opds2-feed.json');
      const result = parseJson(json);

      expect(result.feed!.pagination).toBeDefined();
      expect(result.feed!.pagination!.next).toBe('/opds2/catalog?page=2');
      expect(result.feed!.isComplete).toBe(false);
    });

    it('extracts search template from links', () => {
      const json = readFixture('opds2-feed.json');
      const result = parseJson(json);

      expect(result.feed!.search).toBeDefined();
      expect(result.feed!.search!.template).toContain('{searchTerms}');
    });

    it('parses identifiers', () => {
      const json = readFixture('opds2-feed.json');
      const result = parseJson(json);
      const pub = result.feed!.publications[0]!;

      expect(pub.identifiers.length).toBeGreaterThan(0);
      const isbn = pub.identifiers.find((i) => i.scheme === 'isbn');
      expect(isbn).toBeDefined();
      expect(isbn!.value).toBe('9781503280786');
    });
  });

  describe('error handling', () => {
    it('returns error for invalid JSON', () => {
      const result = parseJson('not valid json');
      expect(result.type).toBe('error');
      expect(result.error).toBeTruthy();
    });

    it('returns error for unrecognized JSON structure', () => {
      const result = parseJson('{"random": "data"}');
      expect(result.type).toBe('error');
    });

    it('handles empty metadata gracefully', () => {
      const result = parseJson('{"metadata": {}, "publications": []}');
      expect(result.type).toBe('feed');
      expect(result.feed!.title).toBe('');
    });
  });
});
