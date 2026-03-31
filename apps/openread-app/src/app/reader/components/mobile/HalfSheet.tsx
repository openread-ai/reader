import clsx from 'clsx';
import { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { impactFeedback } from '@tauri-apps/plugin-haptics';
import { PiCaretLeftBold } from 'react-icons/pi';
import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useDrag } from '@/hooks/useDrag';

const VELOCITY_THRESHOLD = 0.5;
const EXPAND_DRAG_THRESHOLD = 80; // px dragged up to expand

interface HalfSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}

function HalfSheet({ isOpen, onClose, title, children }: HalfSheetProps) {
  const { appService } = useEnv();
  const { safeAreaInsets } = useThemeStore();
  const sheetRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const translateY = useRef(0);
  const dragStartY = useRef(0);
  const [isExpanded, setIsExpanded] = useState(false);

  const handleDragMove = useCallback(
    (data: { clientY: number }) => {
      const sheet = sheetRef.current;
      const overlay = overlayRef.current;
      if (!sheet) return;

      const sheetRect = sheet.getBoundingClientRect();
      const sheetTop = sheetRect.top;
      const delta = data.clientY - sheetTop;

      if (dragStartY.current === 0) {
        dragStartY.current = data.clientY;
      }

      // Allow dragging up (negative delta) for expand, down for dismiss
      if (delta < 0 && !isExpanded) {
        // Dragging up — resist slightly (rubber band)
        const resistance = Math.max(-100, delta * 0.3);
        sheet.style.transition = 'none';
        sheet.style.transform = `translateY(${resistance}px)`;
      } else if (delta > 0) {
        // Dragging down — normal dismiss behavior
        translateY.current = delta;
        sheet.style.transition = 'none';
        sheet.style.transform = `translateY(${delta}px)`;
        if (overlay) {
          const progress = Math.min(1, delta / sheetRect.height);
          overlay.style.transition = 'none';
          overlay.style.opacity = `${0.2 * (1 - progress)}`;
        }
      }
    },
    [isExpanded],
  );

  const handleDragEnd = useCallback(
    (data: { velocity: number; deltaY: number }) => {
      const sheet = sheetRef.current;
      const overlay = overlayRef.current;
      if (!sheet) return;

      const draggedUp = data.deltaY < -EXPAND_DRAG_THRESHOLD;
      const draggedDown = data.deltaY > 0;

      if (draggedUp && !isExpanded) {
        // Expand to full screen
        setIsExpanded(true);
        sheet.style.transition = 'all 0.3s ease-out';
        sheet.style.transform = 'translateY(0)';
        if (appService?.hasHaptics) impactFeedback('medium');
      } else if (draggedDown) {
        const sheetHeight = sheet.getBoundingClientRect().height;
        const shouldDismiss =
          data.velocity > VELOCITY_THRESHOLD ||
          (data.velocity >= 0 && data.deltaY > sheetHeight * 0.3);

        if (shouldDismiss) {
          if (isExpanded) {
            // Collapse back to half from full
            setIsExpanded(false);
            sheet.style.transition = 'all 0.3s ease-out';
            sheet.style.transform = 'translateY(0)';
          } else {
            // Dismiss
            const speed = Math.max(data.velocity, 0.5);
            const duration = Math.min(0.3, 0.15 / speed);
            sheet.style.transition = `transform ${duration}s ease-out`;
            sheet.style.transform = 'translateY(100%)';
            if (overlay) {
              overlay.style.transition = `opacity ${duration}s ease-out`;
              overlay.style.opacity = '0';
            }
            if (appService?.hasHaptics) impactFeedback('medium');
            setTimeout(onClose, duration * 1000);
          }
        } else {
          // Snap back
          sheet.style.transition = 'transform 0.3s ease-out';
          sheet.style.transform = 'translateY(0)';
          if (overlay) {
            overlay.style.transition = 'opacity 0.3s ease-out';
            overlay.style.opacity = '0.2';
          }
        }
      } else {
        // Snap back from small drag
        sheet.style.transition = 'transform 0.3s ease-out';
        sheet.style.transform = 'translateY(0)';
      }

      translateY.current = 0;
      dragStartY.current = 0;
    },
    [appService, isExpanded, onClose],
  );

  const noop = useCallback(() => {}, []);
  const { handleDragStart } = useDrag(handleDragMove, noop, handleDragEnd);

  // Reset to half-sheet when closed so it opens as half next time
  if (!isOpen) {
    if (isExpanded) setIsExpanded(false);
    return null;
  }

  return createPortal(
    <div className='fixed inset-0 z-40' role='none' onClick={(e) => e.stopPropagation()}>
      <div
        ref={overlayRef}
        className='animate-in fade-in absolute inset-0 bg-black/20 duration-200'
        onClick={onClose}
        role='none'
      />

      <div
        ref={sheetRef}
        className={clsx(
          'absolute bottom-0 left-0 right-0',
          'bg-base-200/90 shadow-2xl backdrop-blur-xl',
          'flex flex-col',
          'animate-in slide-in-from-bottom duration-200',
          isExpanded ? 'rounded-none' : 'rounded-t-2xl',
        )}
        style={{
          maxHeight: isExpanded ? '100vh' : '60vh',
          height: isExpanded ? '100vh' : undefined,
          paddingBottom: `${safeAreaInsets?.bottom || 0}px`,
          paddingTop: isExpanded ? `${safeAreaInsets?.top || 0}px` : undefined,
          transition: 'max-height 0.3s ease-out, height 0.3s ease-out, border-radius 0.3s ease-out',
        }}
      >
        {/* Expanded: back button header */}
        {isExpanded ? (
          <div className='flex items-center gap-2 px-4 pb-2 pt-2'>
            <button onClick={onClose} className='text-base-content/70 p-1'>
              <PiCaretLeftBold size={18} />
            </button>
            {title && <h2 className='text-base-content text-sm font-semibold'>{title}</h2>}
          </div>
        ) : (
          /* Half: drag handle */
          <div
            className='flex w-full cursor-grab items-center justify-center pb-1 pt-3 active:cursor-grabbing'
            onMouseDown={handleDragStart}
            onTouchStart={handleDragStart}
            role='none'
          >
            <div className='bg-base-content/20 h-1 w-10 rounded-full' />
          </div>
        )}

        {!isExpanded && title && (
          <div className='px-4 pb-2'>
            <h2 className='text-base-content text-sm font-semibold'>{title}</h2>
          </div>
        )}

        <div className='flex-1 overflow-y-auto overscroll-contain'>{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export default HalfSheet;
