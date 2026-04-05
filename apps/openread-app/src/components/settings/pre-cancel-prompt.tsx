'use client';

import { Button } from '@/components/primitives/button';
import { useTranslation } from '@/hooks/useTranslation';
import { AlertTriangle } from 'lucide-react';

interface PreCancelPromptProps {
  planName: string;
  features: string[];
  onKeep: () => void;
  onProceed: () => void;
}

export function PreCancelPrompt({ planName, features, onKeep, onProceed }: PreCancelPromptProps) {
  const _ = useTranslation();

  return (
    <div className='space-y-4'>
      <div className='bg-warning/5 border-warning/20 rounded-lg border p-4'>
        <div className='flex items-start gap-3'>
          <div className='bg-warning/10 rounded-full p-2'>
            <AlertTriangle className='text-warning h-5 w-5' aria-hidden='true' />
          </div>
          <div className='space-y-2'>
            <p className='text-base-content font-semibold'>
              {_("Here's what you'll lose with {{planName}}:", { planName })}
            </p>
            <ul className='text-base-content/60 list-inside list-disc space-y-1 text-sm'>
              {features.map((feature) => (
                <li key={feature}>{_(feature)}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className='flex flex-col gap-2 sm:flex-row sm:justify-end'>
        <Button variant='outline' onClick={onProceed}>
          {_('Continue canceling')}
        </Button>
        <Button onClick={onKeep}>{_('Keep my plan')}</Button>
      </div>
    </div>
  );
}
