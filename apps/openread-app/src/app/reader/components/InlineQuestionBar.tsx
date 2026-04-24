'use client';

import React, { useState, useCallback, useRef } from 'react';
import { ArrowUpIcon, XIcon, BookOpenIcon } from 'lucide-react';

import { useAIChatStore } from '@/store/aiChatStore';
import { useNotebookStore } from '@/store/notebookStore';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useThemeStore } from '@/store/themeStore';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { usePrimaryBookHash } from '@/app/reader/hooks/usePrimaryBookHash';
import { cn } from '@/utils/tailwind';

interface InlineQuestionBarProps {
  bookKey: string;
}

const InlineQuestionBar: React.FC<InlineQuestionBarProps> = ({ bookKey }) => {
  const _ = useTranslation();
  const [question, setQuestion] = useState('');
  const [dismissed, setDismissed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { appService } = useEnv();
  const { settings } = useSettingsStore();
  const { safeAreaInsets } = useThemeStore();
  const hoveredBookKey = useReaderStore((s) => s.hoveredBookKey);

  const { createConversation, setPendingQuestion } = useAIChatStore();
  const { setNotebookVisible, setNotebookActiveTab, isNotebookVisible } = useNotebookStore();
  const notebookPinned = useNotebookStore((s) => s.isNotebookPinned);
  const notebookWidth = useNotebookStore((s) => s.notebookWidth);
  const sideBarPinned = useSidebarStore((s) => s.isSideBarPinned);
  const sideBarVisible = useSidebarStore((s) => s.isSideBarVisible);
  const sideBarWidth = useSidebarStore((s) => s.sideBarWidth);

  const { primaryBookHash, getParallelHashes } = usePrimaryBookHash(bookKey);
  // Default to enabled while settings load (DEFAULT_AI_SETTINGS.enabled = true).
  // The store initializes as {} before loadSettings() completes.
  const aiEnabled = settings?.aiSettings?.enabled ?? true;
  const notebookOnAI = useNotebookStore((s) => s.notebookActiveTab === 'ai');

  // Compute left/right offsets so the bar centers over the reading area
  const leftOffset = sideBarVisible && sideBarPinned && sideBarWidth ? sideBarWidth : '0px';
  const rightOffset = isNotebookVisible && notebookPinned && notebookWidth ? notebookWidth : '0px';

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = question.trim();
      if (!trimmed) return;

      // Store the question so AIAssistant auto-sends it when it mounts
      setPendingQuestion(trimmed);

      // Create conversation under the primary book
      await createConversation(primaryBookHash, trimmed.slice(0, 50), getParallelHashes());
      setNotebookVisible(true);
      setNotebookActiveTab('ai');

      setQuestion('');
    },
    [
      question,
      primaryBookHash,
      createConversation,
      getParallelHashes,
      setPendingQuestion,
      setNotebookVisible,
      setNotebookActiveTab,
    ],
  );

  // Don't show if AI is not enabled, dismissed, or notebook AI tab is already visible.
  if (!aiEnabled || dismissed || (isNotebookVisible && notebookOnAI)) return null;

  // On mobile: keep mounted but collapse when footer bar or sheet is active.
  // This enables the smooth expand/shrink morph transition.
  const isSheetOpen = !!(window as unknown as Record<string, unknown>).__sheetOpen;
  const mobileCollapsed = appService?.isMobile && (!!hoveredBookKey || isSheetOpen);

  // On desktop, unmount entirely when not needed
  if (!appService?.isMobile && hoveredBookKey) return null;

  return (
    <div
      className={cn(
        'pointer-events-none fixed z-30 flex justify-center',
        appService?.isMobile
          ? 'transition-none'
          : 'animate-in fade-in slide-in-from-bottom-4 transition-[left,right] duration-300',
      )}
      style={{
        left: appService?.isMobile ? 0 : leftOffset,
        right: appService?.isMobile ? 0 : rightOffset,
        bottom: appService?.isMobile
          ? `${Math.max((safeAreaInsets?.bottom || 0) - 10, 8)}px`
          : `${24 + (safeAreaInsets?.bottom || 0)}px`,
      }}
    >
      <form
        onSubmit={handleSubmit}
        className={cn(
          'flex items-center gap-2 overflow-hidden',
          appService?.isMobile
            ? cn(
                'border-base-content/10 bg-base-200/80 rounded-full border shadow-lg backdrop-blur-2xl',
                'transition-[width,opacity,padding] duration-300 ease-in-out',
                mobileCollapsed
                  ? 'pointer-events-none w-0 px-0 opacity-0'
                  : 'pointer-events-auto w-[85vw] max-w-xs px-4 py-2.5 opacity-100',
              )
            : 'border-base-content/10 bg-base-100/95 pointer-events-auto w-[85%] max-w-sm rounded-2xl border px-3 py-2 shadow-lg backdrop-blur-xl',
        )}
      >
        <BookOpenIcon className='text-base-content/40 size-4 shrink-0' />
        <input
          ref={inputRef}
          type='text'
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={_('Ask about this book...')}
          className={cn(
            'min-w-0 flex-1 bg-transparent text-sm outline-none',
            appService?.isMobile
              ? 'text-base-content placeholder:text-base-content/50'
              : 'text-base-content placeholder:text-base-content/55',
          )}
        />
        {question.trim() ? (
          <button
            type='submit'
            className='bg-base-content text-base-100 flex size-7 shrink-0 items-center justify-center rounded-full transition-transform active:scale-95'
            aria-label={_('Ask')}
          >
            <ArrowUpIcon className='size-3.5' />
          </button>
        ) : (
          <button
            type='button'
            onClick={() => setDismissed(true)}
            className='text-base-content/40 hover:text-base-content flex size-7 shrink-0 items-center justify-center rounded-full transition-colors'
            aria-label={_('Dismiss')}
          >
            <XIcon className='size-3.5' />
          </button>
        )}
      </form>
    </div>
  );
};

export default InlineQuestionBar;
