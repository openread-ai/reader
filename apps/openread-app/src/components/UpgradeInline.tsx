'use client';

/**
 * Inline upgrade prompt shown when a feature is gated.
 * Dismissable, with a link to the pricing page.
 * Not a modal -- renders inline where it's placed.
 */

import React, { useState } from 'react';
import clsx from 'clsx';
import { XIcon } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';

interface UpgradeInlineProps {
  /** The gate message, e.g. "Text-to-Speech is available on Reader." */
  message: string;
  /** Optional custom CTA text (e.g. "Start Reader — $7.99/mo"). Defaults to "Start Reading" with arrow. */
  ctaText?: string;
  /** Monthly price string (e.g. "$7.99/mo"). Appended to ctaText if ctaText is not provided. */
  price?: string;
  /** Optional custom link. Defaults to /user/plans. */
  ctaHref?: string;
  /** Optional className for the container. */
  className?: string;
  /** Callback when dismissed. */
  onDismiss?: () => void;
}

const UpgradeInline: React.FC<UpgradeInlineProps> = ({
  message,
  ctaText,
  price,
  ctaHref = '/user/plans',
  className,
  onDismiss,
}) => {
  const _ = useTranslation();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    onDismiss?.();
  };

  return (
    <div
      role='status'
      className={clsx(
        'border-base-300 bg-base-200/50 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm',
        className,
      )}
    >
      <span className='text-base-content/70 flex-1'>{message}</span>
      <a
        href={ctaHref}
        className='text-primary whitespace-nowrap text-sm font-medium hover:underline'
      >
        {ctaText || (price ? `${_('Start Reading')} \u2014 ${price}` : _('Start Reading'))} &rarr;
      </a>
      <button
        type='button'
        onClick={handleDismiss}
        className='text-base-content/40 hover:text-base-content shrink-0 transition-colors'
        aria-label={_('Dismiss')}
      >
        <XIcon className='size-3.5' />
      </button>
    </div>
  );
};

export default UpgradeInline;
