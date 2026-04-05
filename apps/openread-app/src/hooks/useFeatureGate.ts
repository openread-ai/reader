'use client';

/**
 * @module hooks/useFeatureGate
 * React hook for checking if a specific feature is available
 * based on the user's subscription tier.
 *
 * Uses the tier gate definitions from `lib/tier-gates` which mirror
 * the `can_*` flags in the `tier_config` Supabase table.
 */

import { useMemo } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useQuotaStats } from '@/hooks/useQuotaStats';
import type { UserPlan } from '@/types/quota';
import { checkFeatureGate, type GatedFeature, type FeatureGateResult } from '@/lib/tier-gates';

export type { GatedFeature, FeatureGateResult };

export interface UseFeatureGateReturn extends FeatureGateResult {
  /** Current user plan */
  plan: UserPlan;
  /** Whether the hook is still loading user state */
  isLoading: boolean;
}

/**
 * Hook for checking if a specific feature is gated for the current user.
 *
 * @example
 * ```tsx
 * function TTSButton() {
 *   const { allowed, message } = useFeatureGate('tts');
 *   if (!allowed) {
 *     return <UpgradeInline message={message} />;
 *   }
 *   return <Button onClick={startTTS}>Play</Button>;
 * }
 * ```
 */
export function useFeatureGate(feature: GatedFeature): UseFeatureGateReturn {
  const { user } = useAuth();
  const { userProfilePlan } = useQuotaStats();

  const isLoading = user === undefined;

  const plan: UserPlan = useMemo(() => {
    if (!user) return 'free';
    return userProfilePlan || 'free';
  }, [user, userProfilePlan]);

  const gateResult = useMemo(() => checkFeatureGate(feature, plan), [feature, plan]);

  return {
    ...gateResult,
    plan,
    isLoading,
  };
}

export default useFeatureGate;
