/**
 * Secure credential storage for OPDS catalog authentication.
 *
 * Provides platform-adaptive credential storage:
 * - Desktop (Tauri): Uses OS keychain via Tauri plugin
 * - Web: Uses encrypted IndexedDB with AES-GCM
 *
 * Replaces the previous plaintext credential storage in settings.
 */

import { isTauriAppPlatform } from '@/services/environment';
import { createLogger } from '@/utils/logger';

const logger = createLogger('opds-credentials');

export interface OPDSCredentials {
  username: string;
  password: string;
}

export interface SecureCredentialStore {
  get(catalogId: string): Promise<OPDSCredentials | null>;
  set(catalogId: string, credentials: OPDSCredentials): Promise<void>;
  delete(catalogId: string): Promise<void>;
  has(catalogId: string): Promise<boolean>;
}

// --- Tauri keychain implementation ---

const KEYCHAIN_SERVICE = 'openread-opds';

class TauriCredentialStore implements SecureCredentialStore {
  async get(catalogId: string): Promise<OPDSCredentials | null> {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const entry = await invoke<string | null>('plugin:keychain|get', {
        service: KEYCHAIN_SERVICE,
        account: catalogId,
      });
      if (!entry) return null;
      return JSON.parse(entry);
    } catch (e) {
      logger.warn(`Failed to read keychain for catalog "${catalogId}"`, e);
      return null;
    }
  }

  async set(catalogId: string, credentials: OPDSCredentials): Promise<void> {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('plugin:keychain|set', {
        service: KEYCHAIN_SERVICE,
        account: catalogId,
        password: JSON.stringify(credentials),
      });
    } catch (e) {
      logger.warn(`Failed to store keychain entry for catalog "${catalogId}"`, e);
      throw e;
    }
  }

  async delete(catalogId: string): Promise<void> {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('plugin:keychain|delete', {
        service: KEYCHAIN_SERVICE,
        account: catalogId,
      });
    } catch (e) {
      // "Not found" on delete is expected, warn on other errors
      logger.warn(`Failed to delete keychain entry for catalog "${catalogId}"`, e);
    }
  }

  async has(catalogId: string): Promise<boolean> {
    return (await this.get(catalogId)) !== null;
  }
}

// --- Web encrypted IndexedDB implementation ---

const DB_NAME = 'openread-credentials';
const STORE_NAME = 'opds-catalogs';
const KEY_STORE_NAME = 'encryption-keys';
const DB_VERSION = 2;

class WebCredentialStore implements SecureCredentialStore {
  private encryptionKey: CryptoKey | null = null;

  async get(catalogId: string): Promise<OPDSCredentials | null> {
    try {
      const db = await this.openDB();
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const record = await promisifyRequest<{ id: string; data: ArrayBuffer } | undefined>(
        store.get(catalogId),
      );
      db.close();

      if (!record) return null;
      return this.decrypt(record.data);
    } catch (e) {
      logger.warn(`Failed to read credentials for catalog "${catalogId}"`, e);
      return null;
    }
  }

  async set(catalogId: string, credentials: OPDSCredentials): Promise<void> {
    try {
      const encrypted = await this.encrypt(credentials);
      const db = await this.openDB();
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      await promisifyRequest(store.put({ id: catalogId, data: encrypted }));
      db.close();
    } catch (e) {
      logger.warn(`Failed to store credentials for catalog "${catalogId}"`, e);
      throw e;
    }
  }

  async delete(catalogId: string): Promise<void> {
    try {
      const db = await this.openDB();
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      await promisifyRequest(store.delete(catalogId));
      db.close();
    } catch (e) {
      logger.warn(`Failed to delete credentials for catalog "${catalogId}"`, e);
    }
  }

  async has(catalogId: string): Promise<boolean> {
    return (await this.get(catalogId)) !== null;
  }

  private async openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(KEY_STORE_NAME)) {
          db.createObjectStore(KEY_STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private async getEncryptionKey(): Promise<CryptoKey> {
    if (this.encryptionKey) return this.encryptionKey;

    // Store the encryption key directly in IndexedDB as a non-extractable CryptoKey.
    // This avoids storing key material in plaintext localStorage.
    const existingKey = await this.loadKeyFromDB();
    if (existingKey) {
      this.encryptionKey = existingKey;
      return existingKey;
    }

    // Generate a new non-extractable AES-GCM key
    const newKey = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false, // non-extractable
      ['encrypt', 'decrypt'],
    );

    await this.saveKeyToDB(newKey);
    this.encryptionKey = newKey;
    return newKey;
  }

  private async loadKeyFromDB(): Promise<CryptoKey | null> {
    try {
      const db = await this.openDB();
      const tx = db.transaction(KEY_STORE_NAME, 'readonly');
      const store = tx.objectStore(KEY_STORE_NAME);
      const record = await promisifyRequest<{ id: string; key: CryptoKey } | undefined>(
        store.get('encryption-key'),
      );
      db.close();
      return record?.key ?? null;
    } catch (e) {
      logger.warn('Failed to load encryption key from IndexedDB', e);
      return null;
    }
  }

  private async saveKeyToDB(key: CryptoKey): Promise<void> {
    try {
      const db = await this.openDB();
      const tx = db.transaction(KEY_STORE_NAME, 'readwrite');
      const store = tx.objectStore(KEY_STORE_NAME);
      await promisifyRequest(store.put({ id: 'encryption-key', key }));
      db.close();
    } catch (e) {
      logger.error('Failed to save encryption key to IndexedDB — credentials may not persist', e);
      throw e;
    }
  }

  private async encrypt(data: OPDSCredentials): Promise<ArrayBuffer> {
    const key = await this.getEncryptionKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(JSON.stringify(data));
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);

    // Prepend IV to ciphertext
    const result = new Uint8Array(iv.length + encrypted.byteLength);
    result.set(iv);
    result.set(new Uint8Array(encrypted), iv.length);
    return result.buffer;
  }

  private async decrypt(data: ArrayBuffer): Promise<OPDSCredentials> {
    try {
      const key = await this.getEncryptionKey();
      const arr = new Uint8Array(data);
      const iv = arr.slice(0, 12);
      const ciphertext = arr.slice(12);
      const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
      return JSON.parse(new TextDecoder().decode(decrypted));
    } catch (e) {
      logger.error('Failed to decrypt credentials — data may be corrupted', e);
      throw e;
    }
  }
}

// --- In-memory fallback (for testing or when crypto is unavailable) ---

class InMemoryCredentialStore implements SecureCredentialStore {
  private store = new Map<string, OPDSCredentials>();

  async get(catalogId: string): Promise<OPDSCredentials | null> {
    return this.store.get(catalogId) ?? null;
  }

  async set(catalogId: string, credentials: OPDSCredentials): Promise<void> {
    this.store.set(catalogId, { ...credentials });
  }

  async delete(catalogId: string): Promise<void> {
    this.store.delete(catalogId);
  }

  async has(catalogId: string): Promise<boolean> {
    return this.store.has(catalogId);
  }
}

// --- Factory ---

let credentialStoreInstance: SecureCredentialStore | null = null;

/**
 * Get the platform-appropriate credential store singleton.
 */
export function getCredentialStore(): SecureCredentialStore {
  if (credentialStoreInstance) return credentialStoreInstance;

  if (isTauriAppPlatform()) {
    credentialStoreInstance = new TauriCredentialStore();
  } else if (typeof crypto !== 'undefined' && crypto.subtle && typeof indexedDB !== 'undefined') {
    credentialStoreInstance = new WebCredentialStore();
  } else {
    logger.warn(
      'crypto.subtle or IndexedDB unavailable — using in-memory credential store. Credentials will not persist across page reloads.',
    );
    credentialStoreInstance = new InMemoryCredentialStore();
  }

  return credentialStoreInstance;
}

/**
 * Create an in-memory credential store (for testing).
 */
export function createInMemoryCredentialStore(): SecureCredentialStore {
  return new InMemoryCredentialStore();
}

// --- Helper ---

function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
