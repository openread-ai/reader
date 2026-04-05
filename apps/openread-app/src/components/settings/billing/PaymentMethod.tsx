'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/card';
import { Skeleton } from '@/components/primitives/skeleton';
import { useTranslation } from '@/hooks/useTranslation';
import { CreditCard } from 'lucide-react';

export interface PaymentMethodData {
  /** 'stripe' | 'apple' | 'google' */
  source: string;
  /** Last 4 digits of card (Stripe only) */
  last4?: string;
  /** Card expiry, e.g. "12/27" (Stripe only) */
  expiry?: string;
  /** Card brand, e.g. "Visa", "Mastercard" (Stripe only) */
  brand?: string;
}

interface PaymentMethodProps {
  paymentMethod?: PaymentMethodData | null;
  isLoading?: boolean;
}

export function PaymentMethod({ paymentMethod, isLoading }: PaymentMethodProps) {
  const _ = useTranslation();

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className='h-5 w-36' />
        </CardHeader>
        <CardContent>
          <Skeleton className='h-10 w-64' />
        </CardContent>
      </Card>
    );
  }

  if (!paymentMethod) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{_('Payment Method')}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className='text-base-content/60 text-sm'>{_('No payment method on file')}</p>
        </CardContent>
      </Card>
    );
  }

  const isIAP = paymentMethod.source === 'apple' || paymentMethod.source === 'google';

  return (
    <Card>
      <CardHeader>
        <CardTitle>{_('Payment Method')}</CardTitle>
      </CardHeader>
      <CardContent>
        {isIAP ? (
          <div className='flex items-center gap-3'>
            <CreditCard className='text-base-content/40 h-5 w-5' aria-hidden='true' />
            <p className='text-base-content text-sm'>
              {paymentMethod.source === 'apple'
                ? _('Managed by Apple')
                : _('Managed by Google Play')}
            </p>
          </div>
        ) : (
          <div className='flex items-center gap-3'>
            <CreditCard className='text-base-content/40 h-5 w-5' aria-hidden='true' />
            <div>
              <p className='text-base-content text-sm font-medium'>
                {paymentMethod.brand ?? _('Card')} {_('ending in')} {paymentMethod.last4 ?? '****'}
              </p>
              {paymentMethod.expiry && (
                <p className='text-base-content/60 text-xs'>
                  {_('Expires')} {paymentMethod.expiry}
                </p>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
