'use client';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/primitives/card';
import { Skeleton } from '@/components/primitives/skeleton';
import { useTranslation } from '@/hooks/useTranslation';
import { BarChart3 } from 'lucide-react';

export interface MonthUsage {
  /** Display label, e.g. "Mar 2026" */
  month: string;
  /** Number of AI messages sent that month */
  aiMessages: number;
  /** Storage delta in bytes (positive = added, negative = removed) */
  storageDeltaBytes: number;
}

interface UsageHistoryProps {
  months?: MonthUsage[];
  isLoading?: boolean;
}

function formatStorageDelta(bytes: number): string {
  const abs = Math.abs(bytes);
  const k = 1024;
  if (abs === 0) return '0 B';
  if (abs < k * k) return `${bytes > 0 ? '+' : '-'}${(abs / k).toFixed(0)} KB`;
  if (abs < k * k * k) return `${bytes > 0 ? '+' : '-'}${(abs / (k * k)).toFixed(1)} MB`;
  return `${bytes > 0 ? '+' : '-'}${(abs / (k * k * k)).toFixed(1)} GB`;
}

export function UsageHistory({ months = [], isLoading }: UsageHistoryProps) {
  const _ = useTranslation();

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className='h-5 w-40' />
          <Skeleton className='mt-1 h-4 w-56' />
        </CardHeader>
        <CardContent className='space-y-3'>
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className='h-10 w-full' />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (months.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{_('Monthly Usage')}</CardTitle>
          <CardDescription>{_('Your usage over the last 3 months')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className='flex flex-col items-center justify-center py-6'>
            <BarChart3 className='text-base-content/40 h-10 w-10' aria-hidden='true' />
            <p className='text-base-content/60 mt-3 text-sm'>{_('No usage history yet')}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{_('Monthly Usage')}</CardTitle>
        <CardDescription>{_('Your usage over the last 3 months')}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className='overflow-x-auto'>
          <table className='table w-full'>
            <thead>
              <tr className='border-base-300'>
                <th className='text-base-content/60 bg-transparent text-xs font-medium'>
                  {_('Month')}
                </th>
                <th className='text-base-content/60 bg-transparent text-xs font-medium'>
                  {_('AI Messages')}
                </th>
                <th className='text-base-content/60 bg-transparent text-xs font-medium'>
                  {_('Storage Change')}
                </th>
              </tr>
            </thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.month} className='border-base-300'>
                  <td className='text-base-content text-sm'>{m.month}</td>
                  <td className='text-base-content text-sm'>{m.aiMessages}</td>
                  <td className='text-base-content text-sm'>
                    {formatStorageDelta(m.storageDeltaBytes)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
