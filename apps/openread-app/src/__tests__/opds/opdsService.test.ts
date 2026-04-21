import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OPDSService } from '@/app/opds/services/opdsService';
import type { SecureCredentialStore } from '@/app/opds/services/credentialStore';
import type { OPDSFeed, OPDSPublication } from '@/app/opds/types';
import { OPDS_REL } from '@/app/opds/types';

// Mock opdsHttp
vi.mock('@/app/opds/services/opdsHttp', () => ({
  opdsFetch: vi.fn(),
}));

// Mock parsers
vi.mock('@/app/opds/services/parsers', () => ({
  parseOPDS: vi.fn(),
  expandSearchTemplate: vi.fn(),
  parseOpenSearch: vi.fn(),
}));

import { opdsFetch } from '@/app/opds/services/opdsHttp';
import { parseOPDS, expandSearchTemplate } from '@/app/opds/services/parsers';

function createMockCredentialStore(): SecureCredentialStore {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    has: vi.fn().mockResolvedValue(false),
  };
}

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

function createMockResponse(options: {
  ok?: boolean;
  status?: number;
  statusText?: string;
  contentType?: string;
  body?: string;
  url?: string;
}) {
  const {
    ok = true,
    status = 200,
    statusText = 'OK',
    contentType = 'application/atom+xml',
    body = '',
    url = '',
  } = options;
  return {
    ok,
    status,
    statusText,
    url,
    headers: {
      get: vi.fn((name: string) => {
        if (name === 'content-type') return contentType;
        return null;
      }),
    },
    text: vi.fn().mockResolvedValue(body),
  };
}

describe('OPDSService', () => {
  let service: OPDSService;
  let credentialStore: SecureCredentialStore;

  beforeEach(() => {
    vi.clearAllMocks();
    credentialStore = createMockCredentialStore();
    service = new OPDSService({ credentialStore });
  });

  describe('browse', () => {
    it('should return parsed feed on success', async () => {
      const mockFeed = createMockFeed({ title: 'Test Catalog' });
      vi.mocked(opdsFetch).mockResolvedValue(
        createMockResponse({
          body: '<feed/>',
          url: 'https://example.com/opds',
        }) as never,
      );
      vi.mocked(parseOPDS).mockReturnValue({
        type: 'feed',
        feed: mockFeed,
      });

      const result = await service.browse('https://example.com/opds');

      expect(result.success).toBe(true);
      expect(result.feed).toBeDefined();
      expect(result.feed!.title).toBe('Test Catalog');
    });

    it('should pass credentials when catalogId is provided', async () => {
      const mockCreds = { username: 'user', password: 'pass' };
      vi.mocked(credentialStore.get).mockResolvedValue(mockCreds);
      vi.mocked(opdsFetch).mockResolvedValue(
        createMockResponse({
          body: '<feed/>',
          url: 'https://example.com/opds',
        }) as never,
      );
      vi.mocked(parseOPDS).mockReturnValue({
        type: 'feed',
        feed: createMockFeed(),
      });

      await service.browse('https://example.com/opds', 'catalog-1');

      expect(credentialStore.get).toHaveBeenCalledWith('catalog-1');
      expect(opdsFetch).toHaveBeenCalledWith('https://example.com/opds', { auth: mockCreds });
    });

    it('should return error on HTTP failure', async () => {
      vi.mocked(opdsFetch).mockResolvedValue(
        createMockResponse({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          url: 'https://example.com/missing',
        }) as never,
      );

      const result = await service.browse('https://example.com/missing');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NOT_FOUND');
    });

    it('should return AUTH_REQUIRED on 401', async () => {
      vi.mocked(opdsFetch).mockResolvedValue(
        createMockResponse({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          url: 'https://example.com/private',
        }) as never,
      );

      const result = await service.browse('https://example.com/private');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('AUTH_REQUIRED');
    });

    it('should return parse error when parsing fails', async () => {
      vi.mocked(opdsFetch).mockResolvedValue(
        createMockResponse({
          body: 'not xml',
          contentType: 'text/html',
          url: 'https://example.com/bad',
        }) as never,
      );
      vi.mocked(parseOPDS).mockReturnValue({
        type: 'error',
        error: 'Unable to detect OPDS format',
      });

      const result = await service.browse('https://example.com/bad');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PARSE_ERROR');
    });

    it('should handle network errors', async () => {
      vi.mocked(opdsFetch).mockRejectedValue(new Error('Network failure'));

      const result = await service.browse('https://example.com/down');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NETWORK_ERROR');
      expect(result.error?.message).toBe('Network failure');
    });

    it('should handle timeout errors', async () => {
      const timeoutError = new Error('Timeout');
      timeoutError.name = 'AbortError';
      vi.mocked(opdsFetch).mockRejectedValue(timeoutError);

      const result = await service.browse('https://example.com/slow');

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('TIMEOUT');
    });

    it('should handle opensearch results', async () => {
      const searchDescriptor = {
        template: 'https://example.com/search?q={searchTerms}',
        parameters: [{ name: 'searchTerms', value: '{searchTerms}', required: true }],
      };
      vi.mocked(opdsFetch).mockResolvedValue(
        createMockResponse({
          body: '<OpenSearchDescription/>',
          contentType: 'application/opensearchdescription+xml',
          url: 'https://example.com/search',
        }) as never,
      );
      vi.mocked(parseOPDS).mockReturnValue({
        type: 'opensearch',
        search: searchDescriptor,
      });

      const result = await service.browse('https://example.com/search');

      expect(result.success).toBe(true);
      expect(result.search).toBeDefined();
      expect(result.search!.template).toContain('searchTerms');
    });

    it('should resolve relative URLs in feed', async () => {
      const mockFeed = createMockFeed({
        links: [{ href: '/next', rel: 'next', type: 'application/atom+xml' }],
        navigation: [
          {
            id: 'popular',
            href: '/popular',
            title: 'Popular',
            rel: 'subsection',
            type: 'application/atom+xml',
          },
        ],
        publications: [],
      });
      vi.mocked(opdsFetch).mockResolvedValue(
        createMockResponse({
          body: '<feed/>',
          url: 'https://example.com/opds/',
        }) as never,
      );
      vi.mocked(parseOPDS).mockReturnValue({
        type: 'feed',
        feed: mockFeed,
      });

      const result = await service.browse('https://example.com/opds/');

      expect(result.success).toBe(true);
      expect(result.feed!.links[0]!.href).toBe('https://example.com/next');
      expect(result.feed!.navigation[0]!.href).toBe('https://example.com/popular');
    });
  });

  describe('navigate', () => {
    it('should resolve link href and browse', async () => {
      vi.mocked(opdsFetch).mockResolvedValue(
        createMockResponse({
          body: '<feed/>',
          url: 'https://example.com/popular',
        }) as never,
      );
      vi.mocked(parseOPDS).mockReturnValue({
        type: 'feed',
        feed: createMockFeed({ title: 'Popular' }),
      });

      const result = await service.navigate(
        { href: '/popular', rel: 'subsection', type: 'application/atom+xml' },
        'https://example.com/opds/',
      );

      expect(result.success).toBe(true);
      expect(opdsFetch).toHaveBeenCalledWith('https://example.com/popular', { auth: null });
    });
  });

  describe('search', () => {
    it('should expand template and browse', async () => {
      vi.mocked(expandSearchTemplate).mockReturnValue('https://example.com/search?q=test');
      vi.mocked(opdsFetch).mockResolvedValue(
        createMockResponse({
          body: '<feed/>',
          url: 'https://example.com/search?q=test',
        }) as never,
      );
      vi.mocked(parseOPDS).mockReturnValue({
        type: 'feed',
        feed: createMockFeed({ title: 'Search Results' }),
      });

      const result = await service.search(
        {
          template: 'https://example.com/search?q={searchTerms}',
          parameters: [{ name: 'searchTerms', value: '{searchTerms}', required: true }],
        },
        'test',
      );

      expect(result.success).toBe(true);
      expect(expandSearchTemplate).toHaveBeenCalledWith(
        'https://example.com/search?q={searchTerms}',
        { searchTerms: 'test', q: 'test' },
      );
    });
  });

  describe('getAcquisitionOptions', () => {
    it('should sort options with open-access first', () => {
      const publication: OPDSPublication = {
        id: 'pub-1',
        title: 'Test Book',
        authors: [],
        contributors: [],
        links: [],
        acquisitionLinks: [
          {
            href: '/buy',
            rel: OPDS_REL.ACQUISITION_BUY,
            type: 'application/epub+zip',
            price: { value: 9.99, currency: 'USD' },
          },
          { href: '/free', rel: OPDS_REL.ACQUISITION_OPEN_ACCESS, type: 'application/epub+zip' },
          { href: '/borrow', rel: OPDS_REL.ACQUISITION_BORROW, type: 'application/epub+zip' },
        ],
        images: [],
        identifiers: [],
        subjects: [],
      };

      const options = service.getAcquisitionOptions(publication);

      expect(options).toHaveLength(3);
      expect(options[0]!.type).toBe('open-access');
      expect(options[1]!.type).toBe('borrow');
      expect(options[2]!.type).toBe('buy');
    });

    it('should format price labels', () => {
      const publication: OPDSPublication = {
        id: 'pub-1',
        title: 'Paid Book',
        authors: [],
        contributors: [],
        links: [],
        acquisitionLinks: [
          {
            href: '/buy',
            rel: OPDS_REL.ACQUISITION_BUY,
            type: 'application/epub+zip',
            price: { value: 12.99, currency: 'USD' },
          },
        ],
        images: [],
        identifiers: [],
        subjects: [],
      };

      const options = service.getAcquisitionOptions(publication);

      expect(options).toHaveLength(1);
      expect(options[0]!.label).toContain('$12.99');
      expect(options[0]!.format).toBe('EPUB');
    });

    it('should return empty array for publications with no acquisition links', () => {
      const publication: OPDSPublication = {
        id: 'pub-1',
        title: 'No Downloads',
        authors: [],
        contributors: [],
        links: [],
        acquisitionLinks: [],
        images: [],
        identifiers: [],
        subjects: [],
      };

      const options = service.getAcquisitionOptions(publication);
      expect(options).toHaveLength(0);
    });
  });

  describe('validateCatalog', () => {
    it('should return valid for a navigation feed', async () => {
      vi.mocked(opdsFetch).mockResolvedValue(
        createMockResponse({
          body: '<feed/>',
          url: 'https://example.com/opds',
        }) as never,
      );
      vi.mocked(parseOPDS).mockReturnValue({
        type: 'feed',
        feed: createMockFeed({
          navigation: [
            {
              id: 'popular',
              href: '/popular',
              title: 'Popular',
              rel: 'subsection',
              type: 'application/atom+xml',
            },
          ],
          publications: [],
        }),
      });

      const result = await service.validateCatalog('https://example.com/opds');

      expect(result.valid).toBe(true);
      expect(result.feedType).toBe('navigation');
    });

    it('should return valid for an acquisition feed', async () => {
      vi.mocked(opdsFetch).mockResolvedValue(
        createMockResponse({
          body: '<feed/>',
          url: 'https://example.com/opds',
        }) as never,
      );
      vi.mocked(parseOPDS).mockReturnValue({
        type: 'feed',
        feed: createMockFeed({
          navigation: [],
          publications: [
            {
              id: 'pub-1',
              title: 'Book',
              authors: [],
              contributors: [],
              links: [],
              acquisitionLinks: [
                {
                  href: '/dl',
                  rel: OPDS_REL.ACQUISITION_OPEN_ACCESS,
                  type: 'application/epub+zip',
                },
              ],
              images: [],
              identifiers: [],
              subjects: [],
            },
          ],
          feedType: 'acquisition',
        }),
      });

      const result = await service.validateCatalog('https://example.com/opds');

      expect(result.valid).toBe(true);
      expect(result.feedType).toBe('acquisition');
    });

    it('should detect auth required', async () => {
      vi.mocked(opdsFetch).mockResolvedValue(
        createMockResponse({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          url: 'https://example.com/private',
        }) as never,
      );

      const result = await service.validateCatalog('https://example.com/private');

      expect(result.valid).toBe(false);
      expect(result.requiresAuth).toBe(true);
    });

    it('should handle validation errors gracefully', async () => {
      vi.mocked(opdsFetch).mockRejectedValue(new Error('DNS lookup failed'));

      const result = await service.validateCatalog('https://bad-host.example.com/opds');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('DNS lookup failed');
    });
  });

  describe('fetchOpenSearch', () => {
    it('should parse OpenSearch descriptor on success', async () => {
      vi.mocked(opdsFetch).mockResolvedValue(
        createMockResponse({
          body: '<OpenSearchDescription/>',
          contentType: 'application/opensearchdescription+xml',
          url: 'https://example.com/search.xml',
        }) as never,
      );
      const mockDescriptor = {
        template: 'https://example.com/search?q={searchTerms}',
        parameters: [{ name: 'searchTerms', value: '{searchTerms}', required: true }],
      };
      const { parseOpenSearch } = await import('@/app/opds/services/parsers');
      vi.mocked(parseOpenSearch).mockReturnValue(mockDescriptor);

      const result = await service.fetchOpenSearch('https://example.com/search.xml');

      expect(result.template).toContain('searchTerms');
    });

    it('should throw on HTTP failure', async () => {
      vi.mocked(opdsFetch).mockResolvedValue(
        createMockResponse({
          ok: false,
          status: 500,
          statusText: 'Server Error',
          url: 'https://example.com/search.xml',
        }) as never,
      );

      await expect(service.fetchOpenSearch('https://example.com/search.xml')).rejects.toThrow(
        'Failed to fetch OpenSearch descriptor: 500',
      );
    });

    it('should log and re-throw on network error', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.mocked(opdsFetch).mockRejectedValue(new Error('Network failure'));

      await expect(service.fetchOpenSearch('https://example.com/search.xml')).rejects.toThrow(
        'Network failure',
      );

      expect(warnSpy).toHaveBeenCalledWith('[opds-service] fetchOpenSearch failed for URL', {
        url: 'https://example.com/search.xml',
        error: expect.any(Error),
      });
      warnSpy.mockRestore();
    });

    it('should pass credentials when catalogId is provided', async () => {
      const mockCreds = { username: 'user', password: 'pass' };
      vi.mocked(credentialStore.get).mockResolvedValue(mockCreds);
      vi.mocked(opdsFetch).mockResolvedValue(
        createMockResponse({
          body: '<OpenSearchDescription/>',
          url: 'https://example.com/search.xml',
        }) as never,
      );
      const { parseOpenSearch } = await import('@/app/opds/services/parsers');
      vi.mocked(parseOpenSearch).mockReturnValue({
        template: 'https://example.com/search?q={searchTerms}',
        parameters: [],
      });

      await service.fetchOpenSearch('https://example.com/search.xml', 'catalog-1');

      expect(credentialStore.get).toHaveBeenCalledWith('catalog-1');
      expect(opdsFetch).toHaveBeenCalledWith(
        'https://example.com/search.xml',
        expect.objectContaining({ auth: mockCreds }),
      );
    });
  });

  describe('resolveRelativeUrls (via browse)', () => {
    it('should resolve relative publication links', async () => {
      const mockFeed = createMockFeed({
        publications: [
          {
            id: 'pub-1',
            title: 'Book',
            authors: [],
            contributors: [],
            links: [{ href: '/details', rel: 'alternate' }],
            acquisitionLinks: [
              {
                href: '/download/book.epub',
                rel: 'http://opds-spec.org/acquisition/open-access',
                type: 'application/epub+zip',
              },
            ],
            images: [{ href: '/covers/book.jpg', rel: 'http://opds-spec.org/image' }],
            identifiers: [],
            subjects: [],
          },
        ],
        feedType: 'acquisition',
      });
      vi.mocked(opdsFetch).mockResolvedValue(
        createMockResponse({
          body: '<feed/>',
          url: 'https://example.com/opds/catalog/',
        }) as never,
      );
      vi.mocked(parseOPDS).mockReturnValue({
        type: 'feed',
        feed: mockFeed,
      });

      const result = await service.browse('https://example.com/opds/catalog/');

      expect(result.success).toBe(true);
      const pub = result.feed!.publications[0]!;
      expect(pub.links[0]!.href).toBe('https://example.com/details');
      expect(pub.acquisitionLinks[0]!.href).toBe('https://example.com/download/book.epub');
      expect(pub.images[0]!.href).toBe('https://example.com/covers/book.jpg');
    });

    it('should resolve pagination links', async () => {
      const mockFeed = createMockFeed({
        pagination: {
          next: '/page/2',
          previous: '/page/0',
          first: '/page/1',
          last: '/page/10',
        },
      });
      vi.mocked(opdsFetch).mockResolvedValue(
        createMockResponse({
          body: '<feed/>',
          url: 'https://example.com/opds/',
        }) as never,
      );
      vi.mocked(parseOPDS).mockReturnValue({
        type: 'feed',
        feed: mockFeed,
      });

      const result = await service.browse('https://example.com/opds/');

      expect(result.success).toBe(true);
      expect(result.feed!.pagination!.next).toBe('https://example.com/page/2');
      expect(result.feed!.pagination!.previous).toBe('https://example.com/page/0');
      expect(result.feed!.pagination!.first).toBe('https://example.com/page/1');
      expect(result.feed!.pagination!.last).toBe('https://example.com/page/10');
    });

    it('should not modify already-absolute URLs', async () => {
      const mockFeed = createMockFeed({
        links: [{ href: 'https://other.com/feed', rel: 'alternate', type: 'application/atom+xml' }],
      });
      vi.mocked(opdsFetch).mockResolvedValue(
        createMockResponse({
          body: '<feed/>',
          url: 'https://example.com/opds/',
        }) as never,
      );
      vi.mocked(parseOPDS).mockReturnValue({
        type: 'feed',
        feed: mockFeed,
      });

      const result = await service.browse('https://example.com/opds/');

      expect(result.feed!.links[0]!.href).toBe('https://other.com/feed');
    });

    it('should resolve group links', async () => {
      const mockFeed = createMockFeed({
        groups: [
          {
            title: 'Group 1',
            links: [{ href: '/group/1', rel: 'self' }],
            publications: [],
            navigation: [],
          },
        ],
      });
      vi.mocked(opdsFetch).mockResolvedValue(
        createMockResponse({
          body: '<feed/>',
          url: 'https://example.com/opds/',
        }) as never,
      );
      vi.mocked(parseOPDS).mockReturnValue({
        type: 'feed',
        feed: mockFeed,
      });

      const result = await service.browse('https://example.com/opds/');

      expect(result.feed!.groups[0]!.links[0]!.href).toBe('https://example.com/group/1');
    });
  });
});
