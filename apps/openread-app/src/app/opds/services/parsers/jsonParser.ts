/**
 * OPDS 2.0 JSON feed parser.
 *
 * Parses OPDS 2.0 JSON feeds into the canonical OPDSFeed domain model.
 * OPDS 2.0 is based on the Readium Web Publication Manifest format.
 */

import type {
  OPDSAcquisitionLink,
  OPDSFacetGroup,
  OPDSFeed,
  OPDSGroup,
  OPDSIdentifier,
  OPDSImage,
  OPDSLink,
  OPDSNavigationEntry,
  OPDSPagination,
  OPDSPerson,
  OPDSPublication,
  OPDSSearchDescriptor,
  OPDSSubject,
} from '../../types';
import { classifyFeedType } from '../../types';

interface JsonParseResult {
  type: 'feed' | 'publication' | 'error';
  feed?: OPDSFeed;
  publication?: OPDSPublication;
  error?: string;
}

/**
 * Parse an OPDS 2.0 JSON string into the canonical domain model.
 */
export function parseJson(json: string): JsonParseResult {
  try {
    const data = JSON.parse(json);

    // OPDS 2.0 feed: has metadata + (publications, navigation, or groups)
    if (data.metadata && (data.publications || data.navigation || data.groups)) {
      return {
        type: 'feed',
        feed: parseFeed(data),
      };
    }

    // Single publication: has metadata + links but no feed-level collections
    if (data.metadata && data.links) {
      return {
        type: 'publication',
        publication: parsePublication(data),
      };
    }

    return { type: 'error', error: 'Unrecognized OPDS 2.0 JSON format' };
  } catch (error) {
    return {
      type: 'error',
      error: `JSON parse error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function parseFeed(data: Record<string, unknown>): OPDSFeed {
  const metadata = (data.metadata ?? {}) as Record<string, unknown>;
  const rawLinks = asArray(data.links);
  const links = rawLinks.map(parseLink);
  const publications = asArray(data.publications).map(parsePublication);
  const navigation = asArray(data.navigation).map(parseNavigation);

  return {
    id: asString(metadata.identifier, ''),
    title: asString(metadata.title, ''),
    subtitle: asStringOpt(metadata.subtitle),
    updated: asString(metadata.modified, new Date().toISOString()),
    author: metadata.author ? parsePerson(metadata.author as Record<string, unknown>) : undefined,
    links,
    publications,
    navigation,
    facets: parseFacets(asArray(data.facets)),
    groups: asArray(data.groups).map(parseGroup),
    pagination: parsePagination(links),
    isComplete: (metadata.numberOfItems != null && !hasPagination(links)) || false,
    search: extractSearch(links),
    feedType: classifyFeedType(navigation.length, publications.length),
  };
}

function parsePublication(data: Record<string, unknown>): OPDSPublication {
  const metadata = (data.metadata ?? {}) as Record<string, unknown>;
  const rawLinks = asArray(data.links);

  return {
    id: asString(metadata.identifier ?? (data as Record<string, unknown>)['@id'], ''),
    title: asString(metadata.title, ''),
    subtitle: asStringOpt(metadata.subtitle),
    authors: asArray(metadata.author).map((a) => parsePerson(a as Record<string, unknown>)),
    contributors: asArray(metadata.contributor).map((a) =>
      parsePerson(a as Record<string, unknown>),
    ),
    publisher: asStringOpt(metadata.publisher),
    published: asStringOpt(metadata.published),
    updated: asStringOpt(metadata.modified),
    language: asStringOpt(metadata.language),
    summary: asStringOpt(metadata.description),
    content: metadata.description
      ? { value: String(metadata.description), type: 'text' as const }
      : undefined,
    images: asArray(data.images).map(parseImage),
    subjects: asArray(metadata.subject).map(parseSubject),
    acquisitionLinks: parseAcquisitionLinks(rawLinks),
    links: rawLinks
      .filter((l) => !isAcquisitionRel(asString((l as Record<string, unknown>).rel, '')))
      .map(parseLink),
    identifiers: parseIdentifiers(metadata),
    series: parseSeries(metadata),
    rights: asStringOpt(metadata.rights),
  };
}

function parseNavigation(data: Record<string, unknown>): OPDSNavigationEntry {
  return {
    id: asString(data.href, ''),
    title: asString(data.title, ''),
    summary: asStringOpt(data.description),
    href: asString(data.href, ''),
    rel: asStringOpt(data.rel),
    type: asStringOpt(data.type),
  };
}

function parseLink(data: Record<string, unknown>): OPDSLink {
  return {
    href: asString(data.href, ''),
    rel: asStringOpt(data.rel),
    type: asStringOpt(data.type),
    title: asStringOpt(data.title),
    hreflang: asStringOpt(data.hreflang),
    length: typeof data.length === 'number' ? data.length : undefined,
  };
}

function parseAcquisitionLinks(rawLinks: unknown[]): OPDSAcquisitionLink[] {
  return rawLinks
    .filter((l) => isAcquisitionRel(asString((l as Record<string, unknown>).rel, '')))
    .map((l) => {
      const data = l as Record<string, unknown>;
      const props = (data.properties ?? {}) as Record<string, unknown>;

      return {
        href: asString(data.href, ''),
        rel: asStringOpt(data.rel),
        type: asStringOpt(data.type),
        title: asStringOpt(data.title),
        price: parsePrice(props.price),
        indirectAcquisition: parseIndirectAcquisitionList(props.indirectAcquisition),
        availability: parseAvailability(props.availability),
        copies: typeof props.copies === 'number' ? props.copies : undefined,
        holds: typeof props.holds === 'number' ? props.holds : undefined,
      };
    });
}

function parseImage(data: Record<string, unknown>): OPDSImage {
  return {
    href: asString(data.href, ''),
    type: asStringOpt(data.type),
    rel: asString(data.rel, 'http://opds-spec.org/image'),
    width: typeof data.width === 'number' ? data.width : undefined,
    height: typeof data.height === 'number' ? data.height : undefined,
  };
}

function parsePerson(data: Record<string, unknown>): OPDSPerson {
  if (typeof data === 'string') {
    return { name: data };
  }
  return {
    name: asString(data.name, ''),
    uri: asStringOpt(data.uri) ?? asStringOpt(data.identifier),
    sortAs: asStringOpt(data.sortAs),
  };
}

function parseSubject(data: Record<string, unknown>): OPDSSubject {
  if (typeof data === 'string') {
    return { name: data };
  }
  return {
    name: asString(data.name, ''),
    code: asStringOpt(data.code),
    scheme: asStringOpt(data.scheme),
  };
}

function parsePrice(data: unknown): { value: number; currency: string } | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const p = data as Record<string, unknown>;
  if (typeof p.value !== 'number' || typeof p.currency !== 'string') return undefined;
  return { value: p.value, currency: p.currency };
}

function parseIndirectAcquisitionList(
  data: unknown,
): Array<{ type: string; indirectAcquisition?: Array<{ type: string }> }> | undefined {
  if (!Array.isArray(data) || data.length === 0) return undefined;
  return data.map((item: Record<string, unknown>) => ({
    type: asString(item.type, ''),
    indirectAcquisition: Array.isArray(item.indirectAcquisition)
      ? item.indirectAcquisition.map((n: Record<string, unknown>) => ({
          type: asString(n.type, ''),
        }))
      : undefined,
  }));
}

function parseAvailability(
  data: unknown,
):
  | { state: 'available' | 'unavailable' | 'reserved' | 'ready'; since?: string; until?: string }
  | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const a = data as Record<string, unknown>;
  return {
    state: asString(a.state, 'unavailable') as 'available' | 'unavailable' | 'reserved' | 'ready',
    since: asStringOpt(a.since),
    until: asStringOpt(a.until),
  };
}

function parseIdentifiers(metadata: Record<string, unknown>): OPDSIdentifier[] {
  const identifiers: OPDSIdentifier[] = [];
  const id = asStringOpt(metadata.identifier);
  if (id) {
    let scheme: string | undefined;
    if (id.startsWith('urn:isbn:')) scheme = 'isbn';
    else if (id.startsWith('urn:doi:')) scheme = 'doi';
    else if (id.startsWith('urn:uuid:')) scheme = 'uuid';
    identifiers.push({ value: scheme ? id.replace(/^urn:\w+:/, '') : id, scheme });
  }
  return identifiers;
}

function parseSeries(
  metadata: Record<string, unknown>,
): { name: string; position?: number } | undefined {
  const belongsTo = metadata.belongsTo as Record<string, unknown> | undefined;
  if (!belongsTo?.series) return undefined;

  const series = belongsTo.series as Record<string, unknown>;
  if (typeof series === 'string') return { name: series };

  return {
    name: asString(series.name, ''),
    position: typeof series.position === 'number' ? series.position : undefined,
  };
}

function parseGroup(data: Record<string, unknown>): OPDSGroup {
  const metadata = (data.metadata ?? {}) as Record<string, unknown>;
  return {
    title: asString(metadata.title, ''),
    links: asArray(data.links).map(parseLink),
    publications: asArray(data.publications).map(parsePublication),
    navigation: asArray(data.navigation).map(parseNavigation),
  };
}

function parseFacets(data: unknown[]): OPDSFacetGroup[] {
  return data.map((f) => {
    const facet = f as Record<string, unknown>;
    const metadata = (facet.metadata ?? {}) as Record<string, unknown>;
    return {
      title: asString(metadata.title, ''),
      facets: asArray(facet.links).map((l) => {
        const link = l as Record<string, unknown>;
        const props = (link.properties ?? {}) as Record<string, unknown>;
        return {
          title: asString(link.title, ''),
          href: asString(link.href, ''),
          count: typeof props.numberOfItems === 'number' ? props.numberOfItems : undefined,
          active: props.activeFacet === true,
        };
      }),
    };
  });
}

function parsePagination(links: OPDSLink[]): OPDSPagination | undefined {
  const pagination: OPDSPagination = {};
  let found = false;

  for (const link of links) {
    switch (link.rel) {
      case 'first':
        pagination.first = link.href;
        found = true;
        break;
      case 'previous':
      case 'prev':
        pagination.previous = link.href;
        found = true;
        break;
      case 'next':
        pagination.next = link.href;
        found = true;
        break;
      case 'last':
        pagination.last = link.href;
        found = true;
        break;
    }
  }

  return found ? pagination : undefined;
}

function hasPagination(links: OPDSLink[]): boolean {
  return links.some(
    (l) => l.rel === 'next' || l.rel === 'previous' || l.rel === 'first' || l.rel === 'last',
  );
}

function extractSearch(links: OPDSLink[]): OPDSSearchDescriptor | undefined {
  const searchLink = links.find((l) => l.rel === 'search');
  if (!searchLink) return undefined;

  if (searchLink.href.includes('{searchTerms}')) {
    return {
      template: searchLink.href,
      parameters: [{ name: 'searchTerms', value: '{searchTerms}', required: true }],
      shortName: searchLink.title,
    };
  }

  return undefined;
}

function isAcquisitionRel(rel: string): boolean {
  if (!rel) return false;
  return rel.startsWith('http://opds-spec.org/acquisition') || rel === 'acquisition';
}

// --- Utility helpers ---

function asArray(val: unknown): Record<string, unknown>[] {
  if (Array.isArray(val)) return val;
  return [];
}

function asString(val: unknown, fallback: string): string {
  if (typeof val === 'string') return val;
  return fallback;
}

function asStringOpt(val: unknown): string | undefined {
  if (typeof val === 'string' && val.length > 0) return val;
  return undefined;
}
