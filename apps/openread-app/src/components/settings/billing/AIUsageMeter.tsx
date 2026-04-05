'use client';

import { Progress } from '@/components/primitives/progress';
import { Skeleton } from '@/components/primitives/skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/card';
import { useAIQuotaStore } from '@/store/aiQuotaStore';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/utils/tailwind';
import { MessageSquare } from 'lucide-react';

function getUsageColor(percent: number): string {
  if (percent > 95) return 'text-error';
  if (percent >= 80) return 'text-warning';
  return 'text-primary';
}

function getProgressColor(percent: number): string {
  if (percent > 95) return '[&>div]:bg-error';
  if (percent >= 80) return '[&>div]:bg-warning';
  return '[&>div]:bg-primary';
}

function formatResetDate(resetAt: string, limitType: 'daily' | 'monthly'): string {
  if (limitType === 'daily') {
    return 'at midnight';
  }
  const date = new Date(resetAt);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

interface AIUsageMeterProps {
  isLoading?: boolean;
}

export function AIUsageMeter({ isLoading }: AIUsageMeterProps) {
  const _ = useTranslation();
  const used = useAIQuotaStore((s) => s.used);
  const limit = useAIQuotaStore((s) => s.limit);
  const limitType = useAIQuotaStore((s) => s.limitType);
  const resetAt = useAIQuotaStore((s) => s.resetAt);
  const percentUsed = useAIQuotaStore((s) => s.percentUsed);

  if (isLoading) {
    return (
      <Card>
        <CardHeader className='pb-3'>
          <Skeleton className='h-5 w-24' />
        </CardHeader>
        <CardContent className='space-y-3'>
          <Skeleton className='h-2.5 w-full' />
          <Skeleton className='h-4 w-48' />
        </CardContent>
      </Card>
    );
  }

  const isUnlimited = limit === -1;
  const periodLabel = limitType === 'monthly' ? _('this month') : _('today');
  const resetLabel = resetAt ? ` ${_('Resets')} ${formatResetDate(resetAt, limitType)}.` : '';

  return (
    <Card>
      <CardHeader className='pb-3'>
        <div className='flex items-center gap-2'>
          <MessageSquare className='text-primary h-4 w-4' aria-hidden='true' />
          <CardTitle className='text-sm'>{_('AI Usage')}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className='space-y-3'>
        {isUnlimited ? (
          <p className='text-base-content text-sm font-medium'>
            {_('{{used}} messages {{period}}', { used, period: periodLabel })}
            <span className='text-base-content/60 ml-1 font-normal'>{_('Unlimited')}</span>
          </p>
        ) : (
          <>
            <Progress
              value={Math.min(percentUsed, 100)}
              className={cn('h-2.5', getProgressColor(percentUsed))}
            />
            <p className={cn('text-sm font-medium', getUsageColor(percentUsed))}>
              {_('{{used}} / {{limit}} {{period}}.', {
                used,
                limit,
                period: periodLabel,
              })}
              <span className='text-base-content/60 font-normal'>{resetLabel}</span>
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
