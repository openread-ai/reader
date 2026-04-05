'use client';

import { Button } from '@/components/primitives/button';
import { useTranslation } from '@/hooks/useTranslation';
import { CheckCircle } from 'lucide-react';

function formatLongDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

interface CancelConfirmationProps {
  endDate: Date | null;
  onClose: () => void;
}

export function CancelConfirmation({ endDate, onClose }: CancelConfirmationProps) {
  const _ = useTranslation();

  return (
    <div className='space-y-4'>
      <div className='bg-info/5 border-info/20 rounded-lg border p-4'>
        <div className='flex items-start gap-3'>
          <div className='bg-info/10 rounded-full p-2'>
            <CheckCircle className='text-info h-5 w-5' aria-hidden='true' />
          </div>
          <div className='space-y-2'>
            <p className='text-base-content font-semibold'>
              {_('Your subscription has been canceled')}
            </p>
            {endDate ? (
              <p className='text-base-content/60 text-sm'>
                {_(
                  "Your plan will remain active until {{date}}. After that, you'll be on the Free plan.",
                  {
                    date: formatLongDate(endDate),
                  },
                )}
              </p>
            ) : (
              <p className='text-base-content/60 text-sm'>
                {_(
                  "Your plan will remain active until the end of your current billing period. After that, you'll be on the Free plan.",
                )}
              </p>
            )}
            <p className='text-base-content/60 text-sm'>
              {_(
                'You can resubscribe at any time to restore full access. No data will be deleted.',
              )}
            </p>
          </div>
        </div>
      </div>

      <div className='flex justify-end'>
        <Button onClick={onClose}>{_('Done')}</Button>
      </div>
    </div>
  );
}
