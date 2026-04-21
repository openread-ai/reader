import { useEffect, useRef, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { createLogger } from '@/utils/logger';

const logger = createLogger('useLibrary');

export const useLibrary = () => {
  const { envConfig } = useEnv();
  const { setLibrary } = useLibraryStore();
  const { setSettings } = useSettingsStore();
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const isInitiating = useRef(false);

  useEffect(() => {
    if (isInitiating.current) return;
    isInitiating.current = true;
    const initLibrary = async () => {
      try {
        const appService = await envConfig.getAppService();
        const settings = await appService.loadSettings();
        setSettings(settings);
        const diskBooks = await appService.loadLibraryBooks();
        // Only overwrite if disk has data or store is empty.
        // Sync may have already populated the store — don't clobber with empty disk.
        const currentLibrary = useLibraryStore.getState().library;
        if (diskBooks.length > 0 || currentLibrary.length === 0) {
          setLibrary(diskBooks);
        }
      } catch (error) {
        logger.error('Failed to initialize library', error);
        // Set empty library so libraryLoaded=true in the store,
        // allowing sync to proceed even if disk load fails.
        const currentLibrary = useLibraryStore.getState().library;
        if (currentLibrary.length === 0) {
          setLibrary([]);
        }
      } finally {
        setLibraryLoaded(true);
      }
    };

    initLibrary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { libraryLoaded };
};
