'use client';

import { Button } from '@/components/primitives/button';
import { useTranslation } from '@/hooks/useTranslation';
import { Gift } from 'lucide-react';

interface RetentionOfferProps {
  onKeep: () => void;
  onProceed: () => void;
  isApplyingCoupon: boolean;
}

export function RetentionOffer({ onKeep, onProceed, isApplyingCoupon }: RetentionOfferProps) {
  const _ = useTranslation();

  return (
    <div className='space-y-4'>
      <div className='bg-success/5 border-success/20 rounded-lg border p-4'>
        <div className='flex items-start gap-3'>
          <div className='bg-success/10 rounded-full p-2'>
            <Gift className='text-success h-5 w-5' aria-hidden='true' />
          </div>
          <div className='space-y-1'>
            <p className='text-base-content font-semibold'>
              {_('Special offer: 20% off your next month')}
            </p>
            <p className='text-base-content/60 text-sm'>
              {_(
                "We'd love to keep you around! Stay on your current plan and get 20% off your next billing cycle.",
              )}
            </p>
          </div>
        </div>
      </div>

      <div className='flex flex-col gap-2 sm:flex-row sm:justify-end'>
        <Button variant='outline' onClick={onProceed} disabled={isApplyingCoupon}>
          {_('Continue canceling')}
        </Button>
        <Button onClick={onKeep} disabled={isApplyingCoupon}>
          {isApplyingCoupon ? _('Applying discount...') : _('Keep my plan - 20% off')}
        </Button>
      </div>
    </div>
  );
}
