'use client';

import clsx from 'clsx';
import React, { useEffect, useCallback, useMemo } from 'react';
import Image from 'next/image';
import { LuMessageSquare, LuPlus } from 'react-icons/lu';
import { MoreVerticalIcon, Trash2Icon } from 'lucide-react';

import { useTranslation } from '@/hooks/useTranslation';
import { useAIChatStore } from '@/store/aiChatStore';
import { useNotebookStore } from '@/store/notebookStore';
import { useLibraryStore } from '@/store/libraryStore';
import type { AIConversation } from '@/services/ai/types';
import { useEnv } from '@/context/EnvContext';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface BookInfo {
  cover?: string;
  title: string;
}

/** Shows up to 3 book cover thumbnails with a "+N" overflow indicator. Hover shows book titles. */
const BookThumbnails: React.FC<{
  bookHashes: string[];
  bookInfoByHash: Map<string, BookInfo>;
}> = ({ bookHashes, bookInfoByHash }) => {
  const maxVisible = 3;
  const visible = bookHashes.slice(0, maxVisible);
  const overflow = bookHashes.length - maxVisible;
  const tooltip = bookHashes
    .map((h) => bookInfoByHash.get(h)?.title)
    .filter(Boolean)
    .join(', ');

  return (
    <div className='group/thumbs relative flex flex-shrink-0 items-center gap-0.5' title={tooltip}>
      {visible.map((hash) => {
        const info = bookInfoByHash.get(hash);
        return info?.cover ? (
          <Image
            key={hash}
            src={info.cover}
            alt={info.title}
            width={14}
            height={20}
            className='h-[14px] w-[10px] rounded-[1px] object-cover opacity-60 transition-opacity group-hover/thumbs:opacity-100'
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : null;
      })}
      {overflow > 0 && (
        <span className='text-base-content/40 text-[9px] font-medium'>+{overflow}</span>
      )}
    </div>
  );
};

interface ChatHistoryViewProps {
  bookKey: string;
}

const ChatHistoryView: React.FC<ChatHistoryViewProps> = ({ bookKey }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const {
    conversations,
    isLoadingHistory,
    loadConversations,
    setActiveConversation,
    deleteConversation,
    createConversation,
  } = useAIChatStore();
  const { setNotebookVisible, setNotebookActiveTab } = useNotebookStore();

  const { getVisibleLibrary } = useLibraryStore();
  const bookHash = bookKey.split('-')[0] || '';

  // Map bookHash → { cover, title } for thumbnail display and tooltips
  const bookInfoByHash = useMemo(() => {
    const map = new Map<string, BookInfo>();
    for (const book of getVisibleLibrary()) {
      map.set(book.hash, { cover: book.coverImageUrl || undefined, title: book.title });
    }
    return map;
  }, [getVisibleLibrary]);

  // Load conversations for this book
  useEffect(() => {
    if (bookHash) {
      loadConversations(bookHash);
    }
  }, [bookHash, loadConversations]);

  const handleSelectConversation = useCallback(
    async (conversation: AIConversation) => {
      await setActiveConversation(conversation.id);
      setNotebookVisible(true);
      setNotebookActiveTab('ai');
    },
    [setActiveConversation, setNotebookVisible, setNotebookActiveTab],
  );

  const handleNewConversation = useCallback(async () => {
    await createConversation(bookHash, _('New conversation'));
    setNotebookVisible(true);
    setNotebookActiveTab('ai');
  }, [bookHash, _, createConversation, setNotebookVisible, setNotebookActiveTab]);

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
                  'group flex cursor-pointer items-center gap-1 px-3 py-2',
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

                {/* Book cover thumbnail — shows which book(s) this conversation is about */}
                <BookThumbnails
                  bookHashes={[conversation.bookHash]}
                  bookInfoByHash={bookInfoByHash}
                />

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type='button'
                      className={clsx(
                        'text-base-content/40 hover:text-base-content flex size-6 flex-shrink-0 items-center justify-center rounded-full transition-colors',
                        'opacity-0 group-hover:opacity-100',
                      )}
                      aria-label={_('More options')}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MoreVerticalIcon className='size-3.5' />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align='end' className='w-36'>
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
