'use client';

import clsx from 'clsx';
import React, { useEffect, useCallback, useMemo } from 'react';
import Image from 'next/image';
import { LuMessageSquare, LuPlus } from 'react-icons/lu';
import { MoreVerticalIcon, Trash2Icon, Columns2Icon, BookOpenIcon } from 'lucide-react';

import { useTranslation } from '@/hooks/useTranslation';
import { useAIChatStore } from '@/store/aiChatStore';
import { useNotebookStore } from '@/store/notebookStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useParallelViewStore } from '@/store/parallelViewStore';
import type { AIConversation } from '@/services/ai/types';
import { useEnv } from '@/context/EnvContext';
import { uniqueId } from '@/utils/misc';
import { usePrimaryBookHash } from '@/app/reader/hooks/usePrimaryBookHash';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { HoverCard, HoverCardTrigger, HoverCardContent } from '@/components/ui/hover-card';

interface BookInfo {
  cover?: string;
  title: string;
}

/** Badge showing book count with hover card listing all books with thumbnails. */
const BookBadge: React.FC<{
  bookHashes: string[];
  bookInfoByHash: Map<string, BookInfo>;
}> = ({ bookHashes, bookInfoByHash }) => {
  if (bookHashes.length <= 1) return null;

  return (
    <HoverCard openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>
        <button
          type='button'
          className={clsx(
            'ml-auto flex items-center gap-1 rounded px-1.5 py-0.5',
            'bg-base-content/8 text-base-content/50',
            'text-xs font-medium',
            'hover:bg-base-content/15 hover:text-base-content/70 transition-colors',
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {bookHashes.length}
          <Columns2Icon className='size-3.5' />
        </button>
      </HoverCardTrigger>
      <HoverCardContent
        align='end'
        side='right'
        sideOffset={8}
        className='bg-base-100 border-base-content/15 z-50 w-48 rounded-lg border p-2 shadow-lg'
        onClick={(e) => e.stopPropagation()}
      >
        <ul className='space-y-1'>
          {bookHashes.map((hash) => {
            const info = bookInfoByHash.get(hash);
            return (
              <li key={hash} className='flex items-center gap-2 py-0.5'>
                {info?.cover ? (
                  <Image
                    src={info.cover}
                    alt={info.title}
                    width={20}
                    height={28}
                    className='h-[20px] w-[14px] flex-shrink-0 rounded-sm object-cover shadow-sm'
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <div className='bg-base-300 flex h-[20px] w-[14px] flex-shrink-0 items-center justify-center rounded-sm'>
                    <BookOpenIcon className='text-base-content/30 size-2' />
                  </div>
                )}
                <span className='text-base-content truncate text-xs'>
                  {info?.title || 'Unknown'}
                </span>
              </li>
            );
          })}
        </ul>
      </HoverCardContent>
    </HoverCard>
  );
};

interface ChatHistoryViewProps {
  bookKey: string;
  onConversationSelected?: () => void;
}

const ChatHistoryView: React.FC<ChatHistoryViewProps> = ({ bookKey, onConversationSelected }) => {
  const _ = useTranslation();
  const { appService, envConfig } = useEnv();
  const {
    conversations,
    isLoadingHistory,
    loadConversations,
    setActiveConversation,
    deleteConversation,
    createConversation,
  } = useAIChatStore();
  const { setNotebookVisible, setNotebookActiveTab } = useNotebookStore();
  const bookKeys = useReaderStore((s) => s.bookKeys);
  const sideBarBookKey = useSidebarStore((s) => s.sideBarBookKey);
  const setParallel = useParallelViewStore((s) => s.setParallel);
  const { primaryBookHash, getParallelHashes } = usePrimaryBookHash(bookKey);

  const library = useLibraryStore((s) => s.library);

  // Map bookHash → { cover, title } for thumbnail display and tooltips
  const bookInfoByHash = useMemo(() => {
    const map = new Map<string, BookInfo>();
    for (const book of library) {
      map.set(book.hash, { cover: book.coverImageUrl || undefined, title: book.title });
    }
    return map;
  }, [library]);

  // Load conversations for the primary book
  useEffect(() => {
    if (primaryBookHash) {
      loadConversations(primaryBookHash);
    }
  }, [primaryBookHash, loadConversations]);

  const handleSelectConversation = useCallback(
    async (conversation: AIConversation) => {
      await setActiveConversation(conversation.id);
      onConversationSelected?.();
      setNotebookVisible(true);
      setNotebookActiveTab('ai');

      // Restore parallel read session if this conversation had parallel books
      if (conversation.parallelBookHashes?.length) {
        const openHashes = new Set(bookKeys.map((key) => key.split('-')[0]));
        const ownedHashes = new Set(library.map((b) => b.hash));
        const missingHashes = conversation.parallelBookHashes
          .filter((h) => !openHashes.has(h) && ownedHashes.has(h))
          .slice(0, 8);

        if (missingHashes.length > 0) {
          const { initViewState, setBookKeys } = useReaderStore.getState();
          const newKeys: string[] = [];
          for (const hash of missingHashes) {
            const newKey = `${hash}-${uniqueId()}`;
            initViewState(envConfig, hash, newKey, false);
            newKeys.push(newKey);
          }
          setBookKeys([...bookKeys, ...newKeys]);
          // Set all new books as parallel with the current book in one call
          if (sideBarBookKey) setParallel([sideBarBookKey, ...newKeys]);
        }
      }
    },
    [
      setActiveConversation,
      onConversationSelected,
      setNotebookVisible,
      setNotebookActiveTab,
      bookKeys,
      envConfig,
      sideBarBookKey,
      setParallel,
      library,
    ],
  );

  const handleNewConversation = useCallback(async () => {
    await createConversation(primaryBookHash, _('New conversation'), getParallelHashes());
    setNotebookVisible(true);
    setNotebookActiveTab('ai');
  }, [
    primaryBookHash,
    _,
    createConversation,
    getParallelHashes,
    setNotebookVisible,
    setNotebookActiveTab,
  ]);

  const handleDeleteConversation = useCallback(
    async (id: string) => {
      if (!appService) return;
      if (await appService.ask(_('Delete this conversation?'))) {
        await deleteConversation(id);
      }
    },
    [deleteConversation, _, appService],
  );

  if (isLoadingHistory) {
    return (
      <div className='flex h-full items-center justify-center p-4'>
        <div className='border-primary size-5 animate-spin rounded-full border-2 border-t-transparent' />
      </div>
    );
  }

  return (
    <div className='flex h-full flex-col'>
      {/* Recents header */}
      <div className='flex items-center justify-between px-3 pb-1 pt-3'>
        <span className='text-base-content/60 text-xs font-semibold uppercase tracking-wider'>
          {_('Recents')}
        </span>
        <button
          onClick={handleNewConversation}
          className={clsx(
            'flex items-center gap-1.5 rounded-lg px-2.5 py-1',
            'bg-base-300 text-base-content',
            'hover:bg-base-content/10',
            'border-base-content/10 border',
            'transition-all duration-200 ease-out',
            'active:scale-[0.97]',
          )}
          aria-label={_('New Chat')}
        >
          <LuPlus size={14} />
          <span className='text-xs font-medium'>{_('New Chat')}</span>
        </button>
      </div>

      {/* Conversation list */}
      <div className='flex-1 overflow-y-auto'>
        {conversations.length === 0 ? (
          <div className='flex h-full flex-col items-center justify-center gap-3 p-4 text-center'>
            <div className='bg-base-300/50 rounded-full p-3'>
              <LuMessageSquare className='text-base-content/50 size-6' />
            </div>
            <div>
              <p className='text-base-content/70 text-sm'>{_('No conversations yet')}</p>
              <p className='text-base-content/50 text-xs'>
                {_('Start a new chat to ask questions about this book')}
              </p>
            </div>
          </div>
        ) : (
          <ul>
            {conversations.map((conversation) => (
              <li
                key={conversation.id}
                className={clsx(
                  'group flex cursor-pointer items-center px-3 py-2',
                  'hover:bg-base-300/50 transition-colors duration-150',
                )}
              >
                <div
                  className='min-w-0 flex-1'
                  tabIndex={0}
                  role='button'
                  onClick={() => handleSelectConversation(conversation)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleSelectConversation(conversation);
                    }
                  }}
                >
                  <p className='text-base-content truncate text-sm'>{conversation.title}</p>
                </div>

                {/* Book count badge — hover to see list of books in this conversation */}
                <BookBadge
                  bookHashes={[conversation.bookHash, ...(conversation.parallelBookHashes ?? [])]}
                  bookInfoByHash={bookInfoByHash}
                />

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type='button'
                      className={clsx(
                        'text-base-content/50 flex h-6 w-5 flex-shrink-0 items-center justify-center rounded outline-none transition-all',
                        'opacity-0 group-hover:opacity-100',
                        'hover:bg-base-content/15 hover:text-base-content/70',
                      )}
                      aria-label={_('More options')}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MoreVerticalIcon className='size-3.5' />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align='end' className='bg-base-100 w-36 shadow-lg'>
                    <DropdownMenuItem
                      className='text-error focus:text-error cursor-pointer text-xs'
                      onClick={() => handleDeleteConversation(conversation.id)}
                    >
                      <Trash2Icon className='mr-1.5 size-3.5' />
                      {_('Delete')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default ChatHistoryView;
