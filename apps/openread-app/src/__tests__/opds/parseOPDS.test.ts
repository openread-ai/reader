import { describe, it, expect, vi } from 'vitest';
import { parseOPDS } from '@/app/opds/services/parsers';
import { detectFormat } from '@/app/opds/services/parsers/openSearchParser';

describe('detectFormat', () => {
  it('detects JSON from content type', () => {
    expect(detectFormat('application/opds+json', '{}')).toBe('json');
    expect(detectFormat('application/json', '{}')).toBe('json');
    expect(detectFormat('application/json; charset=utf-8', '{}')).toBe('json');
  });

  it('detects OpenSearch from content type', () => {
    expect(detectFormat('application/opensearchdescription+xml', '<OpenSearchDescription/>')).toBe(
      'opensearch',
    );
  });

  it('detects Atom XML from content type', () => {
    expect(detectFormat('application/atom+xml', '<feed/>')).toBe('atom');
    expect(detectFormat('application/xml', '<feed/>')).toBe('atom');
    expect(detectFormat('text/xml', '<feed/>')).toBe('atom');
  });

  it('detects OpenSearch even with Atom content type if body contains OpenSearchDescription', () => {
    expect(
      detectFormat(
        'application/xml',
        '<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/"/>',
      ),
    ).toBe('opensearch');
  });

  it('falls back to body sniffing for unknown content types', () => {
    expect(detectFormat('text/plain', '{"metadata": {}}')).toBe('json');
    expect(detectFormat('text/plain', '[1,2,3]')).toBe('json');
    expect(detectFormat('text/plain', '<feed><entry/></feed>')).toBe('atom');
    expect(detectFormat('text/plain', '<OpenSearchDescription>...</OpenSearchDescription>')).toBe(
      'opensearch',
    );
  });

  it('returns unknown for unrecognizable content', () => {
    expect(detectFormat('text/plain', 'not xml or json')).toBe('unknown');
    expect(detectFormat('', '')).toBe('unknown');
  });
});

describe('parseOPDS', () => {
  it('dispatches Atom XML to atomParser', () => {
    const atomFeed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>test-feed</id>
  <title>Test Feed</title>
  <updated>2024-01-01T00:00:00Z</updated>
  <entry>
    <id>nav-1</id>
    <title>Popular</title>
    <link href="/popular" type="application/atom+xml;profile=opds-catalog" rel="subsection"/>
  </entry>
</feed>`;

    const result = parseOPDS('application/atom+xml', atomFeed);
    expect(result.type).toBe('feed');
    expect(result.feed).toBeDefined();
    expect(result.feed!.title).toBe('Test Feed');
    expect(result.feed!.feedType).toBe('navigation');
  });

  it('dispatches JSON to jsonParser', () => {
    const jsonFeed = JSON.stringify({
      metadata: { title: 'JSON Feed', identifier: 'json-1' },
      links: [],
      navigation: [{ href: '/popular', title: 'Popular' }],
    });

    const result = parseOPDS('application/opds+json', jsonFeed);
    expect(result.type).toBe('feed');
    expect(result.feed).toBeDefined();
    expect(result.feed!.title).toBe('JSON Feed');
    expect(result.feed!.feedType).toBe('navigation');
  });

  it('dispatches OpenSearch to openSearchParser', () => {
    const openSearch = `<?xml version="1.0" encoding="UTF-8"?>
<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">
  <ShortName>Test Search</ShortName>
  <Url type="application/atom+xml" template="https://example.com/search?q={searchTerms}"/>
</OpenSearchDescription>`;

    const result = parseOPDS('application/opensearchdescription+xml', openSearch);
    expect(result.type).toBe('opensearch');
    expect(result.search).toBeDefined();
    expect(result.search!.template).toContain('searchTerms');
    expect(result.search!.shortName).toBe('Test Search');
  });

  it('returns error for unknown format', () => {
    const result = parseOPDS('text/plain', 'not xml or json');
    expect(result.type).toBe('error');
    expect(result.error).toContain('Unable to detect OPDS format');
  });

  it('returns error for malformed XML', () => {
    const result = parseOPDS('application/atom+xml', '<feed><unclosed');
    expect(result.type).toBe('error');
  });

  it('returns error for malformed JSON', () => {
    const result = parseOPDS('application/json', '{not valid json}');
    expect(result.type).toBe('error');
    expect(result.error).toContain('JSON parse error');
  });

  it('returns error for invalid OpenSearch XML', () => {
    // Valid XML but no Url element
    const result = parseOPDS(
      'application/opensearchdescription+xml',
      `<?xml version="1.0"?><OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/"><ShortName>X</ShortName></OpenSearchDescription>`,
    );
    expect(result.type).toBe('error');
    expect(result.error).toContain('Url element');
  });

  it('classifies acquisition feeds from Atom', () => {
    const atomFeed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>acq-feed</id>
  <title>Books</title>
  <updated>2024-01-01T00:00:00Z</updated>
  <entry>
    <id>book-1</id>
    <title>Test Book</title>
    <link href="/book.epub" type="application/epub+zip" rel="http://opds-spec.org/acquisition/open-access"/>
  </entry>
</feed>`;

    const result = parseOPDS('application/atom+xml', atomFeed);
    expect(result.type).toBe('feed');
    expect(result.feed!.feedType).toBe('acquisition');
    expect(result.feed!.publications).toHaveLength(1);
  });

  it('classifies mixed feeds from JSON', () => {
    const jsonFeed = JSON.stringify({
      metadata: { title: 'Mixed', identifier: 'mix-1' },
      links: [],
      navigation: [{ href: '/popular', title: 'Popular' }],
      publications: [
        {
          metadata: { title: 'Book', identifier: 'book-1' },
          links: [
            {
              href: '/book.epub',
              rel: 'http://opds-spec.org/acquisition',
              type: 'application/epub+zip',
            },
          ],
        },
      ],
    });

    const result = parseOPDS('application/json', jsonFeed);
    expect(result.type).toBe('feed');
    expect(result.feed!.feedType).toBe('mixed');
  });

  it('logs warning for OpenSearch parse failures', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = parseOPDS(
      'application/opensearchdescription+xml',
      `<?xml version="1.0"?><OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/"></OpenSearchDescription>`,
    );

    expect(result.type).toBe('error');
    expect(warnSpy).toHaveBeenCalledWith(
      '[opds-parser] Failed to parse OpenSearch document',
      expect.any(Error),
    );

    warnSpy.mockRestore();
  });
});
