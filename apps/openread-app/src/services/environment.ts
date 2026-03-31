import { AppService } from '@/types/system';
import { READEST_NODE_BASE_URL, READEST_WEB_BASE_URL } from './constants';

declare global {
  interface Window {
    __READEST_CLI_ACCESS?: boolean;
  }
}

export const isTauriAppPlatform = () => process.env['NEXT_PUBLIC_APP_PLATFORM'] === 'tauri';
export const isWebAppPlatform = () => process.env['NEXT_PUBLIC_APP_PLATFORM'] === 'web';
export const hasCli = () => window.__READEST_CLI_ACCESS === true;
export const isPWA = () => window.matchMedia('(display-mode: standalone)').matches;
export const getBaseUrl = () =>
  process.env['NEXT_PUBLIC_API_BASE_URL'] ||
  (process.env['NEXT_PUBLIC_VERCEL_URL']
    ? `https://${process.env['NEXT_PUBLIC_VERCEL_URL']}`
    : READEST_WEB_BASE_URL);
export const getNodeBaseUrl = () =>
  process.env['NEXT_PUBLIC_NODE_BASE_URL'] ?? READEST_NODE_BASE_URL;

export const isMacPlatform = () =>
  typeof window !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

export const getCommandPaletteShortcut = () => (isMacPlatform() ? '⌘⇧P' : 'Ctrl+Shift+P');

const isWebDevMode = () => process.env['NODE_ENV'] === 'development' && isWebAppPlatform();

// Dev API only in development mode and web platform
// with command `pnpm dev-web`
// for production build or tauri app use the production Web API
export const getAPIBaseUrl = () => (isWebDevMode() ? '/api' : `${getBaseUrl()}/api`);

// For Node.js API that currently not supported in some edge runtimes
export const getNodeAPIBaseUrl = () => (isWebDevMode() ? '/api' : `${getNodeBaseUrl()}/api`);

export interface EnvConfigType {
  getAppService: () => Promise<AppService>;
}

let nativeAppService: AppService | null = null;
const getNativeAppService = async () => {
  if (!nativeAppService) {
    const { NativeAppService } = await import('@/services/nativeAppService');
    nativeAppService = new NativeAppService();
    await nativeAppService.init();
  }
  return nativeAppService;
};

let webAppService: AppService | null = null;
const getWebAppService = async () => {
  if (!webAppService) {
    const { WebAppService } = await import('@/services/webAppService');
    webAppService = new WebAppService();
    await webAppService.init();
  }
  return webAppService;
};

const environmentConfig: EnvConfigType = {
  getAppService: async () => {
    if (isTauriAppPlatform()) {
      return getNativeAppService();
    } else {
      return getWebAppService();
    }
  },
};

export default environmentConfig;

/**
 * Detect whether the app is running on a mobile Tauri platform (iOS/Android).
 * Uses the same synchronous osType() from @tauri-apps/plugin-os that
 * nativeAppService.ts uses at module level — no init step required.
 * On non-Tauri platforms, the import throws and we return false.
 */
let _isMobile: boolean | null = null;

export function isMobilePlatform(): boolean {
  if (_isMobile !== null) return _isMobile;
  if (!isTauriAppPlatform()) {
    _isMobile = false;
    return false;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { type: osType } = require('@tauri-apps/plugin-os');
    const os = osType();
    _isMobile = os === 'ios' || os === 'android';
  } catch {
    _isMobile = false;
  }
  return _isMobile;
}
