import { useEffect, useRef } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { getOSPlatform } from '@/utils/misc';
import { eventDispatcher } from '@/utils/event';
import { isPointerInsideSelection, TextSelection } from '@/utils/sel';
import { useInstantAnnotation } from './useInstantAnnotation';
export const useTextSelector = (
  bookKey: string,
  setSelection: React.Dispatch<React.SetStateAction<TextSelection | null>>,
  getAnnotationText: (range: Range) => Promise<string>,
  handleDismissPopup: () => void,
  showDesktopNativeMenu?: (x: number, y: number) => void,
) => {
  const { appService } = useEnv();
  const { getView, getViewSettings } = useReaderStore();
  const view = getView(bookKey);
  const osPlatform = getOSPlatform();

  const isPopuped = useRef(false);
  const isUpToPopup = useRef(false);
  const isTextSelected = useRef(false);
  const isTouchStarted = useRef(false);
  const selectionPosition = useRef<number | null>(null);
  const lastPointerType = useRef<string>('mouse');
  const isInstantAnnotating = useRef(false);
  const isInstantAnnotated = useRef(false);

  const {
    isInstantAnnotationEnabled,
    handleInstantAnnotationPointerDown,
    handleInstantAnnotationPointerMove,
    handleInstantAnnotationPointerCancel,
    handleInstantAnnotationPointerUp,
  } = useInstantAnnotation({ bookKey, getAnnotationText, setSelection });

  const isValidSelection = (sel: Selection) => {
    return sel && sel.toString().trim().length > 0 && sel.rangeCount > 0;
  };

  const makeSelection = async (sel: Selection, index: number, rebuildRange = false) => {
    isTextSelected.current = true;
    const range = sel.getRangeAt(0);
    if (rebuildRange) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
    setSelection({
      key: bookKey,
      text: await getAnnotationText(range),
      cfi: view?.getCFI(index, range),
      range,
      index,
    });
  };
  // P9.23: Dismiss iOS system selection popup using requestAnimationFrame
  // instead of the previous double-setTimeout(30ms) hack that caused flicker
  const makeSelectionOnIOS = async (sel: Selection, index: number) => {
    isTextSelected.current = true;
    const range = sel.getRangeAt(0);
    sel.removeAllRanges();
    requestAnimationFrame(async () => {
      if (!isTextSelected.current) return;
      sel.addRange(range);
      setSelection({
        key: bookKey,
        text: await getAnnotationText(range),
        cfi: view?.getCFI(index, range),
        range,
        index,
      });
    });
  };

  const startInstantAnnotating = (ev: PointerEvent) => {
    isInstantAnnotating.current = true;
    isInstantAnnotated.current = false;
    if (view) view.renderer.scrollLocked = true;
    (ev.target as HTMLElement).style.userSelect = 'none';
  };

  const stopInstantAnnotating = (ev: PointerEvent) => {
    isInstantAnnotating.current = false;
    isInstantAnnotated.current = false;
    if (view) view.renderer.scrollLocked = false;
    (ev.target as HTMLElement).style.userSelect = '';
  };

  const handlePointerDown = (doc: Document, index: number, ev: PointerEvent) => {
    lastPointerType.current = ev.pointerType;

    if (isInstantAnnotationEnabled()) {
      const handled = handleInstantAnnotationPointerDown(doc, index, ev);
      if (handled) {
        ev.preventDefault();
        startInstantAnnotating(ev);
      }
    }
  };

  const handlePointerMove = (doc: Document, index: number, ev: PointerEvent) => {
    if (isInstantAnnotating.current) {
      ev.preventDefault();
      isInstantAnnotated.current = handleInstantAnnotationPointerMove(doc, index, ev);
    }
  };

  const handlePointerCancel = (_doc: Document, _index: number, ev: PointerEvent) => {
    if (isInstantAnnotating.current) {
      stopInstantAnnotating(ev);
      handleInstantAnnotationPointerCancel();
    }
  };

  const handlePointerUp = async (doc: Document, index: number, ev?: PointerEvent) => {
    if (isInstantAnnotating.current && ev) {
      stopInstantAnnotating(ev);
      const handled = await handleInstantAnnotationPointerUp(doc, index, ev);
      if (handled) {
        isTextSelected.current = true;
        return;
      } else {
        // If instant annotation was not created, we let the event propagate
        // as an iframe click event which relies on a mousedown event
        (ev.target as Element)?.dispatchEvent(
          new MouseEvent('mousedown', {
            ...ev,
            bubbles: true,
            cancelable: true,
          }),
        );
      }
    }

    // Available on iOS and Desktop, fired at touchend or mouseup
    // Note that on Android, we mock pointer events with native touch events
    const sel = doc.getSelection() as Selection;
    if (isValidSelection(sel)) {
      const isPointerInside = ev && isPointerInsideSelection(sel, ev);
      const isIOS = osPlatform === 'ios' || appService?.isIOSApp;

      if (isPointerInside && isIOS) {
        makeSelectionOnIOS(sel, index);
      } else if (isPointerInside) {
        isUpToPopup.current = true;
        makeSelection(sel, index, true);
      } else if (appService?.isAndroidApp) {
        isUpToPopup.current = false;
        makeSelection(sel, index, true);
      }
    }
  };
  const handleTouchStart = () => {
    isTouchStarted.current = true;
  };
  const handleTouchMove = (ev: TouchEvent) => {
    if (isInstantAnnotating.current && isInstantAnnotated.current) {
      ev.preventDefault();
    }
  };
  const handleTouchEnd = () => {
    isTouchStarted.current = false;
  };
  const handleSelectionchange = (doc: Document, index: number) => {
    // Available on iOS, Android and Desktop, fired when the selection is changed
    if (osPlatform !== 'android' || !appService?.isAndroidApp) return;

    const sel = doc.getSelection() as Selection;
    if (isValidSelection(sel)) {
      if (!selectionPosition.current) {
        selectionPosition.current = view?.renderer?.start || null;
      }
      makeSelection(sel, index, false);
    } else {
      selectionPosition.current = null;
    }
  };
  const handleScroll = () => {
    // P9.24: Prevent Android WebView auto-scroll that conflicts with CSS column pagination.
    // Uses overflow-anchor: none on container + re-anchor to selection start position.
    if (osPlatform !== 'android' || !appService?.isAndroidApp) return;

    const viewSettings = getViewSettings(bookKey);
    if (viewSettings?.scrolled) return;

    if (isTextSelected.current && view?.renderer) {
      // Apply overflow-anchor: none to prevent browser auto-scroll
      const container = (
        view.renderer as { getContainerElement?: () => HTMLElement }
      ).getContainerElement?.();
      if (container) {
        container.style.overflowAnchor = 'none';
      }
      if (view.renderer.containerPosition && selectionPosition.current) {
        view.renderer.containerPosition = selectionPosition.current;
      }
    }
  };

  const handleShowPopup = (showPopup: boolean) => {
    setTimeout(() => {
      if (showPopup && !isPopuped.current) {
        isUpToPopup.current = false;
      }
      isPopuped.current = showPopup;
    }, 500);
  };

  const handleUpToPopup = () => {
    isUpToPopup.current = true;
  };

  const handleContextmenu = (event: Event) => {
    // On mobile, allow the native iOS/Android context menu (Copy, Writing Tools,
    // Look Up, Translate, Share, Speak) — don't suppress it.
    if (appService?.isMobile) {
      return;
    }
    if (lastPointerType.current === 'touch' || lastPointerType.current === 'pen') {
      event.preventDefault();
      event.stopPropagation();
      return false;
    }
    // On desktop Tauri, show native OS context menu for mouse right-click.
    // Coordinates must be translated from iframe-relative to window-relative
    // since Tauri Menu.popup() positions relative to the main window.
    if (showDesktopNativeMenu && lastPointerType.current === 'mouse') {
      const mouseEvent = event as MouseEvent;
      event.preventDefault();
      event.stopPropagation();
      const doc = mouseEvent.target as Node;
      const iframe = doc?.ownerDocument?.defaultView?.frameElement;
      const iframeRect = iframe?.getBoundingClientRect();
      const offsetX = iframeRect?.left ?? 0;
      const offsetY = iframeRect?.top ?? 0;
      showDesktopNativeMenu(mouseEvent.clientX + offsetX, mouseEvent.clientY + offsetY);
      return false;
    }
    return;
  };

  useEffect(() => {
    const handleSingleClick = (): boolean => {
      if (isUpToPopup.current) {
        isUpToPopup.current = false;
        return true;
      }
      if (isTextSelected.current) {
        handleDismissPopup();
        isTextSelected.current = false;
        view?.deselect();
        return true;
      }
      if (isPopuped.current) {
        handleDismissPopup();
        return true;
      }
      return false;
    };

    eventDispatcher.onSync('iframe-single-click', handleSingleClick);
    return () => {
      eventDispatcher.offSync('iframe-single-click', handleSingleClick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    isTextSelected,
    handleScroll,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    handlePointerDown,
    handlePointerMove,
    handlePointerCancel,
    handlePointerUp,
    handleSelectionchange,
    handleShowPopup,
    handleUpToPopup,
    handleContextmenu,
  };
};
