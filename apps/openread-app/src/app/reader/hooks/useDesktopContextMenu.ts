import { useCallback } from 'react';
import { useSettingsStore } from '@/store/settingsStore';
import { isTauriAppPlatform, isMobilePlatform } from '@/services/environment';
import { dispatchAnnotationAction } from '@/services/annotation/nativeMenuBridge';
import { HIGHLIGHT_COLORS, HIGHLIGHT_STYLES } from '@/services/annotation/menuConfig';

/**
 * On desktop Tauri (macOS/Windows), provides a function to show a native OS
 * context menu (NSMenu / Win32 menu) at given coordinates.
 *
 * Called from useTextSelector's handleContextmenu when a mouse right-click
 * occurs on selected text inside the book iframe.
 *
 * Platform gate: only active when isTauriAppPlatform() && !isMobilePlatform().
 * Zero impact on iOS, Android, or Web.
 */
export function useDesktopContextMenu() {
  const { settings } = useSettingsStore();

  const isDesktopTauri = isTauriAppPlatform() && !isMobilePlatform();

  const showNativeMenu = useCallback(
    async (x: number, y: number) => {
      if (!isDesktopTauri) return;

      // Dynamic import — only loaded on desktop Tauri, tree-shaken on web
      const { Menu, Submenu, MenuItem, PredefinedMenuItem } = await import('@tauri-apps/api/menu');
      const { LogicalPosition } = await import('@tauri-apps/api/dpi');

      const currentStyle = settings.globalReadSettings.highlightStyle;

      // Build highlight color submenu
      const colorItems = await Promise.all(
        HIGHLIGHT_COLORS.map((c) =>
          MenuItem.new({
            text: `● ${c.label}`,
            action: () =>
              dispatchAnnotationAction({
                action: 'highlight',
                color: c.id,
                style: currentStyle,
              }),
          }),
        ),
      );

      // Build highlight style submenu
      const styleItems = await Promise.all(
        HIGHLIGHT_STYLES.map((s) =>
          MenuItem.new({
            text: s.label,
            action: () =>
              dispatchAnnotationAction({
                action: 'highlight',
                style: s.id,
              }),
          }),
        ),
      );

      const highlightSubmenu = await Submenu.new({
        text: 'Highlight',
        items: [...colorItems, await PredefinedMenuItem.new({ item: 'Separator' }), ...styleItems],
      });

      const addNote = await MenuItem.new({
        text: 'Add Note',
        action: () => dispatchAnnotationAction({ action: 'annotate' }),
      });

      const separator = await PredefinedMenuItem.new({ item: 'Separator' });

      const searchInBook = await MenuItem.new({
        text: 'Search in Book',
        action: () => dispatchAnnotationAction({ action: 'search' }),
      });

      const wikipedia = await MenuItem.new({
        text: 'Wikipedia',
        action: () => dispatchAnnotationAction({ action: 'wikipedia' }),
      });

      const menu = await Menu.new({
        items: [highlightSubmenu, addNote, separator, searchInBook, wikipedia],
      });

      await menu.popup(new LogicalPosition(x, y));
    },
    [isDesktopTauri, settings.globalReadSettings.highlightStyle],
  );

  return { showNativeMenu, isDesktopTauri };
}
