'use client';

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/utils/tailwind';

interface ExploreSearchBarProps {
  /** Current search query (controlled) */
  value?: string;
  /** Called on every keystroke (controlled mode) */
  onChange?: (value: string) => void;
  /** Called after debounceMs delay (for API calls) */
  onSearch?: (query: string) => void;
  /** Called when clear button is clicked */
  onClear?: () => void;
  /** Number of results to display below the bar */
  resultsCount?: number;
  /** Whether results are still loading (shows "..." instead of count) */
  isStale?: boolean;
  /** Placeholder text override */
  placeholder?: string;
  /** Debounce delay in milliseconds (default 300) */
  debounceMs?: number;
  /** Additional class name for the outer container */
  className?: string;
}

export function ExploreSearchBar({
  value: controlledValue,
  onChange,
  onSearch,
  onClear,
  resultsCount,
  isStale = false,
  placeholder = 'Search books, authors, subjects...',
  debounceMs = 300,
  className,
}: ExploreSearchBarProps) {
  const [internalValue, setInternalValue] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const value = controlledValue ?? internalValue;

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value;

      if (controlledValue === undefined) {
        setInternalValue(newValue);
      }
      onChange?.(newValue);

      // Debounced search callback
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onSearch?.(newValue);
      }, debounceMs);
    },
    [controlledValue, onChange, onSearch, debounceMs],
  );

  const handleClear = useCallback(() => {
    // Cancel any pending debounced search
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (controlledValue === undefined) {
      setInternalValue('');
    }
    onChange?.('');
    onSearch?.('');
    onClear?.();
    inputRef.current?.focus();
  }, [controlledValue, onChange, onSearch, onClear]);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Derive whether to show the results count line
  const showResults = useMemo(
    () => resultsCount !== undefined && value.length > 0,
    [resultsCount, value],
  );

  return (
    <div className={className}>
      <div
        className={cn(
          'bg-base-200 flex h-12 items-center gap-2.5 rounded-xl px-4 transition-colors',
          isFocused && 'ring-primary/30 ring-1',
        )}
      >
        <Search className='text-base-content/40 h-5 w-5 flex-shrink-0' />
        <input
          ref={inputRef}
          type='text'
          placeholder={placeholder}
          value={value}
          onChange={handleChange}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          className='text-base-content placeholder:text-base-content/40 w-full bg-transparent text-base outline-none'
        />
        {value && (
          <button
            type='button'
            onClick={handleClear}
            className='text-base-content/40 hover:text-base-content flex h-11 w-11 flex-shrink-0 items-center justify-center'
            aria-label='Clear search'
          >
            <X className='h-4 w-4' />
          </button>
        )}
      </div>
      {showResults && (
        <p className={cn('text-base-content/60 mt-1.5 px-1 text-sm', isStale && 'opacity-50')}>
          {isStale ? '...' : resultsCount} results
        </p>
      )}
    </div>
  );
}
