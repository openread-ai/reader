/**
 * OPDS HTTP client abstraction.
 *
 * Provides a platform-agnostic HTTP interface that handles
 * authentication, proxy routing, timeouts, and progress reporting.
 * Delegates to platform-specific adapters (Tauri vs Web).
 */

import {
  isTauriAppPlatform,
  isWebAppPlatform,
  getAPIBaseUrl,
  getNodeAPIBaseUrl,
} from '@/services/environment';
import { READEST_OPDS_USER_AGENT } from '@/services/constants';
import { createLogger } from '@/utils/logger';
import { md5 } from 'js-md5';
import { OPDS_TIMEOUTS } from '../types';

const logger = createLogger('opds-http');

// --- Public interfaces ---

export interface OPDSAuthCredentials {
  username: string;
  password: string;
}

export interface OPDSHttpOptions {
  auth?: OPDSAuthCredentials | null;
  timeout?: number;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  method?: string;
}

export interface OPDSDownloadProgress {
  loaded: number;
  total: number | null;
  percentage: number | null;
}

export interface OPDSAuthProbeResult {
  requiresAuth: boolean;
  authType?: 'basic' | 'digest';
  realm?: string;
}

// --- Proxy configuration (lazy-evaluated to avoid SSR issues) ---

function getOpdsProxyUrl(): string {
  return `${getAPIBaseUrl()}/opds/proxy`;
}

function getNodeOpdsProxyUrl(): string {
  return `${getNodeAPIBaseUrl()}/opds/proxy`;
}

const PROXY_OVERRIDE_DOMAINS: ReadonlyArray<{ domain: string; useNode: boolean }> = [
  { domain: 'standardebooks', useNode: true },
];

function getProxyBaseUrl(url: string): string {
  for (const { domain, useNode } of PROXY_OVERRIDE_DOMAINS) {
    if (url.includes(domain)) return useNode ? getNodeOpdsProxyUrl() : getOpdsProxyUrl();
  }
  return getOpdsProxyUrl();
}

function needsProxy(url: string): boolean {
  return isWebAppPlatform() && url.startsWith('http');
}

function getProxiedURL(url: string, stream = false): string {
  if (!url.startsWith('http')) return url;

  const cleanUrl = extractCredentialsFromURL(url).url;
  const params = new URLSearchParams();
  params.append('url', cleanUrl);
  params.append('stream', `${stream}`);

  return `${getProxyBaseUrl(url)}?${params.toString()}`;
}

function extractCredentialsFromURL(url: string): {
  url: string;
  username?: string;
  password?: string;
} {
  try {
    const urlObj = new URL(url);
    const username = decodeURIComponent(urlObj.username) || undefined;
    const password = decodeURIComponent(urlObj.password) || undefined;
    if (username || password) {
      urlObj.username = '';
      urlObj.password = '';
      return { url: urlObj.toString(), username, password };
    }
  } catch (e) {
    logger.warn('Failed to parse URL for credential extraction', e);
  }
  return { url };
}

// --- Auth helpers ---

function createBasicAuth(username: string, password: string): string {
  return `Basic ${btoa(`${username}:${password}`)}`;
}

function parseDigestChallenge(challenge: string): Record<string, string> {
  const params: Record<string, string> = {};
  const regex = /(\w+)=["']?([^"',]+)["']?/g;
  let match;
  while ((match = regex.exec(challenge)) !== null) {
    params[match[1]!] = match[2]!;
  }
  return params;
}

function createDigestAuth(
  username: string,
  password: string,
  wwwAuth: string,
  method: string,
  uri: string,
): string {
  const params = parseDigestChallenge(wwwAuth);
  const cnonceBytes = new Uint8Array(16);
  crypto.getRandomValues(cnonceBytes);
  const cnonce = Array.from(cnonceBytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const nc = '00000001';
  const realm = params['realm'];
  const nonce = params['nonce'];
  const qop = params['qop'];
  const algorithm = params['algorithm'];

  let ha1 = md5(`${username}:${realm}:${password}`);
  if (algorithm?.toLowerCase() === 'md5-sess') {
    ha1 = md5(`${ha1}:${nonce}:${cnonce}`);
  }

  const ha2 = md5(`${method}:${uri}`);
  const response = qop
    ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : md5(`${ha1}:${nonce}:${ha2}`);

  const parts = [
    `username="${username}"`,
    `realm="${realm}"`,
    `nonce="${nonce}"`,
    `uri="${uri}"`,
    `response="${response}"`,
  ];
  if (algorithm) parts.push(`algorithm="${algorithm}"`);
  if (params['opaque']) parts.push(`opaque="${params['opaque']}"`);
  if (qop) {
    parts.push(`qop="auth"`, `nc=${nc}`, `cnonce="${cnonce}"`);
  }

  return `Digest ${parts.join(', ')}`;
}

async function resolveAuthHeader(
  url: string,
  auth: OPDSAuthCredentials,
  wwwAuth: string | null,
  method: string,
): Promise<string> {
  if (wwwAuth?.toLowerCase().startsWith('digest')) {
    const urlObj = new URL(url);
    return createDigestAuth(
      auth.username,
      auth.password,
      wwwAuth,
      method,
      urlObj.pathname + urlObj.search,
    );
  }
  return createBasicAuth(auth.username, auth.password);
}

// --- Platform-specific fetch ---

async function platformFetch(url: string, init: RequestInit): Promise<Response> {
  if (isTauriAppPlatform()) {
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
    return tauriFetch(url, init);
  }
  return globalThis.fetch(url, init);
}

// --- Main HTTP client ---

/**
 * Fetch an OPDS resource with authentication, proxy routing, and timeout handling.
 */
export async function opdsFetch(url: string, options: OPDSHttpOptions = {}): Promise<Response> {
  const {
    auth,
    timeout = OPDS_TIMEOUTS.FEED_FETCH,
    signal,
    headers = {},
    method = 'GET',
  } = options;

  // Extract credentials from URL if present
  const { url: cleanUrl, username: urlUser, password: urlPass } = extractCredentialsFromURL(url);
  const finalAuth = auth ?? (urlUser && urlPass ? { username: urlUser, password: urlPass } : null);

  // Build headers
  const reqHeaders: Record<string, string> = {
    'User-Agent': READEST_OPDS_USER_AGENT,
    Accept: 'application/atom+xml, application/opds+json, application/xml, text/xml, */*',
    ...headers,
  };

  // Add preemptive Basic auth if credentials provided
  if (finalAuth) {
    const basicAuth = createBasicAuth(finalAuth.username, finalAuth.password);
    if (needsProxy(cleanUrl)) {
      // Proxy reads X-OPDS-Auth and forwards as Authorization to upstream
      reqHeaders['X-OPDS-Auth'] = basicAuth;
    } else {
      reqHeaders['Authorization'] = basicAuth;
    }
  }

  // Set up timeout with proper signal combination
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  const combinedSignal = signal
    ? combineAbortSignals(signal, controller.signal)
    : controller.signal;

  try {
    const useProxy = needsProxy(cleanUrl);
    const fetchUrl = useProxy ? getProxiedURL(cleanUrl) : cleanUrl;

    let res = await platformFetch(fetchUrl, {
      method,
      headers: reqHeaders,
      signal: combinedSignal,
    });

    // Handle auth challenge (401/403)
    if (!res.ok && (res.status === 401 || res.status === 403) && finalAuth) {
      const wwwAuth = res.headers.get('WWW-Authenticate');
      const authHeader = await resolveAuthHeader(cleanUrl, finalAuth, wwwAuth, method);
      if (useProxy) {
        reqHeaders['X-OPDS-Auth'] = authHeader;
      } else {
        reqHeaders['Authorization'] = authHeader;
      }

      res = await platformFetch(fetchUrl, {
        method,
        headers: reqHeaders,
        signal: combinedSignal,
      });
    }

    return res;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Probe a URL to determine authentication requirements.
 * Throws on network errors rather than returning a false negative.
 */
export async function probeAuth(
  url: string,
  auth?: OPDSAuthCredentials | null,
): Promise<OPDSAuthProbeResult> {
  const res = await opdsFetch(url, {
    method: 'HEAD',
    auth,
    timeout: OPDS_TIMEOUTS.AUTH_PROBE,
  });

  if (res.status === 401 || res.status === 403) {
    const wwwAuth = res.headers.get('WWW-Authenticate');
    if (wwwAuth?.toLowerCase().startsWith('digest')) {
      return { requiresAuth: true, authType: 'digest' };
    }
    return { requiresAuth: true, authType: 'basic' };
  }

  return { requiresAuth: false };
}

/**
 * Extract filename from Content-Disposition header.
 */
export function parseFilenameFromHeaders(headers: Headers): string {
  const contentDisposition = headers.get('content-disposition');
  if (!contentDisposition) return '';

  // Try RFC 6266 extended notation first
  const extendedMatch = contentDisposition.match(
    /filename\*\s*=\s*(?:utf-8|UTF-8)'[^']*'([^;\s]+)/i,
  );
  if (extendedMatch?.[1]) return decodeURIComponent(extendedMatch[1]);

  // Fall back to plain filename
  const plainMatch = contentDisposition.match(/filename\s*=\s*["']?([^"';\s]+)["']?/i);
  if (plainMatch?.[1]) return decodeURIComponent(plainMatch[1]);

  return '';
}

// --- Internal helpers ---

function combineAbortSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  // Use native AbortSignal.any() when available (modern browsers)
  if ('any' in AbortSignal) {
    return AbortSignal.any([a, b]);
  }

  // Fallback with proper cleanup
  const controller = new AbortController();
  const onAbort = () => {
    controller.abort();
    a.removeEventListener('abort', onAbort);
    b.removeEventListener('abort', onAbort);
  };
  if (a.aborted || b.aborted) {
    controller.abort();
    return controller.signal;
  }
  a.addEventListener('abort', onAbort);
  b.addEventListener('abort', onAbort);
  return controller.signal;
}
