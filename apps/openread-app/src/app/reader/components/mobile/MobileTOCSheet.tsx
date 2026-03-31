import clsx from 'clsx';
import { useState } from 'react';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useTranslation } from '@/hooks/useTranslation';
import TOCView from '../sidebar/TOCView';
import BooknoteView from '../sidebar/BooknoteView';

type TabType = 'chapters' | 'highlights' | 'bookmarks';

export function MobileTOCContent({ bookKey }: { bookKey: string }) {
  const _ = useTranslation();
  const [activeTab, setActiveTab] = useState<TabType>('chapters');
  const { getBookData, getConfig } = useBookDataStore();
  const { getViewSettings } = useReaderStore();
  const bookData = getBookData(bookKey);
  const viewSettings = getViewSettings(bookKey);
  const bookDoc = bookData?.bookDoc;
  const config = getConfig(bookKey);
  const booknotes = config?.booknotes ?? [];
  const hasHighlights = booknotes.some((n) => n.type === 'annotation' && !n.deletedAt);
  const hasBookmarks = booknotes.some((n) => n.type === 'bookmark' && !n.deletedAt);

  const tabs: { key: TabType; label: string }[] = [
    { key: 'chapters', label: _('Chapters') },
    { key: 'highlights', label: _('Highlights') },
    { key: 'bookmarks', label: _('Bookmarks') },
  ];

  const emptyState = (message: string) => (
    <div className='text-base-content/40 flex h-full items-center justify-center text-sm'>
      {message}
    </div>
  );

  const renderTabContent = () => {
    if (!bookDoc) return emptyState(_('No content available'));
    switch (activeTab) {
      case 'chapters':
        return bookDoc.toc ? (
          <TOCView toc={bookDoc.toc} sections={bookDoc.sections} bookKey={bookKey} />
        ) : (
          emptyState(_('No chapters found'))
        );
      case 'highlights':
        return hasHighlights ? (
          <BooknoteView type='annotation' toc={bookDoc.toc ?? []} bookKey={bookKey} />
        ) : (
          emptyState(_('No highlights yet'))
        );
      case 'bookmarks':
        return hasBookmarks ? (
          <BooknoteView type='bookmark' toc={bookDoc.toc ?? []} bookKey={bookKey} />
        ) : (
          emptyState(_('No bookmarks yet'))
        );
    }
  };

  return (
    <>
      <div className='flex gap-1 px-4 pb-2' dir={viewSettings?.rtl ? 'rtl' : 'ltr'}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            className={clsx(
              'flex-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
              activeTab === tab.key
                ? 'bg-base-content/10 text-base-content'
                : 'text-base-content/50 hover:text-base-content/70',
            )}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className='scroll-container flex-1 px-2'>{renderTabContent()}</div>
    </>
  );
}

export default MobileTOCContent;
