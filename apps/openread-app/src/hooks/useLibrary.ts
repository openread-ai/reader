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
        setLibrary(await appService.loadLibraryBooks());
      } catch (error) {
        logger.error('Failed to initialize library', error);
        // Set empty library so libraryLoaded=true in the store,
        // allowing sync to proceed even if disk load fails.
        setLibrary([]);
      } finally {
        setLibraryLoaded(true);
      }
    };

    initLibrary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { libraryLoaded };
};
