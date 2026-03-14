'use client';

import { useEffect, useCallback, useMemo, useRef } from 'react';
import {
  AssistantRuntimeProvider,
  useAssistantRuntime,
  useLocalRuntime,
  type ThreadMessage,
  type ThreadHistoryAdapter,
} from '@assistant-ui/react';

import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useAIChatStore } from '@/store/aiChatStore';
import { useAIQuotaStore } from '@/store/aiQuotaStore';
import { useAuth } from '@/context/AuthContext';
import { getUserProfilePlan } from '@/utils/access';
import { eventDispatcher } from '@/utils/event';
import { createAgenticAdapter } from '@/services/ai';
import type { AISettings, AIMessage } from '@/services/ai/types';
import { useBookChapters } from '@/app/reader/hooks/useBookChapters';
import { Thread } from '@/components/assistant/Thread';

// Helper function to convert AIMessage array to ExportedMessageRepository format
// Each message needs to be wrapped with { message, parentId } structure
function convertToExportedMessages(
  aiMessages: AIMessage[],
): { message: ThreadMessage; parentId: string | null }[] {
  return aiMessages.map((msg, idx) => {
    const baseMessage = {
      id: msg.id,
      content: [{ type: 'text' as const, text: msg.content }],
      createdAt: new Date(msg.createdAt),
      metadata: { custom: {} },
    };

    // Build role-specific message to satisfy ThreadMessage union type
    const threadMessage: ThreadMessage =
      msg.role === 'user'
        ? ({
            ...baseMessage,
            role: 'user' as const,
            attachments: [] as const,
          } as unknown as ThreadMessage)
        : ({
            ...baseMessage,
            role: 'assistant' as const,
            status: { type: 'complete' as const, reason: 'stop' as const },
          } as unknown as ThreadMessage);

    return {
      message: threadMessage,
      parentId: idx > 0 ? (aiMessages[idx - 1]?.id ?? null) : null,
    };
  });
}

interface AIAssistantProps {
  bookKey: string;
}

// inner component that uses the runtime hook
const AIAssistantChat = ({
  aiSettings,
  bookHash,
  bookTitle,
  authorName,
  sectionHref,
  sectionFraction,
  chapterTitle,
  bookFormat,
  bookDoc,
}: {
  aiSettings: AISettings;
  bookHash: string;
  bookTitle: string;
  authorName: string;
  /** Current EPUB section href — used to find the exact chapter. */
  sectionHref?: string;
  /** Position within the current section (0–1). */
  sectionFraction: number;
  chapterTitle?: string;
  bookFormat?: string;
  bookDoc: import('@/libs/document').BookDoc | null;
}) => {
  const { getChapters } = useBookChapters(bookDoc);
  const {
    activeConversationId,
    messages: storedMessages,
    addMessage,
    renameConversation,
    isLoadingHistory,
  } = useAIChatStore();

  // Extract book metadata subjects
  const bookSubjects = useMemo(() => {
    const raw = bookDoc?.metadata?.subject;
    if (!raw) return undefined;
    if (Array.isArray(raw)) return raw.filter((s): s is string => typeof s === 'string');
    if (typeof raw === 'string') return [raw];
    return undefined;
  }, [bookDoc?.metadata?.subject]);

  // use a ref to keep up-to-date options without triggering re-renders of the runtime
  const optionsRef = useRef({
    settings: aiSettings,
    bookHash,
    bookTitle,
    authorName,
    sectionHref,
    sectionFraction,
    chapterTitle,
    bookFormat,
    bookSubjects,
    getChapters,
  });

  // update ref on every render with latest values
  useEffect(() => {
    optionsRef.current = {
      settings: aiSettings,
      bookHash,
      bookTitle,
      authorName,
      sectionHref,
      sectionFraction,
      chapterTitle,
      bookFormat,
      bookSubjects,
      getChapters,
    };
  });

  // create adapter ONCE and keep it stable
  const adapter = useMemo(() => {
    // eslint-disable-next-line react-hooks/refs -- intentional: we read optionsRef inside a deferred callback, not during render
    return createAgenticAdapter(() => optionsRef.current);
  }, []);

  // Create history adapter to load/persist messages
  const historyAdapter = useMemo<ThreadHistoryAdapter | undefined>(() => {
    if (!activeConversationId) return undefined;

    return {
      async load() {
        // storedMessages are already loaded by aiChatStore when conversation is selected
        return {
          messages: convertToExportedMessages(storedMessages),
        };
      },
      async append(item) {
        // item is ExportedMessageRepositoryItem - access the actual message via .message
        const msg = item.message;
        // Persist new messages to our store
        if (activeConversationId && msg.role !== 'system') {
          const textContent = msg.content
            .filter(
              (part): part is { type: 'text'; text: string } =>
                'type' in part && part.type === 'text',
            )
            .map((part) => part.text)
            .join('\n');

          if (textContent) {
            await addMessage({
              conversationId: activeConversationId,
              role: msg.role as 'user' | 'assistant',
              content: textContent,
            });

            // Rename conversation to first user message (first message = index 0 means empty before this)
            if (msg.role === 'user' && storedMessages.length === 0) {
              await renameConversation(activeConversationId, textContent.slice(0, 50));
            }
          }
        }
      },
    };
  }, [activeConversationId, storedMessages, addMessage, renameConversation]);

  // BYOK: determine if user has a BYOK provider selected
  const byokProvider = aiSettings.byokProvider;
  const byokModel = aiSettings.byokModel;

  const handleSelectModel = useCallback((modelId: string) => {
    // Update the settings ref immediately so the adapter uses the new model
    optionsRef.current = {
      ...optionsRef.current,
      settings: {
        ...optionsRef.current.settings,
        byokModel: modelId,
      },
    };
    // Persist to settings store so the selection survives re-renders and sessions
    const { settings: current, setSettings } = useSettingsStore.getState();
    if (current?.aiSettings) {
      setSettings({ ...current, aiSettings: { ...current.aiSettings, byokModel: modelId } });
    }
  }, []);

  return (
    <AIAssistantWithRuntime
      adapter={adapter}
      historyAdapter={historyAdapter}
      bookHash={bookHash}
      isLoadingHistory={isLoadingHistory}
      hasActiveConversation={!!activeConversationId}
      provider={aiSettings.provider}
      byokProvider={byokProvider}
      byokModel={byokModel}
      onSelectModel={byokProvider ? handleSelectModel : undefined}
    />
  );
};

const AIAssistantWithRuntime = ({
  adapter,
  historyAdapter,
  bookHash,
  isLoadingHistory,
  hasActiveConversation,
  provider,
  byokProvider,
  byokModel,
  onSelectModel,
}: {
  adapter: NonNullable<ReturnType<typeof createAgenticAdapter>>;
  historyAdapter?: ThreadHistoryAdapter;
  bookHash: string;
  isLoadingHistory: boolean;
  hasActiveConversation: boolean;
  provider: string;
  byokProvider?: string;
  byokModel?: string;
  onSelectModel?: (modelId: string) => void;
}) => {
  const runtime = useLocalRuntime(adapter, {
    adapters: historyAdapter ? { history: historyAdapter } : undefined,
  });

  if (!runtime) return null;

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadWrapper
        bookHash={bookHash}
        isLoadingHistory={isLoadingHistory}
        hasActiveConversation={hasActiveConversation}
        provider={provider}
        byokProvider={byokProvider}
        byokModel={byokModel}
        onSelectModel={onSelectModel}
      />
    </AssistantRuntimeProvider>
  );
};

const ThreadWrapper = ({
  bookHash,
  isLoadingHistory,
  hasActiveConversation,
  provider,
  byokProvider,
  byokModel,
  onSelectModel,
}: {
  bookHash: string;
  isLoadingHistory: boolean;
  hasActiveConversation: boolean;
  provider: string;
  byokProvider?: string;
  byokModel?: string;
  onSelectModel?: (modelId: string) => void;
}) => {
  const _ = useTranslation();
  const assistantRuntime = useAssistantRuntime();
  const { createConversation, pendingQuestion, setPendingQuestion } = useAIChatStore();

  // Auto-submit pending question from inline bar.
  // Read directly from store to avoid strict-mode double-fire with stale closure values.
  const pendingQuestionHandled = useRef(false);
  useEffect(() => {
    const q = useAIChatStore.getState().pendingQuestion;
    if (q && !pendingQuestionHandled.current) {
      pendingQuestionHandled.current = true;
      setPendingQuestion(null);
      requestAnimationFrame(() => {
        assistantRuntime.thread.append({
          role: 'user',
          content: [{ type: 'text', text: q }],
        });
      });
    }
  }, [pendingQuestion, setPendingQuestion, assistantRuntime]);

  const handleNewChat = useCallback(async () => {
    // createConversation sets activeConversationId, which changes the key on
    // AIAssistant causing a full remount with a fresh runtime — no need to
    // call switchToNewThread() on this (soon-stale) runtime.
    await createConversation(bookHash, _('New conversation'));
  }, [createConversation, bookHash, _]);

  return (
    <Thread
      onNewChat={handleNewChat}
      isLoadingHistory={isLoadingHistory}
      hasActiveConversation={hasActiveConversation}
      provider={provider}
      byokProvider={byokProvider}
      byokModel={byokModel}
      onSelectModel={onSelectModel}
    />
  );
};

const AIAssistant = ({ bookKey }: AIAssistantProps) => {
  const _ = useTranslation();
  const { settings } = useSettingsStore();
  const { getBookData } = useBookDataStore();
  const { getView, getProgress } = useReaderStore();
  const { token, user } = useAuth();
  const fetchInitialQuota = useAIQuotaStore((s) => s.fetchInitial);
  const userId = user?.id;
  const bookData = getBookData(bookKey);
  const progress = getProgress(bookKey);

  const bookHash = bookData?.book?.platformHash || bookKey.split('-')[0] || '';
  const bookTitle = bookData?.book?.title || 'Unknown';
  const authorName = bookData?.book?.author || '';
  const bookFormat = bookData?.book?.format;
  const sectionHref = progress?.sectionHref || undefined;
  // For PDFs, each "section" is a single page, so section.current/total is always 0/1.
  // Use the whole-book pageinfo instead to get the actual reading position.
  const isPdf = bookFormat === 'pdf';
  const posPage = isPdf ? progress?.pageinfo : progress?.section;
  const sectionFraction = posPage && posPage.total > 0 ? (posPage.current + 1) / posPage.total : 0;
  const chapterTitle = progress?.sectionLabel || undefined;
  const aiSettings = settings?.aiSettings;

  // Initialize AI quota on mount
  useEffect(() => {
    if (token && aiSettings?.enabled && userId) {
      const plan = getUserProfilePlan(token);
      fetchInitialQuota(plan, userId);
    }
  }, [token, userId, aiSettings?.enabled, fetchInitialQuota]);

  // Listen for citation link clicks — navigate the reader to the cited chapter/passage.
  const { getChapters: getChaptersForNav } = useBookChapters(bookData?.bookDoc ?? null);
  useEffect(() => {
    // Chapter-index citations (full-text tier): openread://ch/INDEX
    const handleNavigateToChapter = async (event: CustomEvent) => {
      const chapterIndex = event.detail?.chapterIndex;
      if (typeof chapterIndex !== 'number' || chapterIndex < 0) return;

      const view = getView(bookKey);
      if (!view) return;

      const chapters = await getChaptersForNav();
      if (chapterIndex >= chapters.length) return;

      const chapter = chapters[chapterIndex]!;
      const sectionFracs = view.getSectionFractions();
      const fraction = sectionFracs[chapter.index] ?? 0;

      console.log(
        `[citation-nav] ch:${chapterIndex} → "${chapter.title}" (spine ${chapter.index}) → fraction ${fraction.toFixed(4)}`,
      );
      view.goToFraction(fraction);
    };

    // Char-offset citations (tool-based tier): openread://loc/OFFSET
    const handleNavigateToOffset = async (event: CustomEvent) => {
      const offset = event.detail?.offset;
      if (typeof offset !== 'number' || offset < 0) return;

      const view = getView(bookKey);
      if (!view) return;

      const chapters = await getChaptersForNav();
      if (chapters.length === 0) return;

      let cum = 0;
      let chapterIdx = chapters.length - 1;
      for (let i = 0; i < chapters.length; i++) {
        if (cum + chapters[i]!.text.length > offset) {
          chapterIdx = i;
          break;
        }
        cum += chapters[i]!.text.length;
      }

      const chapter = chapters[chapterIdx]!;
      const charInChapter = Math.max(0, offset - cum);
      const charFrac = chapter.text.length > 0 ? charInChapter / chapter.text.length : 0;

      const sectionFracs = view.getSectionFractions();
      const spineIdx = chapter.index;
      const secStart = sectionFracs[spineIdx] ?? 0;
      const secEnd = sectionFracs[spineIdx + 1] ?? 1;
      const globalFraction = secStart + charFrac * (secEnd - secStart);

      console.log(
        `[citation-nav] offset ${offset} → "${chapter.title}" (spine ${spineIdx}) → fraction ${globalFraction.toFixed(4)}`,
      );
      view.goToFraction(globalFraction);
    };

    eventDispatcher.on('navigate-to-chapter', handleNavigateToChapter);
    eventDispatcher.on('navigate-to-offset', handleNavigateToOffset);
    return () => {
      eventDispatcher.off('navigate-to-chapter', handleNavigateToChapter);
      eventDispatcher.off('navigate-to-offset', handleNavigateToOffset);
    };
  }, [bookKey, getView, getChaptersForNav]);

  if (!aiSettings?.enabled) {
    return (
      <div className='flex h-full items-center justify-center p-4'>
        <p className='text-muted-foreground text-sm'>{_('Enable AI in Settings')}</p>
      </div>
    );
  }

  // Always render chat immediately — the agentic adapter uses tools to access
  // book content on demand. No indexing or pre-fetching needed.
  return (
    <AIAssistantChat
      aiSettings={aiSettings}
      bookHash={bookHash}
      bookTitle={bookTitle}
      authorName={authorName}
      sectionHref={sectionHref}
      sectionFraction={sectionFraction}
      chapterTitle={chapterTitle}
      bookFormat={bookFormat}
      bookDoc={bookData?.bookDoc ?? null}
    />
  );
};

export default AIAssistant;
