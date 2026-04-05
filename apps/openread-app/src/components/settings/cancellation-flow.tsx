'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/primitives/dialog';
import { RetentionOffer } from './retention-offer';
import { PreCancelPrompt } from './pre-cancel-prompt';
import { CancelSurvey, type CancelSurveyData } from './cancel-survey';
import { CancelConfirmation } from './cancel-confirmation';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
import { getAPIBaseUrl } from '@/services/environment';
import { getAccessToken } from '@/utils/access';
import { createLogger } from '@/utils/logger';
import type { PaymentProvider } from '@/types/payment';

const logger = createLogger('cancellation-flow');

type CancelStep = 'retention' | 'survey' | 'confirm';

const APPLE_SUBSCRIPTIONS_URL = 'itms-apps://apps.apple.com/account/subscriptions';
const GOOGLE_SUBSCRIPTIONS_URL = 'https://play.google.com/store/account/subscriptions';

const FEATURES_LOST = [
  'Unlimited library books',
  'Cloud sync across devices',
  'AI-powered book analysis',
  'Text-to-speech (TTS)',
  'Extended translation limits',
  'Priority support',
];

interface CancellationFlowProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: PaymentProvider;
  planName: string;
  periodEnd: Date | null;
}

export function CancellationFlow({
  open,
  onOpenChange,
  source,
  planName,
  periodEnd,
}: CancellationFlowProps) {
  const _ = useTranslation();
  const [step, setStep] = useState<CancelStep>('retention');
  const [isApplyingCoupon, setIsApplyingCoupon] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isStripe = source === 'stripe';

  const handleClose = () => {
    onOpenChange(false);
    // Reset step after dialog animation completes
    setTimeout(() => setStep('retention'), 300);
  };

  const handleApplyCoupon = async () => {
    setIsApplyingCoupon(true);
    try {
      const token = await getAccessToken();
      const response = await fetch(`${getAPIBaseUrl()}/stripe/apply-retention-coupon`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to apply retention coupon');
      }

      eventDispatcher.dispatch('toast', {
        type: 'success',
        message: _('20% discount applied to your next billing cycle!'),
      });
      handleClose();
    } catch (error) {
      logger.error('Failed to apply retention coupon:', error);
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: _('Failed to apply discount. Please try again.'),
      });
    } finally {
      setIsApplyingCoupon(false);
    }
  };

  const submitSurvey = async (data: CancelSurveyData | null) => {
    try {
      const token = await getAccessToken();
      await fetch(`${getAPIBaseUrl()}/billing/cancel-survey`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          reason: data?.reason ?? 'skipped',
          feedback: data?.feedback ?? '',
          source,
        }),
      });
    } catch (error) {
      // Survey storage failure is not critical
      logger.warn('Failed to store cancel survey:', error);
    }
  };

  const handleCancelStripe = async (surveyData: CancelSurveyData | null) => {
    setIsSubmitting(true);
    try {
      await submitSurvey(surveyData);

      const token = await getAccessToken();
      const response = await fetch(`${getAPIBaseUrl()}/stripe/cancel-subscription`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          reason: surveyData?.reason ?? 'skipped',
          feedback: surveyData?.feedback ?? '',
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to cancel subscription');
      }

      setStep('confirm');
    } catch (error) {
      logger.error('Failed to cancel subscription:', error);
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: _('Failed to cancel subscription. Please try again.'),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelIAP = async (surveyData: CancelSurveyData | null) => {
    setIsSubmitting(true);
    try {
      await submitSurvey(surveyData);

      const deepLink = source === 'apple' ? APPLE_SUBSCRIPTIONS_URL : GOOGLE_SUBSCRIPTIONS_URL;

      window.open(deepLink, '_blank');
      setStep('confirm');
    } catch (error) {
      logger.error('Failed to process IAP cancellation:', error);
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: _('Something went wrong. Please try again.'),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = async (surveyData: CancelSurveyData | null) => {
    if (isStripe) {
      await handleCancelStripe(surveyData);
    } else {
      await handleCancelIAP(surveyData);
    }
  };

  const handleSurveySubmit = (data: CancelSurveyData) => {
    handleCancel(data);
  };

  const handleSurveySkip = () => {
    handleCancel(null);
  };

  const stepTitles: Record<CancelStep, string> = {
    retention: _('Before you go...'),
    survey: _('Help us improve'),
    confirm: _('Cancellation confirmed'),
  };

  const stepDescriptions: Record<CancelStep, string> = {
    retention: isStripe
      ? _('We have a special offer for you')
      : _('Please review what you will lose'),
    survey: _('Your feedback helps us build a better product'),
    confirm: _('Your subscription changes have been processed'),
  };

  return (
    <Dialog open={open} onOpenChange={step === 'confirm' ? handleClose : onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>{stepTitles[step]}</DialogTitle>
          <DialogDescription>{stepDescriptions[step]}</DialogDescription>
        </DialogHeader>

        {step === 'retention' &&
          (isStripe ? (
            <RetentionOffer
              onKeep={handleApplyCoupon}
              onProceed={() => setStep('survey')}
              isApplyingCoupon={isApplyingCoupon}
            />
          ) : (
            <PreCancelPrompt
              planName={planName}
              features={FEATURES_LOST}
              onKeep={handleClose}
              onProceed={() => setStep('survey')}
            />
          ))}

        {step === 'survey' && (
          <CancelSurvey
            onSubmit={handleSurveySubmit}
            onSkip={handleSurveySkip}
            isSubmitting={isSubmitting}
          />
        )}

        {step === 'confirm' && <CancelConfirmation endDate={periodEnd} onClose={handleClose} />}
      </DialogContent>
    </Dialog>
  );
}
