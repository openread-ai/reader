import { describe, it, expect } from 'vitest';
import {
  parseOpenSearch,
  expandSearchTemplate,
  detectFormat,
} from '@/app/opds/services/parsers/openSearchParser';

describe('OpenSearchParser', () => {
  const OPENSEARCH_XML = `<?xml version="1.0" encoding="UTF-8"?>
<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">
  <ShortName>Test Catalog</ShortName>
  <Description>Search for ebooks in the test catalog</Description>
  <Url type="application/atom+xml;profile=opds-catalog"
       template="https://example.com/search?q={searchTerms}&amp;count={count?}&amp;start={startIndex?}"/>
  <Url type="text/html"
       template="https://example.com/search.html?q={searchTerms}"/>
</OpenSearchDescription>`;

  describe('parseOpenSearch', () => {
    it('parses OpenSearch description document', () => {
      const result = parseOpenSearch(OPENSEARCH_XML);

      expect(result.shortName).toBe('Test Catalog');
      expect(result.description).toBe('Search for ebooks in the test catalog');
      expect(result.template).toContain('{searchTerms}');
    });

    it('prefers OPDS catalog URL over HTML URL', () => {
      const result = parseOpenSearch(OPENSEARCH_XML);
      expect(result.template).toContain('example.com/search?q=');
    });

    it('extracts search parameters', () => {
      const result = parseOpenSearch(OPENSEARCH_XML);

      expect(result.parameters.length).toBe(3);
      const searchTerms = result.parameters.find((p) => p.name === 'searchTerms');
      expect(searchTerms).toBeDefined();
      expect(searchTerms!.required).toBe(true);

      const count = result.parameters.find((p) => p.name === 'count');
      expect(count).toBeDefined();
      expect(count!.required).toBe(false);
    });

    it('throws on missing Url element', () => {
      const xml = `<?xml version="1.0"?>
<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">
  <ShortName>Empty</ShortName>
</OpenSearchDescription>`;
      expect(() => parseOpenSearch(xml)).toThrow('must contain at least one Url element');
    });

    it('throws on invalid XML', () => {
      expect(() => parseOpenSearch('not xml')).toThrow();
    });
  });

  describe('expandSearchTemplate', () => {
    it('replaces searchTerms in template', () => {
      const template = 'https://example.com/search?q={searchTerms}';
      const result = expandSearchTemplate(template, { searchTerms: 'pride prejudice' });
      expect(result).toBe('https://example.com/search?q=pride%20prejudice');
    });

    it('handles multiple parameters', () => {
      const template =
        'https://example.com/search?q={searchTerms}&count={count}&start={startIndex}';
      const result = expandSearchTemplate(template, { searchTerms: 'test', count: '10' });
      expect(result).toContain('q=test');
      expect(result).toContain('count=10');
    });

    it('uses default values for standard parameters', () => {
      const template = 'https://example.com/search?q={searchTerms}&count={count}';
      const result = expandSearchTemplate(template, { searchTerms: 'test' });
      expect(result).toContain('count=100'); // default count
    });

    it('encodes special characters', () => {
      const template = 'https://example.com/search?q={searchTerms}';
      const result = expandSearchTemplate(template, { searchTerms: 'hello world & more' });
      expect(result).toContain('hello%20world%20%26%20more');
    });

    it('handles optional parameters with ? marker', () => {
      const template = 'https://example.com/search?q={searchTerms}&lang={language?}';
      const result = expandSearchTemplate(template, { searchTerms: 'test' });
      expect(result).toContain('q=test');
    });
  });

  describe('detectFormat', () => {
    it('detects Atom XML from content type', () => {
      expect(detectFormat('application/atom+xml', '<feed>')).toBe('atom');
      expect(detectFormat('application/atom+xml;profile=opds-catalog', '<feed>')).toBe('atom');
    });

    it('detects OPDS 2.0 JSON from content type', () => {
      expect(detectFormat('application/opds+json', '{"metadata":{}}')).toBe('json');
      expect(detectFormat('application/json', '{"metadata":{}}')).toBe('json');
    });

    it('detects OpenSearch from content type', () => {
      expect(detectFormat('application/opensearchdescription+xml', '<OpenSearchDescription>')).toBe(
        'opensearch',
      );
    });

    it('sniffs XML content from body', () => {
      expect(detectFormat('text/xml', '<feed xmlns="http://www.w3.org/2005/Atom">')).toBe('atom');
    });

    it('sniffs OpenSearch from body', () => {
      expect(detectFormat('application/xml', '<OpenSearchDescription>')).toBe('opensearch');
    });

    it('returns unknown for unrecognizable content', () => {
      expect(detectFormat('text/plain', 'Hello World')).toBe('unknown');
    });
  });
});
