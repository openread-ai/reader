import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useEnv } from '@/context/EnvContext';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { addPluginListener, PluginListener } from '@tauri-apps/api/core';
import { onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { getCurrentWindow, getAllWindows } from '@tauri-apps/api/window';
import { isTauriAppPlatform } from '@/services/environment';
import { navigateToLibrary, showLibraryWindow } from '@/utils/nav';
import { eventDispatcher } from '@/utils/event';
import { createLogger } from '@/utils/logger';
import { isActivityCaptureUrl } from '@/helpers/activityCapture';

const logger = createLogger('openWithBooks');

interface SingleInstancePayload {
  args: string[];
  cwd: string;
}

interface OpenFilesPayload {
  files: string[];
}

interface SharedIntentPayload {
  urls: string[];
}

export function useOpenWithBooks() {
  const router = useRouter();
  const { appService } = useEnv();
  const { setCheckOpenWithBooks } = useLibraryStore();
  const listenedOpenWithBooks = useRef(false);

  const isFirstWindow = async () => {
    const allWindows = await getAllWindows();
    const currentWindow = getCurrentWindow();
    const sortedWindows = allWindows.sort((a, b) => a.label.localeCompare(b.label));
    return sortedWindows[0]?.label === currentWindow.label;
  };

  const handleOpenWithFileUrl = async (urls: string[]) => {
    logger.info('Handle Open with URL:', urls);
    const filePaths = [];
    for (let url of urls) {
      if (isActivityCaptureUrl(url)) continue;
      if (url.startsWith('file://')) {
        if (appService?.isIOSApp) {
          url = decodeURI(url);
        } else {
          url = decodeURI(url.replace('file://', ''));
        }
      }
      if (!/^(https?:|data:|blob:)/i.test(url)) {
        filePaths.push(url);
      }
    }
    if (filePaths.length > 0) {
      const settings = useSettingsStore.getState().settings;
      if (appService?.hasWindow && settings.openBookInNewWindow) {
        if (await isFirstWindow()) {
          showLibraryWindow(appService, filePaths);
        }
      } else {
        window.OPEN_WITH_FILES = filePaths;
        setCheckOpenWithBooks(true);
        // If in reader, don't navigate away — show toast instead of destroying the session
        if (window.location.pathname.startsWith('/reader')) {
          eventDispatcher.dispatch('toast', {
            message: `${filePaths.length} book(s) added. Go to library to open.`,
            type: 'info',
          });
        } else {
          navigateToLibrary(router, `reload=${Date.now()}`);
        }
      }
    }
  };

  const initializeListeners = async () => {
    return await addPluginListener<SharedIntentPayload>(
      'native-bridge',
      'shared-intent',
      (payload) => {
        logger.info('Received shared intent:', payload);
        const { urls } = payload;
        handleOpenWithFileUrl(urls);
      },
    );
  };

  useEffect(() => {
    if (!isTauriAppPlatform() || !appService) return;
    if (listenedOpenWithBooks.current) return;
    listenedOpenWithBooks.current = true;

    // For Windows/Linux deep link and macOS open-file event
    const unlistenDeeplink = getCurrentWindow().listen<SingleInstancePayload>(
      'single-instance',
      ({ payload }) => {
        logger.info('Received deep link:', payload);
        const { args } = payload;
        if (args?.[1]) {
          handleOpenWithFileUrl([args[1]]);
        }
      },
    );

    // macOS in-app open-files event
    const unlistenOpenFiles = getCurrentWindow().listen<OpenFilesPayload>(
      'open-files',
      ({ payload }) => {
        logger.info('Received open files:', payload);
        const { files } = payload;
        if (files && files.length > 0) {
          handleOpenWithFileUrl(files);
        }
      },
    );

    // P9.23: Enable share intent listener on both Android and iOS
    let unlistenSharedIntent: Promise<PluginListener> | null = null;
    if (appService?.isAndroidApp || appService?.isIOSApp) {
      unlistenSharedIntent = initializeListeners();
    }

    // iOS Open with URL event
    const listenOpenWithFiles = async () => {
      return await onOpenUrl((urls) => {
        handleOpenWithFileUrl(urls);
      });
    };
    const unlistenOpenUrl = listenOpenWithFiles();
    return () => {
      unlistenDeeplink.then((f) => f()).catch(() => {});
      unlistenOpenFiles.then((f) => f()).catch(() => {});
      unlistenOpenUrl.then((f) => f()).catch(() => {});
      unlistenSharedIntent?.then((f) => f.unregister()).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appService]);
}
