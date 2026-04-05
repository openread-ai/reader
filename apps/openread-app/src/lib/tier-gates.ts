/**
 * Client-safe feature gate definitions per tier.
 *
 * These mirror the `can_*` flags from the `tier_config` Supabase table
 * (see `lib/tier-config.ts` for the server-side source of truth).
 *
 * When the DB config changes, update these values to match.
 * Eventually this could be fetched from an API route, but for now
 * the fallback values are kept in sync manually.
 */

import type { UserPlan } from '@/types/quota';
import { getFallbackConfig } from '@/lib/tier-config';

export interface TierGates {
  can_tts: boolean;
  can_sync: boolean;
  can_translate: boolean;
  can_byok: boolean;
  can_boost: boolean;
}

const TIER_GATES: Record<UserPlan, TierGates> = {
  free: {
    can_tts: false,
    can_sync: false,
    can_translate: false,
    can_byok: false,
    can_boost: false,
  },
  reader: {
    can_tts: true,
    can_sync: true,
    can_translate: false,
    can_byok: true,
    can_boost: true,
  },
  pro: {
    can_tts: true,
    can_sync: true,
    can_translate: true,
    can_byok: true,
    can_boost: true,
  },
};

/**
 * Get feature gates for a plan. Falls back to free tier for unknown plans.
 */
export function getTierGates(plan: UserPlan): TierGates {
  return TIER_GATES[plan] || TIER_GATES.free;
}

export type GatedFeature = 'tts' | 'sync' | 'translate' | 'byok' | 'boost';

const FEATURE_TO_GATE_KEY: Record<GatedFeature, keyof TierGates> = {
  tts: 'can_tts',
  sync: 'can_sync',
  translate: 'can_translate',
  byok: 'can_byok',
  boost: 'can_boost',
};

/** The minimum tier required for each feature */
const FEATURE_REQUIRED_TIER: Record<GatedFeature, UserPlan> = {
  tts: 'reader',
  sync: 'reader',
  translate: 'pro',
  byok: 'reader',
  boost: 'reader',
};

/** Human-readable tier display names */
const TIER_DISPLAY_NAMES: Record<UserPlan, string> = {
  free: 'Free',
  reader: 'Reader',
  pro: 'Pro',
};

export interface FeatureGateResult {
  /** Whether the current plan allows this feature */
  allowed: boolean;
  /** The minimum tier required to use this feature */
  requiredTier: UserPlan;
  /** Display name for the required tier (e.g. "Reader", "Pro") */
  requiredTierName: string;
  /** Upgrade message for the feature */
  message: string;
  /** Monthly price display string for the required tier (e.g. "$9.99/mo") */
  priceDisplay: string;
  /** Full CTA text with tier name and price (e.g. "Start Reading — $9.99/mo") */
  ctaText: string;
}

/**
 * Format cents as a monthly price string (e.g. 999 -> "$9.99/mo").
 * Returns an empty string for 0 cents (free tier).
 */
export function formatPriceDisplay(priceCents: number): string {
  if (priceCents <= 0) return '';
  return `$${(priceCents / 100).toFixed(2)}/mo`;
}

/**
 * Check whether a specific feature is allowed for a given plan.
 */
export function checkFeatureGate(feature: GatedFeature, plan: UserPlan): FeatureGateResult {
  const gates = getTierGates(plan);
  const gateKey = FEATURE_TO_GATE_KEY[feature];
  const allowed = gates[gateKey];
  const requiredTier = FEATURE_REQUIRED_TIER[feature];
  const requiredTierName = TIER_DISPLAY_NAMES[requiredTier];

  const featureLabels: Record<GatedFeature, string> = {
    tts: 'Text-to-Speech',
    sync: 'Cloud Sync',
    translate: 'Translation',
    byok: 'Bring Your Own Key',
    boost: 'AI Boosts',
  };

  const message = allowed ? '' : `${featureLabels[feature]} is available on ${requiredTierName}.`;

  // Pull price from the client-safe fallback config
  const config = getFallbackConfig();
  const tierDef = config.tiers[requiredTier] ?? config.tiers.free;
  const priceDisplay = formatPriceDisplay(tierDef.display_price_cents);
  const ctaText = allowed ? '' : `Start ${requiredTierName} \u2014 ${priceDisplay}`;

  return { allowed, requiredTier, requiredTierName, message, priceDisplay, ctaText };
}
