/**
 * Boost Manager — AI message boost pack consumption.
 *
 * One-time boost packs add extra AI messages beyond a user's monthly limit.
 * Boosts expire 30 days after purchase and are consumed FIFO (oldest first).
 *
 * Available to Reader and Pro tiers only (can_boost = true).
 */

import { createSupabaseAdminClient } from '@/utils/supabase';
import { createLogger } from '@/utils/logger';

const log = createLogger('boost-manager');

export interface BoostPurchase {
  id: string;
  user_id: string;
  messages_added: number;
  messages_remaining: number;
  purchased_at: string;
  expires_at: string;
  source: string;
  source_transaction_id: string | null;
}

/**
 * Get all active (non-expired, messages_remaining > 0) boosts for a user,
 * ordered by purchased_at ASC (oldest first — FIFO consumption).
 */
export async function getActiveBoosts(userId: string): Promise<BoostPurchase[]> {
  const supabase = createSupabaseAdminClient();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from('boost_purchases')
    .select('*')
    .eq('user_id', userId)
    .gt('messages_remaining', 0)
    .gt('expires_at', now)
    .order('purchased_at', { ascending: true });

  if (error) {
    log.error('Failed to fetch active boosts:', error.message);
    return [];
  }

  return (data as BoostPurchase[]) || [];
}

/**
 * Get the total remaining boost messages across all active boosts.
 */
export async function getBoostBalance(userId: string): Promise<number> {
  const boosts = await getActiveBoosts(userId);
  return boosts.reduce((sum, b) => sum + b.messages_remaining, 0);
}

/**
 * Check whether a user has any active boost messages.
 */
export async function hasBoostMessages(userId: string): Promise<boolean> {
  const supabase = createSupabaseAdminClient();
  const now = new Date().toISOString();

  const { count, error } = await supabase
    .from('boost_purchases')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gt('messages_remaining', 0)
    .gt('expires_at', now);

  if (error) {
    log.error('Failed to check boost messages:', error.message);
    return false;
  }

  return (count ?? 0) > 0;
}

/** Maximum retry attempts for optimistic-lock decrement. */
const MAX_RETRIES = 3;

/**
 * Consume one message from the user's oldest active boost (FIFO).
 *
 * Uses an optimistic lock pattern: reads the current messages_remaining,
 * then attempts an UPDATE with a WHERE clause matching the expected value.
 * If another request decremented in between, we retry up to MAX_RETRIES times.
 *
 * Returns true if a boost message was consumed, false if no active boosts remain.
 */
export async function consumeBoostMessage(userId: string): Promise<boolean> {
  const supabase = createSupabaseAdminClient();

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const now = new Date().toISOString();

    // Get the oldest active boost
    const { data: boosts, error: fetchError } = await supabase
      .from('boost_purchases')
      .select('id, messages_remaining')
      .eq('user_id', userId)
      .gt('messages_remaining', 0)
      .gt('expires_at', now)
      .order('purchased_at', { ascending: true })
      .limit(1);

    if (fetchError) {
      log.error('Failed to fetch boost for consumption:', fetchError.message);
      return false;
    }

    if (!boosts || boosts.length === 0) {
      return false; // No active boosts
    }

    const boost = boosts[0]!;
    const expectedRemaining = boost.messages_remaining;

    // Attempt atomic decrement with optimistic lock
    const { data: updated, error: updateError } = await supabase
      .from('boost_purchases')
      .update({ messages_remaining: expectedRemaining - 1 })
      .eq('id', boost.id)
      .eq('messages_remaining', expectedRemaining)
      .select('id')
      .single();

    if (updateError) {
      // If the update matched no rows, another request decremented first — retry
      if (updateError.code === 'PGRST116') {
        log.info(`Optimistic lock miss on boost ${boost.id}, retrying (attempt ${attempt + 1})`);
        continue;
      }
      log.error('Failed to consume boost message:', updateError.message);
      return false;
    }

    if (updated) {
      log.info(`Consumed boost message from ${boost.id}, remaining: ${expectedRemaining - 1}`);
      return true;
    }

    // No row matched — retry
    log.info(`Optimistic lock miss on boost ${boost.id}, retrying (attempt ${attempt + 1})`);
  }

  log.warn(`Failed to consume boost after ${MAX_RETRIES} attempts for user ${userId}`);
  return false;
}

/**
 * Insert a new boost purchase record. Called from the Stripe webhook
 * when a boost product checkout completes.
 */
export async function createBoostPurchase(
  userId: string,
  messagesAdded: number,
  sourceTransactionId: string,
  source = 'stripe',
): Promise<BoostPurchase | null> {
  const supabase = createSupabaseAdminClient();

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);

  const { data, error } = await supabase
    .from('boost_purchases')
    .insert({
      user_id: userId,
      messages_added: messagesAdded,
      messages_remaining: messagesAdded,
      expires_at: expiresAt.toISOString(),
      source,
      source_transaction_id: sourceTransactionId,
    })
    .select('*')
    .single();

  if (error) {
    log.error('Failed to create boost purchase:', error.message);
    return null;
  }

  log.info(`Boost purchase created: ${messagesAdded} messages for user ${userId}`);
  return data as BoostPurchase;
}
