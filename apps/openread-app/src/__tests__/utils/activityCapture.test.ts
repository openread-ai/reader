import { describe, expect, it } from 'vitest';
import {
  isActivityCaptureUrl,
  parseActivityCaptureRoute,
  parseActivityCaptureTarget,
} from '@/helpers/activityCapture';

describe('activityCapture helpers', () => {
  it('detects Openread activity capture URLs', () => {
    expect(isActivityCaptureUrl('openread://activity-capture?route=/reader')).toBe(true);
    expect(isActivityCaptureUrl('openread://other?route=/reader')).toBe(false);
  });

  it('parses target metadata from activity capture URLs', () => {
    expect(
      parseActivityCaptureTarget(
        'openread://activity-capture?route=%2Freader&screen=reader&state=reader-open&book=first-library-book',
      ),
    ).toEqual({
      route: '/reader',
      screen: 'reader',
      state: 'reader-open',
      book: 'first-library-book',
    });
  });

  it('keeps route parsing compatible', () => {
    expect(parseActivityCaptureRoute('openread://activity-capture?route=/library')).toBe(
      '/library',
    );
  });

  it('rejects unsafe external routes', () => {
    expect(parseActivityCaptureTarget('openread://activity-capture?route=//evil.example')).toEqual({
      route: '/',
      screen: null,
      state: null,
      book: null,
    });
  });
});
