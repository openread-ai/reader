import semver from 'semver';
import { check } from '@tauri-apps/plugin-updater';
import { type as osType } from '@tauri-apps/plugin-os';
import { fetch } from '@tauri-apps/plugin-http';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { TranslationFunc } from '@/hooks/useTranslation';
import { setUpdaterWindowVisible } from '@/components/UpdaterWindow';
import { isTauriAppPlatform } from '@/services/environment';
import { getAppVersion } from '@/utils/version';
import {
  CHECK_UPDATE_INTERVAL_SEC,
  OPENREAD_CHANGELOG_FILE,
  OPENREAD_UPDATER_FILE,
} from '@/services/constants';
import { createLogger } from '@/utils/logger';

const logger = createLogger('updater');

const LAST_CHECK_KEY = 'lastAppUpdateCheck';

const showUpdateWindow = (latestVersion: string) => {
  const win = new WebviewWindow('updater', {
    url: `/updater?latestVersion=${latestVersion}`,
    title: 'Software Update',
    width: 626,
    height: 406,
    center: true,
    resizable: true,
  });
  win.once('tauri://created', () => {
    logger.info('new window created');
  });
  win.once('tauri://error', (e) => {
    logger.error('error creating window', e);
  });
};

export const checkForAppUpdates = async (
  _: TranslationFunc,
  isAutoCheck = true,
): Promise<boolean> => {
  const lastCheck = localStorage.getItem(LAST_CHECK_KEY);
  const now = Date.now();
  if (isAutoCheck && lastCheck && now - parseInt(lastCheck, 10) < CHECK_UPDATE_INTERVAL_SEC * 1000)
    return false;
  localStorage.setItem(LAST_CHECK_KEY, now.toString());

  logger.info('Checking for updates');
  const OS_TYPE = osType();
  if (['macos', 'windows', 'linux'].includes(OS_TYPE)) {
    const update = await check();
    if (update) {
      showUpdateWindow(update.version);
    }
    return !!update;
  } else if (OS_TYPE === 'android') {
    try {
      const response = await fetch(OPENREAD_UPDATER_FILE, { connectTimeout: 5000 });
      const data = await response.json();
      const isNewer = semver.gt(data.version, getAppVersion());
      if (isNewer && ('android-arm64' in data.platforms || 'android-universal' in data.platforms)) {
        setUpdaterWindowVisible(true, data.version!, getAppVersion());
      }
      return isNewer;
    } catch (err) {
      logger.warn('Failed to fetch Android update info', err);
      throw new Error('Failed to fetch Android update info');
    }
  }

  return false;
};

const LAST_SHOWN_RELEASE_NOTES_KEY = 'lastShownReleaseNotesVersion';

export const setLastShownReleaseNotesVersion = (version: string) => {
  localStorage.setItem(LAST_SHOWN_RELEASE_NOTES_KEY, version);
};

export const getLastShownReleaseNotesVersion = () => {
  return localStorage.getItem(LAST_SHOWN_RELEASE_NOTES_KEY) || '';
};

export const checkAppReleaseNotes = async (isAutoCheck = true) => {
  const currentVersion = getAppVersion();
  const lastShownVersion = getLastShownReleaseNotesVersion();
  if ((lastShownVersion && semver.gt(currentVersion, lastShownVersion)) || !isAutoCheck) {
    try {
      const fetchFunc = isTauriAppPlatform() ? fetch : window.fetch;
      const res = await fetchFunc(OPENREAD_CHANGELOG_FILE);
      if (res.ok) {
        setUpdaterWindowVisible(true, currentVersion, lastShownVersion, false);
        return true;
      }
    } catch (err) {
      logger.warn('Failed to fetch release notes', err);
    }
  } else if (!lastShownVersion) {
    setLastShownReleaseNotesVersion(currentVersion);
  }
  return false;
};
