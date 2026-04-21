/**
 * OPDS services barrel export.
 */

export { OPDSService, type OPDSServiceConfig } from './opdsService';
export {
  opdsFetch,
  probeAuth,
  parseFilenameFromHeaders,
  type OPDSAuthCredentials,
  type OPDSHttpOptions,
  type OPDSDownloadProgress,
  type OPDSAuthProbeResult,
} from './opdsHttp';
export {
  getCredentialStore,
  createInMemoryCredentialStore,
  type SecureCredentialStore,
  type OPDSCredentials,
} from './credentialStore';
export {
  parseOPDS,
  parseAtom,
  parseJson,
  parseOpenSearch,
  expandSearchTemplate,
  detectFormat,
  type OPDSParseResult,
} from './parsers';
export {
  OPDSCacheStore,
  type OPDSCachedFeed,
  type CacheOptions,
  type CacheStats,
} from './opdsCacheStore';
