/**
 * OPDS 1.x Atom feed parser.
 *
 * Parses OPDS Atom XML feeds into the canonical OPDSFeed domain model.
 * Handles all OPDS 1.2 spec elements including indirect acquisitions,
 * facets, groups, pagination, and OpenSearch metadata.
 */

import type {
  OPDSAcquisitionLink,
  OPDSAvailability,
  OPDSContent,
  OPDSFacet,
  OPDSFacetGroup,
  OPDSFeed,
  OPDSGroup,
  OPDSIdentifier,
  OPDSImage,
  OPDSIndirectAcquisition,
  OPDSLink,
  OPDSNavigationEntry,
  OPDSPagination,
  OPDSPerson,
  OPDSPrice,
  OPDSPublication,
  OPDSSearchDescriptor,
  OPDSSeries,
  OPDSSubject,
} from '../../types';
import { OPDS_NS, OPDS_IMAGE_RELS, classifyFeedType } from '../../types';

interface AtomParseResult {
  type: 'feed' | 'publication' | 'error';
  feed?: OPDSFeed;
  publication?: OPDSPublication;
  error?: string;
}

/**
 * Parse an OPDS Atom XML string into the canonical domain model.
 */
export function parseAtom(xml: string): AtomParseResult {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');

  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    return { type: 'error', error: parseError.textContent || 'XML parse error' };
  }

  const root = doc.documentElement;

  if (root.localName === 'entry') {
    return {
      type: 'publication',
      publication: parseEntry(root),
    };
  }

  if (root.localName === 'feed') {
    return {
      type: 'feed',
      feed: parseFeed(doc, root),
    };
  }

  return { type: 'error', error: `Unknown document type: ${root.localName}` };
}

function parseFeed(doc: Document, feedEl: Element): OPDSFeed {
  const children = Array.from(feedEl.children);
  const atomFilter = makeFilter(doc, OPDS_NS.ATOM);

  const allLinks = children.filter(atomFilter('link')).map(parseLink);
  const entries = children.filter(atomFilter('entry'));

  const publications: OPDSPublication[] = [];
  const navigation: OPDSNavigationEntry[] = [];
  const groupMap = new Map<
    string | null,
    { items: (OPDSPublication | OPDSNavigationEntry)[]; link?: OPDSLink }
  >();
  groupMap.set(null, { items: [] });

  for (const entry of entries) {
    const entryChildren = Array.from(entry.children);
    const entryLinks = entryChildren.filter(atomFilter('link')).map(parseLink);
    const isPublication = entryLinks.some(
      (l) => l.rel?.startsWith('http://opds-spec.org/acquisition') || l.rel === 'preview',
    );

    // Check for group membership
    const groupLink = entryLinks.find(
      (l) => l.rel === 'http://opds-spec.org/group' || l.rel === 'collection',
    );
    const groupKey = groupLink?.href ?? null;

    if (groupKey && !groupMap.has(groupKey)) {
      groupMap.set(groupKey, { items: [], link: groupLink });
    }

    const group = groupMap.get(groupKey) ?? groupMap.get(null)!;

    if (isPublication) {
      const pub = parseEntry(entry);
      group.items.push(pub);
      if (groupKey === null) publications.push(pub);
    } else {
      const nav = parseNavigationEntry(entry, entryChildren, atomFilter);
      group.items.push(nav);
      if (groupKey === null) navigation.push(nav);
    }
  }

  // Build groups (excluding the null/ungrouped entries)
  const groups: OPDSGroup[] = [];
  for (const [key, value] of groupMap) {
    if (key === null) continue;
    const pubs = value.items.filter((i): i is OPDSPublication => 'acquisitionLinks' in i);
    const navs = value.items.filter((i): i is OPDSNavigationEntry => !('acquisitionLinks' in i));
    groups.push({
      title: value.link?.title ?? '',
      links: value.link ? [{ href: value.link.href, rel: 'self', type: value.link.type }] : [],
      publications: pubs,
      navigation: navs,
    });
  }

  return {
    id: getChildText(children, atomFilter, 'id'),
    title: getChildText(children, atomFilter, 'title'),
    subtitle: getChildTextOptional(children, atomFilter, 'subtitle'),
    updated: getChildText(children, atomFilter, 'updated') || new Date().toISOString(),
    author: parsePersonOptional(children, atomFilter, 'author'),
    icon: getChildTextOptional(children, atomFilter, 'icon'),
    links: allLinks,
    publications,
    navigation,
    facets: parseFacets(feedEl),
    groups,
    pagination: parsePagination(allLinks, feedEl),
    isComplete: isCompleteFeed(feedEl),
    search: extractSearchFromLinks(allLinks),
    feedType: classifyFeedType(navigation.length, publications.length),
  };
}

function parseEntry(entryEl: Element): OPDSPublication {
  const doc = entryEl.ownerDocument;
  const children = Array.from(entryEl.children);
  const atomFilter = makeFilter(doc, OPDS_NS.ATOM);

  const links = children.filter(atomFilter('link')).map(parseLink);
  const acqLinks = children
    .filter(atomFilter('link'))
    .map(parseAcquisitionLinkEl)
    .filter(Boolean) as OPDSAcquisitionLink[];
  const images = parseImages(links);

  return {
    id: getChildText(children, atomFilter, 'id'),
    title: getChildText(children, atomFilter, 'title'),
    subtitle: getChildTextOptional(children, atomFilter, 'subtitle'),
    authors: parsePersons(children, atomFilter, 'author'),
    contributors: parsePersons(children, atomFilter, 'contributor'),
    publisher: getDCText(children, 'publisher'),
    published:
      getDCText(children, 'issued') ??
      getDCText(children, 'date') ??
      getChildTextOptional(children, atomFilter, 'published'),
    updated: getChildTextOptional(children, atomFilter, 'updated'),
    language: getDCText(children, 'language'),
    summary: getChildTextOptional(children, atomFilter, 'summary'),
    content: parseContent(children, atomFilter),
    images,
    subjects: parseSubjects(children, atomFilter),
    acquisitionLinks: acqLinks,
    links: links.filter((l) => !l.rel?.startsWith('http://opds-spec.org/acquisition')),
    identifiers: parseIdentifiers(children),
    series: parseSeries(entryEl),
    rights: getChildTextOptional(children, atomFilter, 'rights') ?? getDCText(children, 'rights'),
  };
}

// --- Helper functions ---

type ElementFilter = (name: string) => (el: Element) => boolean;

function makeFilter(doc: Document, ns: string): ElementFilter {
  const useNS = doc.lookupNamespaceURI(null) === ns || doc.lookupPrefix(ns);
  return useNS
    ? (name) => (el) => el.namespaceURI === ns && el.localName === name
    : (name) => (el) => el.localName === name;
}

function getChildText(children: Element[], filter: ElementFilter, name: string): string {
  return children.find(filter(name))?.textContent ?? '';
}

function getChildTextOptional(
  children: Element[],
  filter: ElementFilter,
  name: string,
): string | undefined {
  const text = children.find(filter(name))?.textContent;
  return text || undefined;
}

function parseNavigationEntry(
  _entry: Element,
  children: Element[],
  atomFilter: ElementFilter,
): OPDSNavigationEntry {
  const links = children.filter(atomFilter('link')).map(parseLink);
  // For navigation, the primary link is the one with type matching OPDS catalog or any link
  const primaryLink =
    links.find((l) => l.type?.includes('opds-catalog') || l.type?.includes('atom+xml')) ?? links[0];

  return {
    id: getChildText(children, atomFilter, 'id'),
    title: children.find(atomFilter('title'))?.textContent ?? '',
    summary:
      getChildTextOptional(children, atomFilter, 'summary') ??
      getContentText(children.find(atomFilter('content'))),
    href: primaryLink?.href ?? '',
    rel: primaryLink?.rel,
    type: primaryLink?.type,
    count: primaryLink?.length,
    updated: getChildTextOptional(children, atomFilter, 'updated'),
  };
}

function parseLink(linkEl: Element): OPDSLink {
  const rels = linkEl.getAttribute('rel')?.split(/\s+/);
  return {
    href: linkEl.getAttribute('href') ?? '',
    rel: rels?.[0],
    type: linkEl.getAttribute('type') ?? undefined,
    title: linkEl.getAttribute('title') ?? undefined,
    hreflang: linkEl.getAttribute('hreflang') ?? undefined,
    length: linkEl.getAttribute('length')
      ? parseInt(linkEl.getAttribute('length')!, 10)
      : undefined,
  };
}

function parseAcquisitionLinkEl(linkEl: Element): OPDSAcquisitionLink | null {
  const rel = linkEl.getAttribute('rel') ?? '';
  if (!rel.startsWith('http://opds-spec.org/acquisition')) return null;

  return {
    href: linkEl.getAttribute('href') ?? '',
    rel,
    type: linkEl.getAttribute('type') ?? undefined,
    title: linkEl.getAttribute('title') ?? undefined,
    price: parsePrice(linkEl),
    indirectAcquisition: parseIndirectAcquisition(linkEl),
    availability: parseAvailability(linkEl),
    copies: parseNumberAttr(linkEl, 'copies', OPDS_NS.OPDS),
    holds: parseNumberAttr(linkEl, 'holds', OPDS_NS.OPDS),
  };
}

function parsePrice(linkEl: Element): OPDSPrice | undefined {
  const priceEl = linkEl.getElementsByTagNameNS(OPDS_NS.OPDS, 'price')[0];
  if (!priceEl) return undefined;

  const value = parseFloat(priceEl.textContent ?? '0');
  const currency =
    priceEl.getAttribute('currencycode') ?? priceEl.getAttribute('currency') ?? 'USD';
  return { value, currency };
}

function parseIndirectAcquisition(el: Element): OPDSIndirectAcquisition[] | undefined {
  const iaElements = el.getElementsByTagNameNS(OPDS_NS.OPDS, 'indirectAcquisition');
  if (iaElements.length === 0) return undefined;

  // Only get direct children (not nested)
  const directChildren = Array.from(iaElements).filter((ia) => ia.parentElement === el);
  if (directChildren.length === 0) {
    // Fallback: take first element
    return [parseIndirectAcquisitionEl(iaElements[0]!)];
  }
  return directChildren.map(parseIndirectAcquisitionEl);
}

function parseIndirectAcquisitionEl(el: Element): OPDSIndirectAcquisition {
  const type = el.getAttribute('type') ?? '';
  const nested = Array.from(el.getElementsByTagNameNS(OPDS_NS.OPDS, 'indirectAcquisition')).filter(
    (n) => n.parentElement === el,
  );

  return {
    type,
    indirectAcquisition: nested.length > 0 ? nested.map(parseIndirectAcquisitionEl) : undefined,
  };
}

function parseAvailability(linkEl: Element): OPDSAvailability | undefined {
  const availEl = linkEl.getElementsByTagNameNS(OPDS_NS.OPDS, 'availability')[0];
  if (!availEl) return undefined;

  return {
    state: (availEl.getAttribute('state') as OPDSAvailability['state']) ?? 'unavailable',
    since: availEl.getAttribute('since') ?? undefined,
    until: availEl.getAttribute('until') ?? undefined,
  };
}

function parseNumberAttr(el: Element, name: string, ns?: string): number | undefined {
  const val = ns ? el.getAttributeNS(ns, name) : el.getAttribute(name);
  if (!val) return undefined;
  const num = parseInt(val, 10);
  return isNaN(num) ? undefined : num;
}

function parsePersons(children: Element[], filter: ElementFilter, name: string): OPDSPerson[] {
  return children.filter(filter(name)).map(parsePerson);
}

function parsePersonOptional(
  children: Element[],
  filter: ElementFilter,
  name: string,
): OPDSPerson | undefined {
  const el = children.find(filter(name));
  return el ? parsePerson(el) : undefined;
}

function parsePerson(personEl: Element): OPDSPerson {
  const ns = personEl.namespaceURI;
  const uri = ns
    ? personEl.getElementsByTagNameNS(ns, 'uri')[0]?.textContent
    : personEl.querySelector('uri')?.textContent;
  const nameEl = ns
    ? personEl.getElementsByTagNameNS(ns, 'name')[0]
    : personEl.querySelector('name');

  return {
    name: nameEl?.textContent ?? '',
    uri: uri ?? undefined,
  };
}

function parseContent(children: Element[], filter: ElementFilter): OPDSContent | undefined {
  const contentEl = children.find(filter('content')) ?? children.find(filter('summary'));
  return getContentObj(contentEl);
}

function getContentObj(el: Element | undefined): OPDSContent | undefined {
  if (!el) return undefined;
  const type = (el.getAttribute('type') ?? 'text') as OPDSContent['type'];
  let value: string;

  if (type === 'xhtml') {
    value = el.innerHTML;
  } else if (type === 'html') {
    value = (el.textContent ?? '')
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&amp;', '&');
  } else {
    value = el.textContent ?? '';
  }

  return { value, type };
}

function getContentText(el: Element | undefined): string | undefined {
  if (!el) return undefined;
  return el.textContent ?? undefined;
}

function parseSubjects(children: Element[], filter: ElementFilter): OPDSSubject[] {
  return children.filter(filter('category')).map((cat) => ({
    name: cat.getAttribute('label') ?? cat.getAttribute('term') ?? '',
    code: cat.getAttribute('term') ?? undefined,
    scheme: cat.getAttribute('scheme') ?? undefined,
  }));
}

function parseImages(links: OPDSLink[]): OPDSImage[] {
  const images: OPDSImage[] = [];
  for (const link of links) {
    if (!link.rel) continue;
    if (OPDS_IMAGE_RELS.some((r) => r === link.rel)) {
      images.push({
        href: link.href,
        type: link.type,
        rel: link.rel,
      });
    }
  }
  return images;
}

function parseIdentifiers(children: Element[]): OPDSIdentifier[] {
  const identifiers: OPDSIdentifier[] = [];
  const dcFilter = (name: string) => (el: Element) =>
    (el.namespaceURI === OPDS_NS.DC || el.namespaceURI === OPDS_NS.DCTERMS) &&
    el.localName === name;

  for (const el of children.filter(dcFilter('identifier'))) {
    const value = el.textContent?.trim();
    if (!value) continue;

    let scheme: string | undefined;
    if (value.startsWith('urn:isbn:')) {
      scheme = 'isbn';
    } else if (value.startsWith('urn:doi:')) {
      scheme = 'doi';
    } else if (value.startsWith('urn:uuid:')) {
      scheme = 'uuid';
    }

    identifiers.push({
      value: scheme ? value.replace(/^urn:\w+:/, '') : value,
      scheme,
    });
  }

  return identifiers;
}

function parseSeries(entryEl: Element): OPDSSeries | undefined {
  // OPDS uses schema:Series or opds:Series
  const seriesEl =
    entryEl.getElementsByTagNameNS(OPDS_NS.SCHEMA, 'Series')[0] ??
    entryEl.getElementsByTagNameNS(OPDS_NS.OPDS, 'Series')[0];

  if (!seriesEl) return undefined;

  const name = seriesEl.getAttribute('name') ?? seriesEl.textContent ?? '';
  const position = seriesEl.getAttribute('position');

  return {
    name,
    position: position ? parseFloat(position) : undefined,
  };
}

function getDCText(children: Element[], name: string): string | undefined {
  const el = children.find(
    (el) =>
      (el.namespaceURI === OPDS_NS.DC || el.namespaceURI === OPDS_NS.DCTERMS) &&
      el.localName === name,
  );
  return el?.textContent ?? undefined;
}

function parseFacets(feedEl: Element): OPDSFacetGroup[] {
  const links = feedEl.querySelectorAll(':scope > link');
  const groupMap = new Map<string, OPDSFacet[]>();

  for (const link of links) {
    const rel = link.getAttribute('rel') ?? '';
    if (!rel.includes('facet') && rel !== 'http://opds-spec.org/facet') continue;

    const groupName =
      link.getAttributeNS(OPDS_NS.OPDS, 'facetGroup') ??
      link.getAttribute('opds:facetGroup') ??
      'Filters';

    if (!groupMap.has(groupName)) {
      groupMap.set(groupName, []);
    }

    const thrCount = link.getAttributeNS(OPDS_NS.THR, 'count') ?? link.getAttribute('thr:count');
    const active =
      link.getAttributeNS(OPDS_NS.OPDS, 'activeFacet') === 'true' ||
      link.getAttribute('opds:activeFacet') === 'true';

    groupMap.get(groupName)!.push({
      title: link.getAttribute('title') ?? '',
      href: link.getAttribute('href') ?? '',
      count: thrCount ? parseInt(thrCount, 10) : undefined,
      active,
    });
  }

  return Array.from(groupMap, ([title, facets]) => ({ title, facets }));
}

function parsePagination(links: OPDSLink[], feedEl: Element): OPDSPagination | undefined {
  const pagination: OPDSPagination = {};
  let hasPagination = false;

  for (const link of links) {
    switch (link.rel) {
      case 'first':
        pagination.first = link.href;
        hasPagination = true;
        break;
      case 'previous':
      case 'prev':
        pagination.previous = link.href;
        hasPagination = true;
        break;
      case 'next':
        pagination.next = link.href;
        hasPagination = true;
        break;
      case 'last':
        pagination.last = link.href;
        hasPagination = true;
        break;
    }
  }

  // OpenSearch pagination metadata
  const totalResults =
    feedEl.getElementsByTagNameNS(OPDS_NS.OPENSEARCH, 'totalResults')[0] ??
    feedEl.querySelector('totalResults');
  if (totalResults?.textContent) {
    pagination.totalResults = parseInt(totalResults.textContent, 10);
    hasPagination = true;
  }

  const itemsPerPage =
    feedEl.getElementsByTagNameNS(OPDS_NS.OPENSEARCH, 'itemsPerPage')[0] ??
    feedEl.querySelector('itemsPerPage');
  if (itemsPerPage?.textContent) {
    pagination.itemsPerPage = parseInt(itemsPerPage.textContent, 10);
  }

  const startIndex =
    feedEl.getElementsByTagNameNS(OPDS_NS.OPENSEARCH, 'startIndex')[0] ??
    feedEl.querySelector('startIndex');
  if (startIndex?.textContent) {
    pagination.startIndex = parseInt(startIndex.textContent, 10);
  }

  return hasPagination ? pagination : undefined;
}

function isCompleteFeed(feedEl: Element): boolean {
  const fhComplete = feedEl.getElementsByTagNameNS(OPDS_NS.FH, 'complete')[0];
  if (fhComplete) return true;

  // Fallback: check without namespace
  const complete = feedEl.querySelector('complete');
  return complete !== null;
}

function extractSearchFromLinks(links: OPDSLink[]): OPDSSearchDescriptor | undefined {
  const searchLink = links.find(
    (l) =>
      l.rel === 'search' &&
      l.type &&
      (l.type.includes('opensearch') || l.type.includes('atom+xml')),
  );

  if (!searchLink) return undefined;

  // If the search link is a template (contains {searchTerms}), use it directly
  if (searchLink.href.includes('{searchTerms}')) {
    return {
      template: searchLink.href,
      parameters: [{ name: 'searchTerms', value: '{searchTerms}', required: true }],
      shortName: searchLink.title,
    };
  }

  // Otherwise, the href points to an OpenSearch description document
  // Return a placeholder that the service layer will resolve
  return undefined;
}
