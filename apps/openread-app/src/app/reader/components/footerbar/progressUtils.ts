import { PageInfo } from '@/types/book';

/**
 * Compute progress fraction from book format and page info.
 * Used by both FooterBar and MobileProgressOverlay.
 */
export function computeProgress(
  bookFormat: string,
  section?: PageInfo,
  pageinfo?: PageInfo,
): { progressValid: boolean; progressFraction: number } {
  const info = bookFormat === 'pdf' ? section : pageinfo;
  const progressValid = !!info && info.total > 0 && info.current >= 0;
  const progressFraction = progressValid ? (info!.current + 1) / info!.total : 0;
  return { progressValid, progressFraction };
}
