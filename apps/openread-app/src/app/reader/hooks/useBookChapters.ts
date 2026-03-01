import { useCallback, useRef } from 'react';
import type { BookDoc, TOCItem } from '@/libs/document';
import type { ReaderChapter } from '@/services/ai/tools/bookTools';
import { createLogger } from '@/utils/logger';

const logger = createLogger('book-chapters');

/**
 * Build two maps from section ID → label:
 *
 * 1. `titleMap`: section ID → its own TOC label (first/outermost match wins).
 * 2. `parentMap`: section ID → parent TOC label (e.g. "Chapter 3: The 5 Time Assassins").
 *
 * The parent map lets us prefix sub-section titles so the AI can resolve
 * "Chapter 3" even when the EPUB spine only has subsections like "The Three Trade Levels".
 */
function buildSectionTitleMaps(bookDoc: BookDoc): {
  titleMap: Map<string, string>;
  parentMap: Map<string, string>;
} {
  const titleMap = new Map<string, string>();
  const parentMap = new Map<string, string>();
  if (!bookDoc.toc) return { titleMap, parentMap };

  function traverse(items: TOCItem[], parentLabel?: string) {
    for (const item of items) {
      if (item.href) {
        try {
          const sectionId = String(bookDoc.splitTOCHref(item.href)[0] ?? '');
          if (sectionId && !titleMap.has(sectionId)) {
            titleMap.set(sectionId, item.label);
          }
          if (sectionId && parentLabel && !parentMap.has(sectionId)) {
            parentMap.set(sectionId, parentLabel);
          }
        } catch {
          // Skip TOC items with malformed hrefs
        }
      }
      if (item.subitems) {
        // Children inherit this item's label as their parent chapter
        traverse(item.subitems, item.label);
      }
    }
  }

  traverse(bookDoc.toc);
  return { titleMap, parentMap };
}

function extractText(doc: Document): string {
  const body = doc.body || doc.documentElement;
  if (!body) return '';
  const clone = body.cloneNode(true) as HTMLElement;
  clone
    .querySelectorAll('script, style, noscript, nav, header, footer')
    .forEach((el) => el.remove());
  return clone.textContent?.trim() || '';
}

async function extractAllChapters(bookDoc: BookDoc): Promise<ReaderChapter[]> {
  const sections = bookDoc.sections || [];
  const { titleMap, parentMap } = buildSectionTitleMaps(bookDoc);
  const result: ReaderChapter[] = [];

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i]!;
    if (section.linear === 'no') continue;

    try {
      const doc = await section.createDocument();
      const text = extractText(doc);
      if (text.length < 50) continue;

      // Build a title that includes the parent chapter label when available.
      // e.g. "Chapter 3: The 5 Time Assassins > The Three Trade Levels"
      // This allows the AI to resolve "Chapter 3" via substring match.
      const ownTitle = titleMap.get(section.id) || `Section ${i + 1}`;
      const parent = parentMap.get(section.id);
      const title = parent && parent !== ownTitle ? `${parent} > ${ownTitle}` : ownTitle;

      result.push({
        id: section.id,
        index: i,
        title,
        text,
      });
    } catch {
      // Skip sections that fail to parse
    }
  }

  logger.info(`Extracted ${result.length} chapters for agent tools`);
  return result;
}

/**
 * Provides a lazy chapter extractor for the agentic chat adapter.
 *
 * Returns a `getChapters()` function that extracts all chapter text from the
 * BookDoc on first call, then caches the result. Subsequent calls return
 * the cached chapters instantly. Cache is invalidated when bookDoc changes.
 */
export function useBookChapters(bookDoc: BookDoc | null | undefined) {
  const cacheRef = useRef<{ forDoc: BookDoc; chapters: ReaderChapter[] } | null>(null);

  const getChapters = useCallback(async (): Promise<ReaderChapter[]> => {
    if (!bookDoc) return [];

    // Cache hit — same book, already extracted
    if (cacheRef.current?.forDoc === bookDoc) {
      return cacheRef.current.chapters;
    }

    // First call: extract all chapters
    const chapters = await extractAllChapters(bookDoc);
    cacheRef.current = { forDoc: bookDoc, chapters };
    return chapters;
  }, [bookDoc]);

  return { getChapters };
}
