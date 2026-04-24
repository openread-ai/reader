'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { isTauriAppPlatform } from '@/services/environment';
import { useEnv } from '@/context/EnvContext';
import { useLibraryStore } from '@/store/libraryStore';
import { navigateToReader } from '@/utils/nav';
import { createLogger } from '@/utils/logger';
import { parseActivityCaptureTarget, type ActivityCaptureTarget } from '@/helpers/activityCapture';

const logger = createLogger('activityCaptureBridge');

export default function ActivityCaptureBridge() {
  const router = useRouter();
  const { appService } = useEnv();

  useEffect(() => {
    if (!isTauriAppPlatform() || !appService) return;

    const handleTarget = async (target: ActivityCaptureTarget) => {
      const wantsReader =
        target.screen === 'reader' ||
        target.state?.includes('reader') ||
        target.route === '/reader';

      if (!wantsReader) {
        logger.info('Opening activity capture route', { route: target.route });
        router.push(target.route);
        return;
      }

      const storedLibrary = useLibraryStore.getState().library;
      const diskLibrary =
        storedLibrary.length > 0 ? storedLibrary : await appService.loadLibraryBooks();
      if (diskLibrary.length > 0 && storedLibrary.length === 0) {
        useLibraryStore.getState().setLibrary(diskLibrary);
      }

      const book = diskLibrary.find((entry) => !entry.deletedAt && entry.hash);
      if (!book) {
        logger.warn('Activity capture reader target has no local library book; opening library');
        router.push('/library');
        return;
      }

      logger.info('Opening activity capture reader target', { bookHash: book.hash });
      navigateToReader(router, [book.hash], undefined, { scroll: false });
    };

    const handleUrls = (urls: string[] | null) => {
      if (!urls) return;
      for (const url of urls) {
        const target = parseActivityCaptureTarget(url);
        if (target) {
          void handleTarget(target).catch((error) => {
            logger.error('Failed to open activity capture target', error);
            router.push(target.route);
          });
          return;
        }
      }
    };

    getCurrent()
      .then(handleUrls)
      .catch(() => {});
    const unlisten = onOpenUrl(handleUrls);

    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [appService, router]);

  return null;
}
