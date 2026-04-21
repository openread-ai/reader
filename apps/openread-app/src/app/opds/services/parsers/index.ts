/**
 * OPDS parser factory and exports.
 *
 * Provides a unified parsing interface that auto-detects feed format
 * and delegates to the appropriate parser.
 */

import type { OPDSFeed, OPDSPublication, OPDSSearchDescriptor } from '../../types';
import { parseAtom } from './atomParser';
import { parseJson } from './jsonParser';
import { parseOpenSearch, detectFormat } from './openSearchParser';
import { createLogger } from '@/utils/logger';

export { parseAtom } from './atomParser';
export { parseJson } from './jsonParser';
export { parseOpenSearch, expandSearchTemplate, detectFormat } from './openSearchParser';

const logger = createLogger('opds-parser');

/**
 * Result of parsing any OPDS content.
 */
export interface OPDSParseResult {
  type: 'feed' | 'publication' | 'opensearch' | 'error';
  feed?: OPDSFeed;
  publication?: OPDSPublication;
  search?: OPDSSearchDescriptor;
  error?: string;
}

/**
 * Parse OPDS content, auto-detecting the format from content type and body.
 */
export function parseOPDS(contentType: string, body: string): OPDSParseResult {
  const format = detectFormat(contentType, body);

  switch (format) {
    case 'atom': {
      const result = parseAtom(body);
      return result;
    }
    case 'json': {
      const result = parseJson(body);
      return result;
    }
    case 'opensearch': {
      try {
        const search = parseOpenSearch(body);
        return { type: 'opensearch', search };
      } catch (error) {
        logger.warn('Failed to parse OpenSearch document', error);
        return {
          type: 'error',
          error: error instanceof Error ? error.message : 'Failed to parse OpenSearch document',
        };
      }
    }
    default:
      return {
        type: 'error',
        error: `Unable to detect OPDS format from content type: ${contentType}`,
      };
  }
}
