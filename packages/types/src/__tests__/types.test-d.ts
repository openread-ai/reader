/**
 * Type tests for @openread/types package.
 *
 * These tests verify the structure of exported types at compile time.
 * They use vitest's expectTypeOf for type-level assertions.
 */

import { describe, expectTypeOf, it } from 'vitest';
import type {
  Book,
  BookCore,
  BookFormat,
  ListBooksResponse,
  UploadUrlRequest,
  UploadUrlResponse,
  ConfirmUploadRequest,
  ConfirmUploadResponse,
  UserProfile,
  ApiError,
  ApiErrorCode,
  McpBookInfo,
  McpChapter,
  McpTocEntry,
  McpSearchResult,
  McpAnnotation,
} from '../index.js';

describe('BookCore types', () => {
  it('BookCore.hash should be string', () => {
    expectTypeOf<BookCore['hash']>().toEqualTypeOf<string>();
  });

  it('BookCore.createdAt should be number (epoch-ms)', () => {
    expectTypeOf<BookCore['createdAt']>().toEqualTypeOf<number>();
  });

  it('BookCore.updatedAt should be number (epoch-ms)', () => {
    expectTypeOf<BookCore['updatedAt']>().toEqualTypeOf<number>();
  });

  it('BookCore should have required fields', () => {
    expectTypeOf<BookCore>().toMatchTypeOf<{
      hash: string;
      title: string;
      format: BookFormat;
      createdAt: number;
      updatedAt: number;
    }>();
  });
});

describe('Book types', () => {
  it('Book should extend BookCore', () => {
    expectTypeOf<Book>().toMatchTypeOf<BookCore>();
  });

  it('Book should have required fields with correct nullability', () => {
    expectTypeOf<Book>().toMatchTypeOf<{
      id: string;
      hash: string;
      title: string;
      author: string | null;
      format: BookFormat;
      userId: string;
      createdAt: number;
      updatedAt: number;
    }>();
  });

  it('Book nullable fields should accept null', () => {
    expectTypeOf<Book['metaHash']>().toEqualTypeOf<string | null>();
    expectTypeOf<Book['author']>().toEqualTypeOf<string | null>();
    expectTypeOf<Book['sizeBytes']>().toEqualTypeOf<number | null>();
    expectTypeOf<Book['storagePath']>().toEqualTypeOf<string | null>();
  });

  it('BookFormat should be a union of all supported formats', () => {
    expectTypeOf<BookFormat>().toEqualTypeOf<'epub' | 'pdf' | 'mobi' | 'azw' | 'azw3' | 'fb2' | 'fbz' | 'cbz' | 'txt' | 'md'>();
  });
});

describe('API types', () => {
  it('ListBooksResponse should contain books array and pagination', () => {
    expectTypeOf<ListBooksResponse>().toMatchTypeOf<{
      books: Book[];
      total: number;
      page: number;
      pageSize: number;
    }>();
  });

  it('UploadUrlRequest should have required upload fields', () => {
    expectTypeOf<UploadUrlRequest>().toMatchTypeOf<{
      format: BookFormat;
      hash: string;
      metaHash: string;
      title: string;
      sizeBytes: number;
    }>();

    // author should be optional
    expectTypeOf<UploadUrlRequest['author']>().toEqualTypeOf<string | undefined>();
  });

  it('UploadUrlResponse should have uploadUrl and bookId', () => {
    expectTypeOf<UploadUrlResponse>().toMatchTypeOf<{
      uploadUrl: string;
      bookId: string;
    }>();
  });

  it('ConfirmUploadRequest should have bookId', () => {
    expectTypeOf<ConfirmUploadRequest>().toMatchTypeOf<{
      bookId: string;
    }>();
  });

  it('ConfirmUploadResponse should have book', () => {
    expectTypeOf<ConfirmUploadResponse>().toMatchTypeOf<{
      book: Book;
    }>();
  });

  it('UserProfile should have required user fields', () => {
    expectTypeOf<UserProfile>().toMatchTypeOf<{
      id: string;
      email: string;
      createdAt: string;
    }>();

    // Optional fields
    expectTypeOf<UserProfile['name']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<UserProfile['avatarUrl']>().toEqualTypeOf<string | undefined>();
  });
});

describe('Error types', () => {
  it('ApiError should have code and message', () => {
    expectTypeOf<ApiError>().toMatchTypeOf<{
      code: ApiErrorCode;
      message: string;
    }>();

    // details should be optional
    expectTypeOf<ApiError['details']>().toEqualTypeOf<Record<string, unknown> | undefined>();
  });

  it('ApiErrorCode should be a union of error codes', () => {
    expectTypeOf<ApiErrorCode>().toEqualTypeOf<
      'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION_ERROR' | 'CONFLICT' | 'INTERNAL_ERROR'
    >();
  });
});

describe('MCP types', () => {
  it('McpBookInfo should have book info fields', () => {
    expectTypeOf<McpBookInfo>().toMatchTypeOf<{
      id: string;
      title: string;
      author: string | null;
      format: BookFormat;
      chapterCount: number;
    }>();
  });

  it('McpChapter should have chapter fields', () => {
    expectTypeOf<McpChapter>().toMatchTypeOf<{
      index: number;
      title: string;
      href: string;
    }>();
  });

  it('McpTocEntry should have title and href', () => {
    expectTypeOf<McpTocEntry>().toMatchTypeOf<{
      title: string;
      href: string;
    }>();

    // children should be optional array of McpTocEntry
    expectTypeOf<McpTocEntry['children']>().toEqualTypeOf<McpTocEntry[] | undefined>();
  });

  it('McpSearchResult should have search result fields', () => {
    expectTypeOf<McpSearchResult>().toMatchTypeOf<{
      bookId: string;
      chapterIndex: number;
      matches: string[];
    }>();
  });

  it('McpAnnotation should have annotation fields', () => {
    expectTypeOf<McpAnnotation>().toMatchTypeOf<{
      id: string;
      bookId: string;
      type: 'highlight' | 'note' | 'bookmark';
      content: string;
      cfi: string;
      createdAt: number;
    }>();
  });
});
