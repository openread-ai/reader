/**
 * OpenSearch description document parser.
 *
 * Parses OpenSearch XML description documents and provides
 * template expansion for search queries per the OpenSearch 1.1 URL template syntax.
 */

import type { OPDSSearchDescriptor, OPDSSearchParameter } from '../../types';
import { OPDS_MEDIA_TYPES } from '../../types';

/**
 * Parse an OpenSearch description document XML string.
 */
export function parseOpenSearch(xml: string): OPDSSearchDescriptor {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');

  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new Error(`OpenSearch XML parse error: ${parseError.textContent}`);
  }

  const root = doc.documentElement;
  const defaultNS = root.namespaceURI;
  const children = Array.from(root.children);

  const filter = defaultNS
    ? (name: string) => (el: Element) => el.namespaceURI === defaultNS && el.localName === name
    : (name: string) => (el: Element) => el.localName === name;

  // Find the best Url element: prefer OPDS catalog type, then Atom, then first available
  const urlElements = children.filter(filter('Url'));
  const bestUrl =
    urlElements.find((url) => isOPDSCatalogType(url.getAttribute('type') ?? '')) ??
    urlElements.find((url) => isAtomType(url.getAttribute('type') ?? '')) ??
    urlElements[0];

  if (!bestUrl) {
    throw new Error('OpenSearch document must contain at least one Url element');
  }

  const template = bestUrl.getAttribute('template') ?? '';
  const parameters = extractParameters(template, bestUrl, defaultNS);

  const shortName =
    children.find(filter('ShortName'))?.textContent ??
    children.find(filter('LongName'))?.textContent ??
    undefined;

  const description = children.find(filter('Description'))?.textContent ?? undefined;

  return {
    template,
    parameters,
    shortName: shortName ?? undefined,
    description: description ?? undefined,
  };
}

/**
 * Expand an OpenSearch template URL with the given search parameters.
 * Replaces {searchTerms}, {count}, {startIndex}, etc.
 */
export function expandSearchTemplate(template: string, params: Record<string, string>): string {
  // OpenSearch template variables: {prefix:name} or {name} or {name?}
  return template.replace(
    /\{(?:([^}]+?):)?(.+?)(\?)?\}/g,
    (_match, _prefix: string | undefined, paramName: string, optional: string | undefined) => {
      const value = params[paramName];
      if (value !== undefined && value !== '') {
        return encodeURIComponent(value);
      }
      // Use defaults for standard parameters
      const defaultValue = OPENSEARCH_DEFAULTS.get(paramName);
      if (defaultValue !== undefined) {
        return encodeURIComponent(defaultValue);
      }
      // Optional parameters can be empty
      if (optional) return '';
      return '';
    },
  );
}

/**
 * Detect content format from response headers and body.
 */
export function detectFormat(
  contentType: string,
  body: string,
): 'atom' | 'json' | 'opensearch' | 'unknown' {
  const ct = contentType.toLowerCase();

  if (ct.includes('opds+json') || ct.includes('application/json')) {
    return 'json';
  }

  if (ct.includes('opensearchdescription')) {
    return 'opensearch';
  }

  if (ct.includes('atom+xml') || ct.includes('application/xml') || ct.includes('text/xml')) {
    // Could be Atom feed or OpenSearch - check body
    const trimmed = body.trim();
    if (trimmed.startsWith('<') && trimmed.includes('OpenSearchDescription')) {
      return 'opensearch';
    }
    return 'atom';
  }

  // Fallback: sniff the body
  const trimmed = body.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return 'json';
  }
  if (trimmed.startsWith('<')) {
    if (trimmed.includes('OpenSearchDescription')) return 'opensearch';
    return 'atom';
  }

  return 'unknown';
}

// --- Internal helpers ---

const OPENSEARCH_DEFAULTS = new Map<string, string>([
  ['count', '100'],
  ['startIndex', '0'],
  ['startPage', '0'],
  ['language', '*'],
  ['inputEncoding', 'UTF-8'],
  ['outputEncoding', 'UTF-8'],
]);

function extractParameters(
  template: string,
  urlEl: Element,
  defaultNS: string | null,
): OPDSSearchParameter[] {
  const regex = /\{(?:([^}]+?):)?(.+?)(\?)?\}/g;
  const params: OPDSSearchParameter[] = [];

  for (const match of template.matchAll(regex)) {
    const [, prefix, name, optional] = match;
    const namespace = prefix ? urlEl.lookupNamespaceURI(prefix) : null;
    const ns = namespace === defaultNS ? null : namespace;

    params.push({
      name: name!,
      value: `{${prefix ? `${prefix}:` : ''}${name}${optional ?? ''}}`,
      required: !optional,
      ns,
    });
  }

  return params;
}

function isOPDSCatalogType(type: string): boolean {
  const lower = type.toLowerCase();
  return lower.includes('opds') || (lower.includes('atom') && lower.includes('opds-catalog'));
}

function isAtomType(type: string): boolean {
  return type.toLowerCase().includes(OPDS_MEDIA_TYPES.ATOM);
}
