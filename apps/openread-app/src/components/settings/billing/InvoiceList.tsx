'use client';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/primitives/card';
import { Button } from '@/components/primitives/button';
import { Skeleton } from '@/components/primitives/skeleton';
import { useTranslation } from '@/hooks/useTranslation';
import { getLocale } from '@/utils/misc';
import { Download, Receipt } from 'lucide-react';
import type { Invoice } from '@/hooks/useSubscription';

function formatShortDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

interface InvoiceListProps {
  invoices: Invoice[];
  isLoading?: boolean;
}

export function InvoiceList({ invoices, isLoading }: InvoiceListProps) {
  const _ = useTranslation();

  const formatAmount = (amount: number) => {
    return new Intl.NumberFormat(getLocale(), {
      style: 'currency',
      currency: 'USD',
    }).format(amount / 100);
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className='h-5 w-24' />
          <Skeleton className='mt-1 h-4 w-40' />
        </CardHeader>
        <CardContent className='space-y-2'>
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className='h-12' />
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{_('Invoices')}</CardTitle>
        <CardDescription>{_('Your recent invoices')}</CardDescription>
      </CardHeader>
      <CardContent>
        {invoices.length === 0 ? (
          <div className='flex flex-col items-center justify-center py-6'>
            <Receipt className='text-base-content/40 h-10 w-10' aria-hidden='true' />
            <p className='text-base-content/60 mt-3 text-sm'>{_('No invoices yet')}</p>
          </div>
        ) : (
          <div className='overflow-x-auto'>
            <table className='table w-full'>
              <thead>
                <tr className='border-base-300'>
                  <th className='text-base-content/60 bg-transparent text-xs font-medium'>
                    {_('Date')}
                  </th>
                  <th className='text-base-content/60 bg-transparent text-xs font-medium'>
                    {_('Amount')}
                  </th>
                  <th className='text-base-content/60 bg-transparent text-right text-xs font-medium'>
                    {_('Invoice')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => (
                  <tr key={invoice.id} className='border-base-300 hover:bg-base-200/50'>
                    <td className='text-base-content text-sm'>{formatShortDate(invoice.date)}</td>
                    <td className='text-base-content text-sm font-medium'>
                      {formatAmount(invoice.amount)}
                    </td>
                    <td className='text-right'>
                      {invoice.pdfUrl && (
                        <Button variant='ghost' size='sm' asChild>
                          <a
                            href={invoice.pdfUrl}
                            target='_blank'
                            rel='noopener noreferrer'
                            aria-label={_('Download invoice PDF')}
                          >
                            <Download className='mr-1 h-4 w-4' aria-hidden='true' />
                            {_('PDF')}
                          </a>
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
