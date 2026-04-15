import { eventDispatcher } from '@/utils/event';
import type { AnnotationActionEvent } from './menuConfig';
import {
  ANNOTATION_ACTION_EVENT,
  HIGHLIGHT_COLORS,
  HIGHLIGHT_STYLES,
  MENU_GROUPS,
} from './menuConfig';
import type { HighlightColor, HighlightStyle } from '@/types/book';

declare global {
  interface Window {
    __nativeTextSelectionAction?: (action: string, color?: string, style?: string) => void;
    __nativeFooterAction?: (action: string) => void;
    webkit?: {
      messageHandlers?: {
        openreadColorPicker?: { postMessage: (data: unknown) => void };
        openreadColorPickerHide?: { postMessage: (data: unknown) => void };
        openreadFooterVisible?: { postMessage: (data: unknown) => void };
        openreadToolbarVisible?: { postMessage: (data: unknown) => void };
        openreadSidebarVisible?: { postMessage: (data: unknown) => void };
        openreadSelectionToolbar?: { postMessage: (data: unknown) => void };
        openreadRenameBook?: { postMessage: (data: unknown) => void };
        openreadCollectionPicker?: { postMessage: (data: unknown) => void };
        openreadCollectionToolbar?: { postMessage: (data: unknown) => void };
        openreadTextInput?: { postMessage: (data: unknown) => void };
        openreadChapterPull?: { postMessage: (data: unknown) => void };
        openreadChatComposer?: { postMessage: (data: unknown) => void };
      };
    };
  }
}

export type ChatComposerAction = 'show' | 'hide' | 'running' | 'disabled';

/**
 * Global callback invoked by native code (iOS Swift / Android Kotlin)
 * when a user taps a custom item in the native text selection menu.
 *
 * iOS:  evaluateJavaScript("window.__nativeTextSelectionAction('highlight', 'yellow', 'highlight')")
 * Android: evaluateJavascript("window.__nativeTextSelectionAction('highlight', 'yellow', 'highlight')", null)
 *
 * This bridges the native → JS boundary. The event is then handled by
 * the Annotator component via eventDispatcher, which already has the
 * current text selection state.
 */
/** Runtime validation sets — derived from menuConfig to stay in sync automatically. */
const VALID_ACTIONS: Set<string> = new Set(
  MENU_GROUPS.flatMap((g) => g.items.map((i) => i.action)),
);
const VALID_STYLES: Set<string> = new Set(HIGHLIGHT_STYLES.map((s) => s.id));
const VALID_COLORS: Set<string> = new Set(HIGHLIGHT_COLORS.map((c) => c.id));

function handleNativeAction(action: string, color?: string, style?: string): void {
  // Runtime validation: reject unknown actions to prevent spoofing from
  // EPUB-embedded scripts that may access window.parent globals.
  if (!VALID_ACTIONS.has(action)) return;
  if (style && !VALID_STYLES.has(style)) return;
  if (color && !VALID_COLORS.has(color)) return;

  const event: AnnotationActionEvent = {
    action: action as AnnotationActionEvent['action'],
    color: color as HighlightColor | undefined,
    style: style as HighlightStyle | undefined,
  };
  eventDispatcher.dispatch(ANNOTATION_ACTION_EVENT, event);
}

/**
 * Register the global callback on window so native code can call it.
 * Safe to call multiple times — only registers once.
 */
let registered = false;

export function registerNativeMenuBridge(): void {
  if (registered || typeof window === 'undefined') return;
  registered = true;

  // Expose to native code via non-configurable property to prevent
  // EPUB iframe scripts from overriding with a malicious handler
  Object.defineProperty(window, '__nativeTextSelectionAction', {
    value: handleNativeAction,
    writable: false,
    configurable: false,
  });
}

/**
 * Programmatic trigger — used by desktop (Tauri Menu) and web (Radix)
 * context menus which don't go through the native bridge.
 */
export function dispatchAnnotationAction(event: AnnotationActionEvent): void {
  eventDispatcher.dispatch(ANNOTATION_ACTION_EVENT, event);
}

/**
 * Compute viewport-relative coordinates from a selection range inside an iframe.
 * Returns the center-x of the range and the top-y, translated to the main viewport.
 */
export function getViewportCoordsFromRange(range: Range | null | undefined): {
  x: number;
  y: number;
} {
  const rangeRect = range?.getBoundingClientRect();
  const iframe = range?.startContainer?.ownerDocument?.defaultView?.frameElement;
  const iframeRect = iframe?.getBoundingClientRect() ?? { top: 0, left: 0 };
  return {
    x: (rangeRect?.x ?? 0) + iframeRect.left + (rangeRect?.width ?? 0) / 2,
    y: (rangeRect?.y ?? 0) + iframeRect.top,
  };
}

/** Show the native iOS UIKit color picker at the given screen coordinates. */
export function showNativeColorPicker(
  x: number,
  y: number,
  selectedColor: string,
  showDelete: boolean,
): void {
  window.webkit?.messageHandlers?.openreadColorPicker?.postMessage({
    x,
    y,
    selectedColor,
    showDelete,
  });
}

/** Check if native webkit message handlers are available (iOS). */
export function isNativeAvailable(): boolean {
  return !!window.webkit?.messageHandlers?.openreadFooterVisible;
}

/** Show native iOS text input alert. Result sent to window.__nativeTextInputResult. */
export function showNativeTextInputAlert(
  title: string,
  message: string,
  placeholder: string,
  defaultValue: string,
  callbackId: string,
): void {
  window.webkit?.messageHandlers?.openreadTextInput?.postMessage({
    title,
    message,
    placeholder,
    defaultValue,
    callbackId,
  });
}

/** Hide the native iOS UIKit color picker. */
export function hideNativeColorPicker(): void {
  window.webkit?.messageHandlers?.openreadColorPickerHide?.postMessage({});
}

/** Show/hide the native iOS UIKit footer bar. */
export function setNativeFooterVisible(visible: boolean): void {
  window.webkit?.messageHandlers?.openreadFooterVisible?.postMessage({ visible });
}

/** Update the active tab highlight on the native iOS footer bar. */
export function setNativeFooterActiveTab(tab: string | null): void {
  window.webkit?.messageHandlers?.openreadFooterVisible?.postMessage({
    visible: true,
    activeTab: tab,
  });
}

/** Send an action to the native iOS UIKit AI chat composer (show/hide/running/disabled). */
export function postChatComposer(action: ChatComposerAction, value?: boolean): void {
  window.webkit?.messageHandlers?.openreadChatComposer?.postMessage({ action, value });
}

/** Update the native iOS chapter pull indicator. */
export function postChapterPull(
  direction: 'next' | 'prev',
  progress: number,
  committed?: boolean,
): void {
  window.webkit?.messageHandlers?.openreadChapterPull?.postMessage({
    direction,
    progress,
    ...(committed !== undefined && { committed }),
  });
}
