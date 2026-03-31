import type { HighlightColor, HighlightStyle } from '@/types/book';
import { HIGHLIGHT_COLOR_HEX } from '@/services/constants';

/**
 * Annotation action IDs used across all platforms.
 * Each platform renderer maps these to native menu items.
 */
export type AnnotationMenuAction =
  | 'highlight'
  | 'annotate'
  | 'search'
  | 'wikipedia'
  | 'remove-highlight';

/**
 * Payload dispatched via eventDispatcher when a native or web
 * context menu action is triggered on selected text.
 */
export interface AnnotationActionEvent {
  action: AnnotationMenuAction;
  /** Highlight style — only relevant for 'highlight' action */
  style?: HighlightStyle;
  /** Highlight color — only relevant for 'highlight' action */
  color?: HighlightColor;
}

/** Event name used by all platforms to trigger annotation actions. */
export const ANNOTATION_ACTION_EVENT = 'annotation-action';

/**
 * Highlight color definitions — single source of truth.
 * Each platform maps `id` to its native representation:
 *   iOS: SF Symbol tint color
 *   Android: ColorInt
 *   macOS/Windows: Tauri menu icon
 *   Web: CSS color
 */
export const HIGHLIGHT_COLORS: ReadonlyArray<{
  id: HighlightColor;
  label: string;
  hex: string;
}> = [
  { id: 'yellow', label: 'Yellow', hex: HIGHLIGHT_COLOR_HEX['yellow']! },
  { id: 'red', label: 'Red', hex: HIGHLIGHT_COLOR_HEX['red']! },
  { id: 'green', label: 'Green', hex: HIGHLIGHT_COLOR_HEX['green']! },
  { id: 'blue', label: 'Blue', hex: HIGHLIGHT_COLOR_HEX['blue']! },
  { id: 'violet', label: 'Violet', hex: HIGHLIGHT_COLOR_HEX['violet']! },
];

/**
 * Highlight style definitions — single source of truth.
 */
export const HIGHLIGHT_STYLES: ReadonlyArray<{
  id: HighlightStyle;
  label: string;
}> = [
  { id: 'highlight', label: 'Highlight' },
  { id: 'underline', label: 'Underline' },
  { id: 'squiggly', label: 'Squiggly' },
];

/**
 * @keep — Referenced by native platform renderers (iOS Swift, Android Kotlin)
 * via hardcoded strings that mirror these values. Not imported in JS.
 *
 * Menu item groups — defines ordering and grouping per Apple HIG / Material Design.
 *
 * Group 1 (Primary): Highlight, Add Note — most frequent, closest to finger
 * Group 2 (Reference): Search in Book, Wikipedia
 * Group 3 (Destructive): Remove Highlight — red, separated, only when editing
 *
 * Platform-native items (Copy, Translate, Share, Look Up, Speak, Writing Tools)
 * are NOT listed here — each OS adds them automatically.
 */
export const MENU_GROUPS = [
  {
    id: 'primary',
    items: [
      {
        action: 'highlight',
        label: 'Highlight',
        sfSymbol: 'highlighter',
        androidIcon: 'ic_highlight',
      },
      {
        action: 'annotate',
        label: 'Add Note',
        sfSymbol: 'note.text',
        androidIcon: 'ic_note',
      },
    ],
  },
  {
    id: 'reference',
    items: [
      {
        action: 'search',
        label: 'Search in Book',
        sfSymbol: 'magnifyingglass',
        androidIcon: 'ic_search',
      },
      {
        action: 'wikipedia',
        label: 'Wikipedia',
        sfSymbol: 'book.closed',
        androidIcon: 'ic_wikipedia',
      },
    ],
  },
  {
    id: 'destructive',
    items: [
      {
        action: 'remove-highlight',
        label: 'Remove Highlight',
        sfSymbol: 'highlighter',
        androidIcon: 'ic_highlight',
        destructive: true,
      },
    ],
  },
] as const;
