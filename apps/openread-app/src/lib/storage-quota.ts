/**
 * Storage Quota Manager — cloud storage tracking for user accounts.
 *
 * Each tier has a base storage allocation (from tier_config).
 * Paid users can purchase recurring storage add-ons for additional capacity.
 * Storage usage is tracked atomically via DB RPCs to prevent race conditions.
 *
 * Available to Reader and Pro tiers (free tier has 0 GB base).
 */

import { createSupabaseAdminClient } from '@/utils/supabase';
import { getTierDefinition } from '@/lib/tier-config';
import { createLogger } from '@/utils/logger';
import type { UserPlan } from '@/types/quota';

const log = createLogger('storage-quota');

// ─── Types ───────────────────────────────────────────────────────────

export interface StorageQuota {
  /** Base storage in GB from the user's tier */
  baseGb: number;
  /** Additional storage in GB from active add-ons */
  addonGb: number;
  /** Total available storage in bytes (base + addons) */
  totalBytes: number;
  /** Storage currently used in bytes */
  usedBytes: number;
  /** Remaining available storage in bytes */
  availableBytes: number;
  /** Usage as a percentage (0-100+, can exceed 100 if over limit) */
  percentUsed: number;
  /** Whether the user has exceeded their total storage limit */
  isOverLimit: boolean;
}

export interface StorageAddonRecord {
  id: string;
  user_id: string;
  gb_amount: number;
  price_cents: number;
  source: string;
  source_subscription_id: string | null;
  status: string;
  created_at: string;
  canceled_at: string | null;
}

// ─── Constants ───────────────────────────────────────────────────────

const BYTES_PER_GB = 1024 * 1024 * 1024;

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Calculate the full storage quota for a user, combining tier base storage
 * with any active storage add-ons, and current usage.
 */
export async function getStorageQuota(userId: string, plan: UserPlan): Promise<StorageQuota> {
  const supabase = createSupabaseAdminClient();
  const tierDef = await getTierDefinition(plan);

  // Get active add-ons
  const { data: addons, error: addonsError } = await supabase
    .from('storage_addons')
    .select('gb_amount')
    .eq('user_id', userId)
    .eq('status', 'active');

  if (addonsError) {
    log.warn('Failed to fetch storage addons:', addonsError.message);
  }

  const addonGb = (addons || []).reduce(
    (sum: number, a: { gb_amount: number }) => sum + a.gb_amount,
    0,
  );
  const baseGb = tierDef.storage_gb;
  const totalBytes = (baseGb + addonGb) * BYTES_PER_GB;

  // Get used bytes from plans table
  const { data: planData, error: planError } = await supabase
    .from('plans')
    .select('storage_used_bytes')
    .eq('id', userId)
    .single();

  if (planError) {
    log.warn('Failed to fetch storage usage:', planError.message);
  }

  const usedBytes = planData?.storage_used_bytes || 0;

  return {
    baseGb,
    addonGb,
    totalBytes,
    usedBytes,
    availableBytes: Math.max(0, totalBytes - usedBytes),
    percentUsed: totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0,
    isOverLimit: usedBytes > totalBytes,
  };
}

/**
 * Get all active storage add-ons for a user.
 */
export async function getActiveAddons(userId: string): Promise<StorageAddonRecord[]> {
  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase
    .from('storage_addons')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: true });

  if (error) {
    log.error('Failed to fetch active storage addons:', error.message);
    return [];
  }

  return (data as StorageAddonRecord[]) || [];
}

/**
 * Get the total add-on storage in GB for a user.
 */
export async function getAddonStorageGb(userId: string): Promise<number> {
  const addons = await getActiveAddons(userId);
  return addons.reduce((sum, a) => sum + a.gb_amount, 0);
}

/**
 * Atomically increment storage_used_bytes in the plans table.
 * Called when a file is uploaded to cloud storage.
 *
 * Returns true on success, false on error.
 */
export async function incrementStorageUsed(userId: string, bytes: number): Promise<boolean> {
  const supabase = createSupabaseAdminClient();

  const { error } = await supabase.rpc('increment_storage_used', {
    p_user_id: userId,
    p_bytes: bytes,
  });

  if (error) {
    log.error('Failed to increment storage used:', error.message);
    return false;
  }

  return true;
}

/**
 * Atomically decrement storage_used_bytes in the plans table.
 * Called when a file is deleted from cloud storage.
 * The DB function clamps to 0 — it will never go negative.
 *
 * Returns true on success, false on error.
 */
export async function decrementStorageUsed(userId: string, bytes: number): Promise<boolean> {
  const supabase = createSupabaseAdminClient();

  const { error } = await supabase.rpc('decrement_storage_used', {
    p_user_id: userId,
    p_bytes: bytes,
  });

  if (error) {
    log.error('Failed to decrement storage used:', error.message);
    return false;
  }

  return true;
}

/**
 * Create a storage add-on record. Called from the Stripe webhook
 * when a storage add-on subscription is created.
 */
export async function createStorageAddon(
  userId: string,
  gbAmount: number,
  priceCents: number,
  sourceSubscriptionId: string,
  source = 'stripe',
): Promise<StorageAddonRecord | null> {
  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase
    .from('storage_addons')
    .insert({
      user_id: userId,
      gb_amount: gbAmount,
      price_cents: priceCents,
      source,
      source_subscription_id: sourceSubscriptionId,
    })
    .select('*')
    .single();

  if (error) {
    log.error('Failed to create storage addon:', error.message);
    return null;
  }

  log.info(`Storage addon created: ${gbAmount}GB for user ${userId}`);
  return data as StorageAddonRecord;
}

/**
 * Cancel a storage add-on by ID. Sets status to 'canceled' and records timestamp.
 * Called when a Stripe subscription is canceled.
 */
export async function cancelStorageAddon(addonId: string): Promise<boolean> {
  const supabase = createSupabaseAdminClient();

  const { error } = await supabase
    .from('storage_addons')
    .update({
      status: 'canceled',
      canceled_at: new Date().toISOString(),
    })
    .eq('id', addonId);

  if (error) {
    log.error('Failed to cancel storage addon:', error.message);
    return false;
  }

  log.info(`Storage addon ${addonId} canceled`);
  return true;
}
