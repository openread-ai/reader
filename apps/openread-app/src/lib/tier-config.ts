/**
 * Database-driven tier configuration.
 *
 * Reads from the `tier_config` Supabase table (append-only).
 * Latest row by created_at is the active config.
 * Caches in memory for 5 minutes.
 * Falls back to hardcoded defaults if DB is unreachable.
 */

import type { UserPlan } from '@/types/quota';
import { createSupabaseAdminClient } from '@/utils/supabase';
import { createLogger } from '@/utils/logger';

const log = createLogger('tier-config');

// ─── Types ───────────────────────────────────────────────────────────

export interface TierDefinition {
  /** Messages allowed per time window. null = unlimited. */
  ai_messages_per_window: number | null;
  /** Time window in hours for AI message limit reset. */
  ai_window_hours: number;
  /** Rate limit: max messages per rate window. null = no rate limit (use window only). */
  ai_rate_limit: number | null;
  /** Rate window in hours. Only applies when ai_rate_limit is set. */
  ai_rate_window_hours: number | null;
  /** Model to fall back to when window limit is hit. null = hard stop (free tier). */
  ai_fallback_model: string | null;
  storage_gb: number;
  library_limit: number | null;
  can_tts: boolean;
  can_sync: boolean;
  can_translate: boolean;
  can_byok: boolean;
  can_boost: boolean;
  early_access: boolean;
  ai_model_tier: 'basic' | 'standard' | 'premium';
  ai_models: string[];
  display_price_cents: number;
  display_annual_price_cents: number;
  display_name: string;
}

export interface RegionalPricingEntry {
  currency: string;
  symbol: string;
  reader: number;
  pro: number;
}

export interface StorageAddon {
  gb: number;
  price_cents: number;
  mobile_price_cents: number;
}

export interface BoostOption {
  messages: number;
  price_cents: number;
  mobile_price_cents: number;
  label: string;
}

export interface CostRates {
  ai_per_message: Record<string, number>;
  storage_per_gb_month: number;
  infra_fixed_month: number;
  payment_processing_rate: number;
}

export interface TierConfig {
  tiers: Record<UserPlan, TierDefinition>;
  regional_pricing: Record<string, RegionalPricingEntry>;
  storage_addons: StorageAddon[];
  boosts: BoostOption[];
  ai_budget_ceiling: number;
  max_agent_steps: number;
  cost_rates: CostRates;
}

// ─── Hardcoded Fallback (used when DB is unreachable) ────────────────

const FALLBACK_CONFIG: TierConfig = {
  tiers: {
    free: {
      ai_messages_per_window: 10,
      ai_window_hours: 24,
      ai_rate_limit: 2,
      ai_rate_window_hours: 2,
      ai_fallback_model: null, // hard stop — upgrade prompt
      storage_gb: 0,
      library_limit: 10,
      can_tts: false,
      can_sync: false,
      can_translate: false,
      can_byok: false,
      can_boost: false,
      early_access: false,
      ai_model_tier: 'basic',
      ai_models: ['openai/gpt-oss-20b'],
      display_price_cents: 0,
      display_annual_price_cents: 0,
      display_name: 'Free',
    },
    reader: {
      ai_messages_per_window: 50,
      ai_window_hours: 3,
      ai_rate_limit: null,
      ai_rate_window_hours: null,
      ai_fallback_model: 'openai/gpt-oss-20b', // degrades to free-tier model
      storage_gb: 5,
      library_limit: null,
      can_tts: true,
      can_sync: true,
      can_translate: false,
      can_byok: true,
      can_boost: true,
      early_access: false,
      ai_model_tier: 'standard',
      ai_models: ['openai/gpt-oss-120b', 'google/gemini-2.5-flash-lite'],
      display_price_cents: 999,
      display_annual_price_cents: 9999,
      display_name: 'Reader',
    },
    pro: {
      ai_messages_per_window: 100,
      ai_window_hours: 3,
      ai_rate_limit: null,
      ai_rate_window_hours: null,
      ai_fallback_model: 'openai/gpt-oss-120b', // degrades to reader-tier model
      storage_gb: 10,
      library_limit: null,
      can_tts: true,
      can_sync: true,
      can_translate: true,
      can_byok: true,
      can_boost: true,
      early_access: true,
      ai_model_tier: 'premium',
      ai_models: ['anthropic/claude-haiku-4.5', 'openai/gpt-4.1-mini'],
      display_price_cents: 1999,
      display_annual_price_cents: 19999,
      display_name: 'Pro',
    },
  },
  regional_pricing: {
    IN: { currency: 'INR', symbol: '\u20B9', reader: 349, pro: 699 },
    BR: { currency: 'BRL', symbol: 'R$', reader: 29.99, pro: 59.99 },
  },
  storage_addons: [
    { gb: 5, price_cents: 199, mobile_price_cents: 299 },
    { gb: 10, price_cents: 299, mobile_price_cents: 399 },
    { gb: 25, price_cents: 499, mobile_price_cents: 699 },
    { gb: 50, price_cents: 799, mobile_price_cents: 1099 },
  ],
  boosts: [
    { messages: 50, price_cents: 499, mobile_price_cents: 699, label: 'Small' },
    { messages: 200, price_cents: 1999, mobile_price_cents: 2599, label: 'Medium' },
    { messages: 500, price_cents: 3499, mobile_price_cents: 4499, label: 'Large' },
  ],
  ai_budget_ceiling: 12000,
  max_agent_steps: 12,
  cost_rates: {
    ai_per_message: { free: 0.001, reader: 0.002, pro: 0.004 },
    storage_per_gb_month: 0.000015,
    infra_fixed_month: 30,
    payment_processing_rate: 0.1,
  },
};

// ─── Cache ───────────────────────────────────────────────────────────

let cachedConfig: TierConfig | null = null;
let cachedAt = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Get the active tier configuration. Reads from DB with 5-minute cache.
 * Falls back to FALLBACK_CONFIG if DB is unreachable or table is empty.
 */
export async function getTierConfig(): Promise<TierConfig> {
  const now = Date.now();
  if (cachedConfig && now - cachedAt < CACHE_TTL) {
    return cachedConfig;
  }

  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from('tier_config')
      .select('config')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !data?.config) {
      log.warn('Failed to read tier_config from DB, using fallback:', error?.message);
      cachedConfig = FALLBACK_CONFIG;
    } else {
      cachedConfig = data.config as TierConfig;
    }
  } catch (err) {
    log.warn('Exception reading tier_config, using fallback:', err);
    cachedConfig = FALLBACK_CONFIG;
  }

  cachedAt = now;
  return cachedConfig!;
}

/**
 * Get the configuration for a specific tier.
 * Falls back to the 'free' tier definition if the plan is unknown.
 */
export async function getTierDefinition(plan: UserPlan): Promise<TierDefinition> {
  const config = await getTierConfig();
  return config.tiers[plan] || config.tiers.free;
}

/**
 * Get regional pricing for a country code (ISO 3166-1 alpha-2).
 * Falls back to USD defaults derived from tier display prices.
 */
export async function getRegionalPricing(countryCode: string): Promise<RegionalPricingEntry> {
  const config = await getTierConfig();
  return (
    config.regional_pricing[countryCode?.toUpperCase()] || {
      currency: 'USD',
      symbol: '$',
      reader: config.tiers.reader.display_price_cents / 100,
      pro: config.tiers.pro.display_price_cents / 100,
    }
  );
}

/**
 * Force-clear the cache. Useful after an INSERT into tier_config.
 */
export function invalidateTierConfigCache(): void {
  cachedConfig = null;
  cachedAt = 0;
}

/**
 * Get the fallback config (for testing or when DB is explicitly not available).
 */
export function getFallbackConfig(): TierConfig {
  return FALLBACK_CONFIG;
}
