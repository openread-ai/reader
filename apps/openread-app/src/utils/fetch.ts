import { getAccessToken } from './access';
import { createLogger } from '@/utils/logger';
import { isTauriAppPlatform, isMobilePlatform } from '@/services/environment';

const logger = createLogger('fetch');

/**
 * Get the appropriate fetch function for the current platform.
 * On Tauri mobile (iOS/Android), the WebView's native fetch() cannot reach external
 * URLs due to WKWebView's custom scheme restrictions. Tauri's plugin-http routes
 * requests through the native layer, bypassing this limitation.
 * Desktop Tauri (macOS/Windows/Linux) works fine with browser fetch.
 */
let _tauriFetch: typeof globalThis.fetch | null = null;
export async function getPlatformFetch(): Promise<typeof globalThis.fetch> {
  if (isTauriAppPlatform() && isMobilePlatform()) {
    if (!_tauriFetch) {
      const { fetch: tf } = await import('@tauri-apps/plugin-http');
      _tauriFetch = tf as unknown as typeof globalThis.fetch;
    }
    return _tauriFetch;
  }
  return globalThis.fetch;
}

export const fetchWithTimeout = async (url: string, options: RequestInit = {}, timeout = 10000) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort('Request timed out'), timeout);
  const platformFetch = await getPlatformFetch();

  return platformFetch(url, {
    ...options,
    signal: controller.signal,
  }).finally(() => clearTimeout(id));
};

export const fetchWithAuth = async (url: string, options: RequestInit) => {
  const token = await getAccessToken();
  if (!token) {
    throw new Error('Not authenticated');
  }
  const headers = {
    ...options.headers,
    Authorization: `Bearer ${token}`,
  };
  const platformFetch = await getPlatformFetch();
  const response = await platformFetch(url, { ...options, headers });

  if (!response.ok) {
    const errorData = await response.json();
    logger.error('Error:', errorData.error || response.statusText);
    throw new Error(errorData.error || 'Request failed');
  }

  return response;
};
