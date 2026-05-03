/**
 * @module @openread/types/mcp
 * Types for Model Context Protocol (MCP) tools.
 *
 * These types are used by the MCP server to expose book content
 * and annotations to AI assistants and other MCP clients.
 */

import type { BookFormat } from './book.js';

/**
 * Book information returned by MCP list_books and get_book_info tools.
 *
 * This is a simplified view of the Book entity optimized for MCP tool responses.
 */
export interface McpBookInfo {
  /**
   * Book ID (UUID).
   */
  id: string;

  /**
   * Book title.
   */
  title: string;

  /**
   * Author name(s), null if unknown.
   */
  author: string | null;

  /**
   * File format (e.g., "epub", "pdf").
   */
  format: BookFormat;

  /**
   * Total number of chapters/sections in the book.
   */
  chapterCount: number;
}

/**
 * Chapter metadata returned by MCP get_chapter tool.
 *
 * Contains chapter navigation metadata. The actual chapter content
 * is returned separately via the `content` field in the get_chapter response.
 */
export interface McpChapter {
  /**
   * Chapter index (0-based).
   */
  index: number;

  /**
   * Chapter title from table of contents.
   */
  title: string;

  /**
   * Internal href/anchor reference within the book.
   * Used for navigation and linking.
   */
  href: string;
}

/**
 * Table of contents entry for a book.
 *
 * TOC entries can be nested to represent book structure.
 */
export interface McpTocEntry {
  /**
   * Chapter/section title.
   */
  title: string;

  /**
   * Internal href/anchor reference.
   */
  href: string;

  /**
   * Nested child entries for subsections.
   */
  children?: McpTocEntry[];
}

/**
 * Search result from MCP search_book or search_library tools.
 *
 * Contains matched text snippets with location information.
 */
export interface McpSearchResult {
  /**
   * ID of the book containing the match.
   */
  bookId: string;

  /**
   * Chapter index where the match was found (0-based).
   */
  chapterIndex: number;

  /**
   * Array of text snippets that matched the query.
   * May include surrounding context.
   */
  matches: string[];
}

/**
 * Annotation or highlight from MCP get_annotations tool.
 *
 * Represents user-created notes, highlights, or bookmarks.
 */
export interface McpAnnotation {
  /**
   * Annotation ID (UUID).
   */
  id: string;

  /**
   * ID of the book this annotation belongs to.
   */
  bookId: string;

  /**
   * Type of annotation.
   * - "highlight": Text highlighting
   * - "note": Text note attached to a location
   * - "bookmark": Position marker
   */
  type: 'highlight' | 'note' | 'bookmark';

  /**
   * Content of the annotation.
   * For highlights, this is the highlighted text.
   * For notes, this is the note content.
   * For bookmarks, this may be a label or empty.
   */
  content: string;

  /**
   * EPUB CFI (Canonical Fragment Identifier) location.
   * Uniquely identifies the position within the book.
   * @example "epubcfi(/6/4!/4/2/1:0)"
   */
  cfi: string;

  /**
   * Epoch-millisecond timestamp of when the annotation was created.
   */
  createdAt: number;
}
