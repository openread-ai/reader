'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { getAPIBaseUrl } from '@/services/environment';
import { getAccessToken } from '@/utils/access';
import { createLogger } from '@/utils/logger';
import type { StorageAddon } from '@/lib/tier-config';

const logger = createLogger('storage-quota');

// ─── Types ───────────────────────────────────────────────────────────

export interface ActiveAddon {
  id: string;
  gb_amount: number;
  price_cents: number;
  source: string;
  created_at: string;
}

export interface StorageQuotaData {
  plan: string;
  base_gb: number;
  addon_gb: number;
  total_bytes: number;
  used_bytes: number;
  available_bytes: number;
  percent_used: number;
  is_over_limit: boolean;
  active_addons: ActiveAddon[];
  available_addons: StorageAddon[];
}

// ─── Hook ────────────────────────────────────────────────────────────

export function useStorageQuota() {
  const { user, token } = useAuth();
  const [quota, setQuota] = useState<StorageQuotaData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchQuota = useCallback(async () => {
    if (!user || !token) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const accessToken = await getAccessToken();
      const response = await fetch(`${getAPIBaseUrl()}/storage/quota`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch storage quota: ${response.status}`);
      }

      const data: StorageQuotaData = await response.json();
      setQuota(data);
    } catch (err) {
      const fetchError = err instanceof Error ? err : new Error('Failed to fetch storage quota');
      logger.error('Storage quota fetch failed:', fetchError);
      setError(fetchError);
    } finally {
      setIsLoading(false);
    }
  }, [user, token]);

  useEffect(() => {
    fetchQuota();
  }, [fetchQuota]);

  return {
    quota,
    isLoading,
    error,
    refetch: fetchQuota,
  };
}
