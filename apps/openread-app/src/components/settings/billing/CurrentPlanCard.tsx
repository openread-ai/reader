'use client';

import { useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/primitives/card';
import { Button } from '@/components/primitives/button';
import { Skeleton } from '@/components/primitives/skeleton';
import { CancelSubscriptionDialog } from '@/components/settings/cancel-subscription-dialog';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/utils/tailwind';
import { CreditCard, ExternalLink } from 'lucide-react';
import type { Subscription } from '@/hooks/useSubscription';

function formatShortDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

interface CurrentPlanCardProps {
  subscription: Subscription | null;
  isLoading?: boolean;
  onManagePlan: () => Promise<void>;
}

const sourceLabels: Record<string, string> = {
  stripe: 'Stripe',
  apple: 'Apple',
  google: 'Google Play',
};

const statusStyles: Record<Subscription['status'], string> = {
  active: 'bg-success/10 text-success',
  trialing: 'bg-info/10 text-info',
  canceled: 'bg-warning/10 text-warning',
  past_due: 'bg-error/10 text-error',
};

export function CurrentPlanCard({ subscription, isLoading, onManagePlan }: CurrentPlanCardProps) {
  const _ = useTranslation();
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [isManaging, setIsManaging] = useState(false);

  const handleManage = async () => {
    setIsManaging(true);
    try {
      await onManagePlan();
    } finally {
      setIsManaging(false);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className='h-6 w-32' />
          <Skeleton className='mt-1 h-4 w-48' />
        </CardHeader>
        <CardContent>
          <Skeleton className='h-20 w-full' />
        </CardContent>
      </Card>
    );
  }

  // Free plan — simplified view
  if (!subscription || subscription.planId === 'free') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{_('Current Plan')}</CardTitle>
          <CardDescription>{_("You're on the Free plan")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className='flex items-center justify-between'>
            <p className='text-base-content/60 text-sm'>
              {_('Basic features with limited cloud storage')}
            </p>
            <Button variant='default' size='sm' asChild>
              <a href='/settings/billing#plans'>
                {_('Upgrade')}
                <ExternalLink className='ml-1 h-3 w-3' aria-hidden='true' />
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const billingSource = sourceLabels.stripe; // Default to Stripe for web
  const nextBillingLabel = subscription.currentPeriodEnd
    ? subscription.cancelAtPeriodEnd
      ? _('Cancels on {{date}}', { date: formatShortDate(subscription.currentPeriodEnd) })
      : _('Next billing: {{date}}', { date: formatShortDate(subscription.currentPeriodEnd) })
    : _('Active subscription');

  return (
    <>
      <Card>
        <CardHeader>
          <div className='flex items-center justify-between'>
            <div>
              <CardTitle>{_('Current Plan')}</CardTitle>
              <CardDescription>{nextBillingLabel}</CardDescription>
            </div>
            <span
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium',
                statusStyles[subscription.status],
              )}
            >
              {subscription.status === 'trialing' ? _('Trial') : _(subscription.status)}
            </span>
          </div>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='flex items-center gap-4'>
            <p className='text-base-content text-2xl font-bold'>{subscription.planName}</p>
            <span className='text-base-content/40 text-xs'>
              {_('via {{source}}', { source: billingSource })}
            </span>
          </div>

          <div className='flex flex-wrap gap-2'>
            <Button variant='outline' size='sm' onClick={handleManage} disabled={isManaging}>
              <CreditCard className='mr-2 h-4 w-4' aria-hidden='true' />
              {isManaging ? _('Loading...') : _('Manage Plan')}
            </Button>

            {!subscription.cancelAtPeriodEnd && (
              <Button
                variant='ghost'
                size='sm'
                className='text-base-content/60'
                onClick={() => setShowCancelDialog(true)}
              >
                {_('Cancel')}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <CancelSubscriptionDialog
        open={showCancelDialog}
        onOpenChange={setShowCancelDialog}
        periodEnd={subscription.currentPeriodEnd}
      />
    </>
  );
}
