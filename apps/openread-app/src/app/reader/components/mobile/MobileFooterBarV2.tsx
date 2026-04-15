import clsx from 'clsx';
import { useState, useCallback, useEffect } from 'react';
import { IconType } from 'react-icons';
import { IoIosList } from 'react-icons/io';
import { PiChatCircleBold } from 'react-icons/pi';
import { IoSettingsOutline } from 'react-icons/io5';
import { useReaderStore } from '@/store/readerStore';
import { useThemeStore } from '@/store/themeStore';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { setNativeFooterActiveTab } from '@/services/annotation/nativeMenuBridge';
import HalfSheet from './HalfSheet';
import { MobileTOCContent } from './MobileTOCSheet';
import { MobileChatContent } from './MobileChatSheet';
import { MobileSettingsContent } from './MobileSettingsSheet';

type SheetType = 'toc' | 'chat' | 'settings' | null;

interface MobileFooterBarV2Props {
  bookKey: string;
}

function MobileFooterBarV2({ bookKey }: MobileFooterBarV2Props) {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { safeAreaInsets } = useThemeStore();
  const { setHoveredBookKey } = useReaderStore();
  const [activeSheet, setActiveSheet] = useState<SheetType>(null);
  const useNativeBar = !!appService?.isIOSApp;

  const handleOpenSheet = useCallback(
    (sheet: SheetType) => {
      if (activeSheet === sheet) {
        setActiveSheet(null);
        // Allow toolbar auto-hide again
        (window as unknown as Record<string, unknown>).__sheetOpen = false;
      } else {
        setActiveSheet(sheet);
        setHoveredBookKey(bookKey);
        // Prevent iframe touch events from clearing hoveredBookKey
        (window as unknown as Record<string, unknown>).__sheetOpen = true;
      }
    },
    [activeSheet, bookKey, setHoveredBookKey],
  );

  const handleCloseSheet = useCallback(() => {
    setActiveSheet(null);
    (window as unknown as Record<string, unknown>).__sheetOpen = false;
  }, []);

  // Register native footer action handler for iOS
  useEffect(() => {
    if (!useNativeBar) return;
    window.__nativeFooterAction = (action: string) => {
      if (action === 'toc' || action === 'chat' || action === 'settings') {
        handleOpenSheet(action);
      }
    };
    return () => {
      window.__nativeFooterAction = undefined;
    };
  }, [useNativeBar, handleOpenSheet]);

  // Sync active tab highlight to native footer bar
  useEffect(() => {
    if (useNativeBar) {
      setNativeFooterActiveTab(activeSheet);
    }
  }, [useNativeBar, activeSheet]);

  // Called when a chat conversation is selected from the HalfSheet history.
  // Closes the sheet and hides the footer so only the notebook is visible.
  const handleConversationSelected = useCallback(() => {
    handleCloseSheet();
    setHoveredBookKey('');
  }, [handleCloseSheet, setHoveredBookKey]);

  const buttons: { key: SheetType; label: string; Icon: IconType }[] = [
    { key: 'toc', label: _('Table of Contents'), Icon: IoIosList },
    { key: 'chat', label: _('Chat'), Icon: PiChatCircleBold },
    { key: 'settings', label: _('Settings'), Icon: IoSettingsOutline },
  ];

  return (
    <>
      {/* On iOS, the native UIKit footer bar handles the tab buttons.
          This web div is only rendered for non-iOS platforms. */}
      {!useNativeBar && (
        <div
          className='bg-base-200 z-30 mt-auto flex w-full justify-around px-8 py-3 sm:hidden'
          style={{ paddingBottom: `${Math.max(12, (safeAreaInsets?.bottom || 0) * 0.33 + 12)}px` }}
        >
          {buttons.map(({ key, label, Icon }) => (
            <button
              key={key}
              className={clsx(
                'flex flex-col items-center gap-0.5 rounded-lg px-4 py-1 transition-colors',
                activeSheet === key ? 'text-blue-500' : 'text-base-content/70',
              )}
              onClick={() => handleOpenSheet(key)}
              aria-label={label}
            >
              <Icon size={22} />
              <span className='text-[10px] font-medium'>{label}</span>
            </button>
          ))}
        </div>
      )}

      {/* Single HalfSheet stays mounted while any tab is active.
          Content switches inside — no unmount/remount flicker between tabs. */}
      <HalfSheet isOpen={activeSheet !== null} onClose={handleCloseSheet}>
        <div className='min-h-[40vh] flex-1 overflow-y-auto'>
          {activeSheet === 'toc' && <MobileTOCContent bookKey={bookKey} />}
          {activeSheet === 'chat' && (
            <MobileChatContent
              bookKey={bookKey}
              onConversationSelected={handleConversationSelected}
            />
          )}
          {activeSheet === 'settings' && (
            <MobileSettingsContent bookKey={bookKey} onClose={handleCloseSheet} />
          )}
        </div>
      </HalfSheet>
    </>
  );
}

export default MobileFooterBarV2;
