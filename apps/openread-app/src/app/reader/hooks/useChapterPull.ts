import { useEffect, useRef, useCallback } from 'react';
import { FoliateView } from '@/types/view';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';

type PullDirection = 'next' | 'prev' | null;

/** Pixels the user must drag past the boundary to trigger a chapter transition. */
const PULL_THRESHOLD = 60;
/** Reset pull state if no touch events arrive within this window (ms). */
const STALE_TIMEOUT = 600;

/** Batch progress updates through rAF; resets (progress=0) are sent immediately. */
let pendingNativeUpdate: { direction: string; progress: number } | null = null;
let rafId: number | null = null;

function sendPullToNative(direction: PullDirection, progress: number) {
  const msg = { direction: (direction ?? '') as string, progress };
  // Resets must be immediate — rAF batching could delay or drop them
  if (progress <= 0) {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    pendingNativeUpdate = null;
    window.webkit?.messageHandlers?.openreadChapterPull?.postMessage(msg);
    return;
  }
  pendingNativeUpdate = msg;
  if (rafId === null) {
    rafId = requestAnimationFrame(() => {
      rafId = null;
      if (pendingNativeUpdate) {
        window.webkit?.messageHandlers?.openreadChapterPull?.postMessage(pendingNativeUpdate);
        pendingNativeUpdate = null;
      }
    });
  }
}

/**
 * Pull-to-load chapter transition for mobile (iOS).
 *
 * When the user scrolls to a chapter boundary and keeps dragging, a native
 * UIProgressView appears (blue, right-to-left at bottom / left-to-right at top).
 * Once dragged past the threshold the chapter transitions. Releasing early
 * snaps the indicator back.
 *
 * Uses the renderer's scroll events for boundary detection (reliable on all
 * platforms) combined with iframe touch events for tracking pull distance.
 * The natural iOS rubber-band bounce is preserved for tactile feedback.
 */
export const useChapterPull = (
  bookKey: string,
  viewRef: React.RefObject<FoliateView | null>,
): void => {
  const { appService } = useEnv();
  const { getViewSettings } = useReaderStore();
  const { getBookData } = useBookDataStore();

  // Track the last known Y on every touchmove — used as the anchor when boundary is hit
  const lastYRef = useRef<number | null>(null);
  const boundaryAnchorYRef = useRef<number | null>(null);
  const directionRef = useRef<PullDirection>(null);
  const progressRef = useRef(0);
  const transitioningRef = useRef(false);
  const staleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track boundary state from scroll events (more reliable than checking on touchmove)
  const atBottomRef = useRef(false);
  const atTopRef = useRef(false);

  const resetPull = useCallback(() => {
    lastYRef.current = null;
    boundaryAnchorYRef.current = null;
    directionRef.current = null;
    progressRef.current = 0;
    transitioningRef.current = false;
    if (staleTimerRef.current) {
      clearTimeout(staleTimerRef.current);
      staleTimerRef.current = null;
    }
    sendPullToNative(null, 0);
  }, []);

  useEffect(() => {
    if (!appService?.isMobile) return;

    const view = viewRef.current;
    if (!view) return;

    const renderer = view.renderer;
    if (!renderer) return;

    const refreshStaleTimer = () => {
      if (staleTimerRef.current) clearTimeout(staleTimerRef.current);
      staleTimerRef.current = setTimeout(resetPull, STALE_TIMEOUT);
    };

    // Use scroll events to track boundary state — fires reliably during native scroll
    const onScroll = () => {
      const { start, end, viewSize } = renderer;
      if (viewSize <= 0) return;
      atBottomRef.current = viewSize - Math.ceil(end) <= 2;
      atTopRef.current = start <= 2;
    };

    const handleMessage = (msg: MessageEvent) => {
      if (!msg.data || msg.data.bookKey !== bookKey) return;

      const vs = getViewSettings(bookKey);
      if (!vs?.scrolled || !vs?.continuousScroll) return;

      const bd = getBookData(bookKey);
      if (bd?.bookDoc?.rendition?.layout === 'pre-paginated') return;

      const { type, targetTouches } = msg.data;

      if (type === 'iframe-touchstart') {
        const touch = targetTouches?.[0];
        if (!touch) return;
        lastYRef.current = touch.screenY;
        boundaryAnchorYRef.current = null;
        directionRef.current = null;
        progressRef.current = 0;
        transitioningRef.current = false;
        // Seed boundary state from current scroll position
        onScroll();
        refreshStaleTimer();
      } else if (type === 'iframe-touchmove') {
        if (transitioningRef.current) return;
        const touch = targetTouches?.[0];
        if (!touch || lastYRef.current === null) return;
        refreshStaleTimer();

        const currentY = touch.screenY;
        const prevY = lastYRef.current;
        lastYRef.current = currentY;

        // Use per-frame direction (not from touchstart) — catches the
        // moment the user reverses direction at the boundary
        const movingUp = currentY < prevY;
        const movingDown = currentY > prevY;

        // Detect boundary hit: anchor is set on the FIRST touchmove where
        // we're at a boundary AND the finger is moving into the overscroll direction
        if (atBottomRef.current && movingUp && boundaryAnchorYRef.current === null) {
          boundaryAnchorYRef.current = currentY;
          directionRef.current = 'next';
        } else if (atTopRef.current && movingDown && boundaryAnchorYRef.current === null) {
          boundaryAnchorYRef.current = currentY;
          directionRef.current = 'prev';
        }

        if (boundaryAnchorYRef.current === null) {
          if (progressRef.current > 0) resetPull();
          return;
        }

        const distance = Math.abs(currentY - boundaryAnchorYRef.current);
        const progress = Math.min(1, distance / PULL_THRESHOLD);
        progressRef.current = progress;
        sendPullToNative(directionRef.current, progress);
      } else if (type === 'iframe-touchend') {
        if (transitioningRef.current) return;

        if (directionRef.current && progressRef.current >= 1) {
          transitioningRef.current = true;
          if (directionRef.current === 'next') {
            view.next(renderer.viewSize - Math.floor(renderer.end) + 1);
          } else {
            view.prev(renderer.start + 1);
          }
        }
        resetPull();
      }
    };

    renderer.addEventListener('scroll', onScroll);
    window.addEventListener('message', handleMessage);
    return () => {
      renderer.removeEventListener('scroll', onScroll);
      window.removeEventListener('message', handleMessage);
      resetPull();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewRef.current, bookKey, appService?.isMobile]);
};
