'use client';

import { Progress } from '@/components/primitives/progress';
import { Skeleton } from '@/components/primitives/skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/card';
import { Button } from '@/components/primitives/button';
import { useStorageQuota } from '@/hooks/useStorageQuota';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/utils/tailwind';
import { HardDrive, Plus } from 'lucide-react';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

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

interface StorageMeterProps {
  onAddStorage?: () => void;
}

export function StorageMeter({ onAddStorage }: StorageMeterProps) {
  const _ = useTranslation();
  const { quota, isLoading, error } = useStorageQuota();

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

  if (error || !quota) {
    return (
      <Card>
        <CardHeader className='pb-3'>
          <div className='flex items-center gap-2'>
            <HardDrive className='text-primary h-4 w-4' aria-hidden='true' />
            <CardTitle className='text-sm'>{_('Storage')}</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <p className='text-error text-sm'>{_('Failed to load storage data')}</p>
        </CardContent>
      </Card>
    );
  }

  const totalGb = quota.base_gb + quota.addon_gb;
  const percentClamped = Math.min(quota.percent_used, 100);

  const breakdown =
    quota.addon_gb > 0
      ? _('{{base}} GB base + {{addon}} GB add-ons', {
          base: quota.base_gb,
          addon: quota.addon_gb,
        })
      : _('{{base}} GB base', { base: quota.base_gb });

  return (
    <Card>
      <CardHeader className='pb-3'>
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-2'>
            <HardDrive className='text-primary h-4 w-4' aria-hidden='true' />
            <CardTitle className='text-sm'>{_('Storage')}</CardTitle>
          </div>
          {onAddStorage && (
            <Button variant='ghost' size='sm' className='h-7 text-xs' onClick={onAddStorage}>
              <Plus className='mr-1 h-3 w-3' aria-hidden='true' />
              {_('Add Storage')}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className='space-y-3'>
        <Progress
          value={percentClamped}
          className={cn('h-2.5', getProgressColor(quota.percent_used))}
        />
        <div>
          <p className={cn('text-sm font-medium', getUsageColor(quota.percent_used))}>
            {formatBytes(quota.used_bytes)} {_('of')} {totalGb} GB
          </p>
          <p className='text-base-content/60 text-xs'>({breakdown})</p>
        </div>
      </CardContent>
    </Card>
  );
}
