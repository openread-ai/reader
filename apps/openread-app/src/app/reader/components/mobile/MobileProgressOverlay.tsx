import { useCallback, useEffect, useRef, useState } from 'react';
import {
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiArrowGoBackLine,
  RiArrowGoForwardLine,
  RiArrowLeftDoubleLine,
  RiArrowRightDoubleLine,
} from 'react-icons/ri';
import { getNavigationIcon, getNavigationLabel, getNavigationHandler } from '../footerbar/utils';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { NavigationHandlers } from '../footerbar/types';
import { Insets } from '@/types/misc';
import Button from '@/components/Button';
import Slider from '@/components/Slider';

const AUTO_HIDE_MS = 5000;
const HEADER_HEIGHT = 44; // h-11 = 2.75rem = 44px

interface MobileProgressOverlayProps {
  bookKey: string;
  isOpen: boolean;
  onClose: () => void;
  progressFraction: number;
  progressValid: boolean;
  navigationHandlers: NavigationHandlers;
  gridInsets: Insets;
}

function MobileProgressOverlay({
  bookKey,
  isOpen,
  onClose,
  progressFraction,
  progressValid,
  navigationHandlers,
  gridInsets,
}: MobileProgressOverlayProps) {
  const _ = useTranslation();
  const { getView, getViewSettings } = useReaderStore();
  const viewSettings = getViewSettings(bookKey);
  const view = getView(bookKey);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [progressValue, setProgressValue] = useState(progressValid ? progressFraction * 100 : 0);

  useEffect(() => {
    if (progressValid) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProgressValue(progressFraction * 100);
    }
  }, [progressValid, progressFraction]);

  // Auto-hide timer
  const resetTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(onClose, AUTO_HIDE_MS);
  }, [onClose]);

  useEffect(() => {
    if (isOpen) {
      resetTimer();
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isOpen, resetTimer]);

  const handleProgressChange = useCallback(
    (value: number) => {
      setProgressValue(value);
      navigationHandlers.onProgressChange(value);
      resetTimer();
    },
    [navigationHandlers, resetTimer],
  );

  const handleNavClick = useCallback(
    (handler: () => void) => {
      handler();
      resetTimer();
    },
    [resetTimer],
  );

  if (!isOpen) return null;

  return (
    <div
      className='bg-base-100/95 animate-in slide-in-from-top-2 absolute left-0 right-0 z-20 px-4 pb-3 pt-3 shadow-md backdrop-blur-lg duration-200'
      style={{ top: `${gridInsets.top + HEADER_HEIGHT}px` }}
      onTouchStart={resetTimer}
    >
      <div className='mb-2'>
        <Slider
          label={_('Reading Progress')}
          heightPx={28}
          bubbleLabel={`${Math.round(progressValue)}%`}
          initialValue={progressValue}
          onChange={handleProgressChange}
        />
      </div>

      <div className='flex items-center justify-between gap-x-4'>
        <Button
          icon={getNavigationIcon(
            viewSettings?.rtl,
            <RiArrowLeftDoubleLine />,
            <RiArrowRightDoubleLine />,
          )}
          onClick={() =>
            handleNavClick(
              getNavigationHandler(
                viewSettings?.rtl,
                navigationHandlers.onPrevSection,
                navigationHandlers.onNextSection,
              ),
            )
          }
          label={getNavigationLabel(viewSettings?.rtl, _('Previous Section'), _('Next Section'))}
        />
        <Button
          icon={getNavigationIcon(viewSettings?.rtl, <RiArrowLeftSLine />, <RiArrowRightSLine />)}
          onClick={() =>
            handleNavClick(
              getNavigationHandler(
                viewSettings?.rtl,
                navigationHandlers.onPrevPage,
                navigationHandlers.onNextPage,
              ),
            )
          }
          label={getNavigationLabel(viewSettings?.rtl, _('Previous Page'), _('Next Page'))}
        />
        <Button
          icon={getNavigationIcon(
            viewSettings?.rtl,
            <RiArrowGoBackLine />,
            <RiArrowGoForwardLine />,
          )}
          onClick={() => handleNavClick(navigationHandlers.onGoBack)}
          label={_('Go Back')}
          disabled={!view?.history.canGoBack}
        />
        <Button
          icon={getNavigationIcon(
            viewSettings?.rtl,
            <RiArrowGoForwardLine />,
            <RiArrowGoBackLine />,
          )}
          onClick={() => handleNavClick(navigationHandlers.onGoForward)}
          label={_('Go Forward')}
          disabled={!view?.history.canGoForward}
        />
        <Button
          icon={getNavigationIcon(viewSettings?.rtl, <RiArrowRightSLine />, <RiArrowLeftSLine />)}
          onClick={() =>
            handleNavClick(
              getNavigationHandler(
                viewSettings?.rtl,
                navigationHandlers.onNextPage,
                navigationHandlers.onPrevPage,
              ),
            )
          }
          label={getNavigationLabel(viewSettings?.rtl, _('Next Page'), _('Previous Page'))}
        />
        <Button
          icon={getNavigationIcon(
            viewSettings?.rtl,
            <RiArrowRightDoubleLine />,
            <RiArrowLeftDoubleLine />,
          )}
          onClick={() =>
            handleNavClick(
              getNavigationHandler(
                viewSettings?.rtl,
                navigationHandlers.onNextSection,
                navigationHandlers.onPrevSection,
              ),
            )
          }
          label={getNavigationLabel(viewSettings?.rtl, _('Next Section'), _('Previous Section'))}
        />
      </div>
    </div>
  );
}

export default MobileProgressOverlay;
