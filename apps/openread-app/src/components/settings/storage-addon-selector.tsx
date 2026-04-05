'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/primitives/dialog';
import { Button } from '@/components/primitives/button';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/utils/tailwind';
import { HardDrive, Loader2 } from 'lucide-react';
import { formatPriceDisplay } from '@/lib/tier-gates';
import type { StorageAddon } from '@/lib/tier-config';

interface StorageAddonSelectorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  availableAddons: StorageAddon[];
  onSelect: (addon: StorageAddon) => Promise<void>;
}

export function StorageAddonSelector({
  open,
  onOpenChange,
  availableAddons,
  onSelect,
}: StorageAddonSelectorProps) {
  const _ = useTranslation();
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSelect = async () => {
    if (selectedIndex === null || !availableAddons[selectedIndex]) return;

    setIsLoading(true);
    try {
      await onSelect(availableAddons[selectedIndex]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{_('Add Storage')}</DialogTitle>
          <DialogDescription>
            {_('Choose a storage add-on. Billed monthly as a separate subscription.')}
          </DialogDescription>
        </DialogHeader>

        <div className='grid grid-cols-2 gap-3 py-4'>
          {availableAddons.map((addon, index) => (
            <button
              key={addon.gb}
              type='button'
              onClick={() => setSelectedIndex(index)}
              className={cn(
                'border-base-300 hover:border-primary/50 flex flex-col items-center gap-1 rounded-lg border-2 p-4 transition-colors',
                selectedIndex === index && 'border-primary bg-primary/5',
              )}
            >
              <HardDrive
                className={cn(
                  'h-6 w-6',
                  selectedIndex === index ? 'text-primary' : 'text-base-content/40',
                )}
                aria-hidden='true'
              />
              <span className='text-base-content text-lg font-bold'>+{addon.gb} GB</span>
              <span className='text-base-content/60 text-sm'>
                {formatPriceDisplay(addon.price_cents)}
              </span>
            </button>
          ))}
        </div>

        <div className='flex justify-end gap-2'>
          <Button variant='outline' onClick={() => onOpenChange(false)} disabled={isLoading}>
            {_('Cancel')}
          </Button>
          <Button onClick={handleSelect} disabled={selectedIndex === null || isLoading}>
            {isLoading ? (
              <>
                <Loader2 className='mr-2 h-4 w-4 animate-spin' aria-hidden='true' />
                {_('Redirecting...')}
              </>
            ) : (
              _('Continue to Checkout')
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
