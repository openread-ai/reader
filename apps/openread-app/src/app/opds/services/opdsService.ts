/**
 * OPDS Service Layer.
 *
 * Encapsulates all OPDS business logic in a framework-agnostic service.
 * Handles catalog browsing, feed navigation, search, downloads,
 * and error classification.
 */

import type {
  OPDSBrowseResult,
  OPDSError,
  OPDSFeed,
  OPDSLink,
  OPDSPublication,
  OPDSSearchDescriptor,
  OPDSValidationResult,
  OPDSAcquisitionOption,
} from '../types';
import {
  OPDS_REL,
  FORMAT_LABELS,
  ACQUISITION_LABELS,
  EBOOK_FORMAT_PRIORITY,
  OPDS_TIMEOUTS,
} from '../types';
import { opdsFetch, type OPDSAuthCredentials } from './opdsHttp';
import { parseOPDS, expandSearchTemplate, parseOpenSearch } from './parsers';
import type { SecureCredentialStore } from './credentialStore';
import { createLogger } from '@/utils/logger';

const logger = createLogger('opds-service');

/**
 * Configuration for the OPDS service.
 */
export interface OPDSServiceConfig {
  credentialStore: SecureCredentialStore;
}

/**
 * Main OPDS service class. Framework-agnostic - no React dependencies.
 */
export class OPDSService {
  private credentials: SecureCredentialStore;

  constructor(config: OPDSServiceConfig) {
    this.credentials = config.credentialStore;
  }

  /**
   * Browse a catalog or feed URL.
   */
  async browse(url: string, catalogId?: string): Promise<OPDSBrowseResult> {
    try {
      const auth = catalogId ? await this.credentials.get(catalogId) : null;
      const response = await opdsFetch(url, { auth });

      if (!response.ok) {
        return {
          success: false,
          error: this.httpErrorToOPDSError(response.status, response.statusText),
          responseUrl: response.url || url,
        };
      }

      const contentType = response.headers.get('content-type') ?? '';
      const text = await response.text();
      const result = parseOPDS(contentType, text);

      if (result.type === 'error') {
        return {
          success: false,
          error: { code: 'PARSE_ERROR', message: result.error ?? 'Failed to parse feed' },
          responseUrl: response.url || url,
        };
      }

      if (result.type === 'opensearch' && result.search) {
        return {
          success: true,
          search: result.search,
          responseUrl: response.url || url,
        };
      }

      // Resolve relative URLs in feed links
      const responseUrl = response.url || url;
      if (result.feed) {
        this.resolveRelativeUrls(result.feed, responseUrl);
      }

      return {
        success: true,
        feed: result.feed,
        publication: result.publication,
        search: result.feed ? this.extractSearchFromFeed(result.feed) : undefined,
        responseUrl,
      };
    } catch (error) {
      logger.warn('Browse failed for URL', { url, error });
      return {
        success: false,
        error: this.toOPDSError(error),
        responseUrl: url,
      };
    }
  }

  /**
   * Navigate to a link within a feed, resolving relative URLs.
   */
  async navigate(link: OPDSLink, baseUrl: string, catalogId?: string): Promise<OPDSBrowseResult> {
    const resolvedUrl = this.resolveUrl(link.href, baseUrl);
    return this.browse(resolvedUrl, catalogId);
  }

  /**
   * Perform a search using an OpenSearch descriptor.
   */
  async search(
    searchDescriptor: OPDSSearchDescriptor,
    query: string,
    catalogId?: string,
  ): Promise<OPDSBrowseResult> {
    const searchUrl = expandSearchTemplate(searchDescriptor.template, {
      searchTerms: query,
      q: query,
    });
    return this.browse(searchUrl, catalogId);
  }

  /**
   * Fetch and parse an OpenSearch description document.
   */
  async fetchOpenSearch(url: string, catalogId?: string): Promise<OPDSSearchDescriptor> {
    try {
      const auth = catalogId ? await this.credentials.get(catalogId) : null;
      const response = await opdsFetch(url, { auth, timeout: OPDS_TIMEOUTS.SEARCH });

      if (!response.ok) {
        throw new Error(`Failed to fetch OpenSearch descriptor: ${response.status}`);
      }

      const text = await response.text();
      return parseOpenSearch(text);
    } catch (error) {
      logger.warn('fetchOpenSearch failed for URL', { url, error });
      throw error;
    }
  }

  /**
   * Get acquisition options for a publication, sorted by preference.
   */
  getAcquisitionOptions(publication: OPDSPublication): OPDSAcquisitionOption[] {
    const options: OPDSAcquisitionOption[] = [];

    for (const link of publication.acquisitionLinks) {
      const type = this.getAcquisitionType(link.rel);
      const format = this.getFormatLabel(link.type);

      options.push({
        type,
        link,
        format,
        price: link.price,
        label: this.getAcquisitionLabel(type, format, link.price),
      });
    }

    // Sort: open-access first, then by format preference
    return options.sort((a, b) => {
      const typePriority =
        this.acquisitionTypePriority(a.type) - this.acquisitionTypePriority(b.type);
      if (typePriority !== 0) return typePriority;
      return this.formatPriority(a.link.type) - this.formatPriority(b.link.type);
    });
  }

  /**
   * Validate an OPDS catalog URL.
   */
  async validateCatalog(
    url: string,
    auth?: OPDSAuthCredentials | null,
  ): Promise<OPDSValidationResult> {
    try {
      const response = await opdsFetch(url, {
        auth,
        timeout: OPDS_TIMEOUTS.VALIDATION,
      });

      if (response.status === 401 || response.status === 403) {
        return { valid: false, requiresAuth: true, error: 'Authentication required' };
      }

      if (!response.ok) {
        return {
          valid: false,
          requiresAuth: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      const contentType = response.headers.get('content-type') ?? '';
      const text = await response.text();
      const result = parseOPDS(contentType, text);

      if (result.type === 'error') {
        return { valid: false, requiresAuth: false, error: result.error };
      }

      return {
        valid: true,
        requiresAuth: false,
        feedType: result.feed?.feedType,
      };
    } catch (error) {
      logger.warn('Catalog validation failed for URL', { url, error });
      return {
        valid: false,
        requiresAuth: false,
        error: error instanceof Error ? error.message : 'Validation failed',
      };
    }
  }

  // --- Private helpers ---

  private extractSearchFromFeed(feed: OPDSFeed): OPDSSearchDescriptor | undefined {
    // Check for inline search descriptor
    if (feed.search) return feed.search;

    // Check for search link that's a template
    const searchLink = feed.links.find(
      (l) => l.rel === 'search' && l.href.includes('{searchTerms}'),
    );
    if (searchLink) {
      return {
        template: searchLink.href,
        parameters: [{ name: 'searchTerms', value: '{searchTerms}', required: true }],
        shortName: searchLink.title,
      };
    }

    return undefined;
  }

  private resolveRelativeUrls(feed: OPDSFeed, baseUrl: string): void {
    for (const link of feed.links) {
      link.href = this.resolveUrl(link.href, baseUrl);
    }
    for (const nav of feed.navigation) {
      nav.href = this.resolveUrl(nav.href, baseUrl);
    }
    for (const pub of feed.publications) {
      for (const link of pub.links) {
        link.href = this.resolveUrl(link.href, baseUrl);
      }
      for (const link of pub.acquisitionLinks) {
        link.href = this.resolveUrl(link.href, baseUrl);
      }
      for (const img of pub.images) {
        img.href = this.resolveUrl(img.href, baseUrl);
      }
    }
    for (const group of feed.groups) {
      for (const link of group.links) {
        link.href = this.resolveUrl(link.href, baseUrl);
      }
    }
    if (feed.pagination) {
      if (feed.pagination.first)
        feed.pagination.first = this.resolveUrl(feed.pagination.first, baseUrl);
      if (feed.pagination.previous)
        feed.pagination.previous = this.resolveUrl(feed.pagination.previous, baseUrl);
      if (feed.pagination.next)
        feed.pagination.next = this.resolveUrl(feed.pagination.next, baseUrl);
      if (feed.pagination.last)
        feed.pagination.last = this.resolveUrl(feed.pagination.last, baseUrl);
    }
  }

  private resolveUrl(url: string, base: string): string {
    if (!url) return '';
    // Already absolute
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    try {
      // Handle proxied base URLs
      if (base.includes('/api/opds/proxy?url=')) {
        const params = new URLSearchParams(base.split('?')[1]);
        const proxiedBase = params.get('url') ?? '';
        return new URL(url, proxiedBase).toString();
      }
      return new URL(url, base).toString();
    } catch (e) {
      logger.warn('Failed to resolve relative URL', { url, error: e });
      return url;
    }
  }

  private getAcquisitionType(rel?: string): OPDSAcquisitionOption['type'] {
    switch (rel) {
      case OPDS_REL.ACQUISITION_OPEN_ACCESS:
        return 'open-access';
      case OPDS_REL.ACQUISITION_BORROW:
        return 'borrow';
      case OPDS_REL.ACQUISITION_BUY:
        return 'buy';
      case OPDS_REL.ACQUISITION_SAMPLE:
        return 'sample';
      case OPDS_REL.ACQUISITION_SUBSCRIBE:
        return 'subscribe';
      default:
        return 'generic';
    }
  }

  private acquisitionTypePriority(type: OPDSAcquisitionOption['type']): number {
    const priorities: Record<OPDSAcquisitionOption['type'], number> = {
      'open-access': 0,
      generic: 1,
      borrow: 2,
      sample: 3,
      buy: 4,
      subscribe: 5,
    };
    return priorities[type];
  }

  private getFormatLabel(mimeType?: string): string {
    if (!mimeType) return 'Unknown';
    return FORMAT_LABELS[mimeType] ?? mimeType.split('/').pop()?.toUpperCase() ?? 'Unknown';
  }

  private formatPriority(mimeType?: string): number {
    if (!mimeType) return 999;
    const idx = EBOOK_FORMAT_PRIORITY.indexOf(mimeType);
    return idx >= 0 ? idx : 999;
  }

  private getAcquisitionLabel(
    type: OPDSAcquisitionOption['type'],
    format: string,
    price?: { value: number; currency: string },
  ): string {
    const rel = {
      'open-access': OPDS_REL.ACQUISITION_OPEN_ACCESS,
      borrow: OPDS_REL.ACQUISITION_BORROW,
      buy: OPDS_REL.ACQUISITION_BUY,
      sample: OPDS_REL.ACQUISITION_SAMPLE,
      subscribe: OPDS_REL.ACQUISITION_SUBSCRIBE,
      generic: OPDS_REL.ACQUISITION,
    }[type];

    const baseLabel = ACQUISITION_LABELS[rel] ?? 'Download';

    if (price) {
      const formatted = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: price.currency,
      }).format(price.value);
      return `${baseLabel} ${format} - ${formatted}`;
    }

    return `${baseLabel} ${format}`;
  }

  private httpErrorToOPDSError(status: number, statusText: string): OPDSError {
    if (status === 401 || status === 403) {
      return { code: 'AUTH_REQUIRED', message: 'Authentication required' };
    }
    if (status === 404) {
      return { code: 'NOT_FOUND', message: 'Feed not found' };
    }
    return { code: 'NETWORK_ERROR', message: `HTTP ${status}: ${statusText}` };
  }

  private toOPDSError(error: unknown): OPDSError {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        return { code: 'TIMEOUT', message: 'Request timed out', cause: error };
      }
      return { code: 'NETWORK_ERROR', message: error.message, cause: error };
    }
    return { code: 'UNKNOWN', message: String(error), cause: error };
  }
}
