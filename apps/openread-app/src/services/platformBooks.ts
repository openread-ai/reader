import type { BookFormat } from '@/types/book';

export interface PlatformBookEntry {
  r2Filename: string;
  format: BookFormat;
  platformHash: string;
  title: string;
}

export const PLATFORM_BOOKS_R2_PREFIX = 'platform/books';
export const PLATFORM_BOOKS_SEEDED_KEY = 'openread_platform_books_seeded';
export const PLATFORM_BOOKS_MANIFEST: PlatformBookEntry[] = [
  {
    r2Filename: 'alice-in-wonderland.epub',
    format: 'epub',
    platformHash: '0799700427fee87bfb1049b70885badf47a7d59d63ff520a0c85d198636816c9',
    title: "Alice's Adventures in Wonderland",
  },
];
