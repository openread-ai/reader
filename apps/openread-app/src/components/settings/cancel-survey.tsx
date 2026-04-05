'use client';

import { useState } from 'react';
import { Button } from '@/components/primitives/button';
import { Label } from '@/components/primitives/label';
import { Textarea } from '@/components/primitives/textarea';
import { useTranslation } from '@/hooks/useTranslation';

export type CancelReason = 'too_expensive' | 'not_using' | 'found_alternative' | 'other';

export interface CancelSurveyData {
  reason: CancelReason;
  feedback: string;
}

const CANCEL_REASONS: { value: CancelReason; label: string }[] = [
  { value: 'too_expensive', label: 'Too expensive' },
  { value: 'not_using', label: 'Not using it enough' },
  { value: 'found_alternative', label: 'Found an alternative' },
  { value: 'other', label: 'Other' },
];

interface CancelSurveyProps {
  onSubmit: (data: CancelSurveyData) => void;
  onSkip: () => void;
  isSubmitting: boolean;
}

export function CancelSurvey({ onSubmit, onSkip, isSubmitting }: CancelSurveyProps) {
  const _ = useTranslation();
  const [reason, setReason] = useState<CancelReason | null>(null);
  const [feedback, setFeedback] = useState('');

  const handleSubmit = () => {
    if (reason) {
      onSubmit({ reason, feedback });
    }
  };

  return (
    <div className='space-y-4'>
      <div className='space-y-1'>
        <p className='text-base-content font-semibold'>
          {_("We're sorry to see you go. Why are you leaving?")}
        </p>
        <p className='text-base-content/60 text-sm'>
          {_('Your feedback helps us improve our service.')}
        </p>
      </div>

      <div className='space-y-2' role='radiogroup' aria-label={_('Cancellation reason')}>
        {CANCEL_REASONS.map((option) => (
          <label
            key={option.value}
            className='border-base-300 hover:bg-base-200/50 flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors'
          >
            <input
              type='radio'
              name='cancel-reason'
              value={option.value}
              checked={reason === option.value}
              onChange={() => setReason(option.value)}
              className='text-primary'
            />
            <span className='text-base-content text-sm'>{_(option.label)}</span>
          </label>
        ))}
      </div>

      <div className='space-y-2'>
        <Label htmlFor='cancel-feedback'>{_('Additional feedback (optional)')}</Label>
        <Textarea
          id='cancel-feedback'
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder={_('Tell us more about your experience...')}
          rows={3}
          className='resize-none'
        />
      </div>

      <div className='flex flex-col gap-2 sm:flex-row sm:justify-end'>
        <Button variant='ghost' onClick={onSkip} disabled={isSubmitting}>
          {_('Skip & Cancel')}
        </Button>
        <Button variant='destructive' onClick={handleSubmit} disabled={!reason || isSubmitting}>
          {isSubmitting ? _('Canceling...') : _('Submit & Cancel')}
        </Button>
      </div>
    </div>
  );
}
