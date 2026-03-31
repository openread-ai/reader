import clsx from 'clsx';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PiSun, PiMoon } from 'react-icons/pi';
import { TbSunMoon, TbBoxMargin } from 'react-icons/tb';
import { RxLineHeight } from 'react-icons/rx';
import { useEnv } from '@/context/EnvContext';
import { useReaderStore } from '@/store/readerStore';
import { useThemeStore } from '@/store/themeStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useDeviceControlStore } from '@/store/deviceStore';
import { useTranslation } from '@/hooks/useTranslation';
import { saveSysSettings, saveViewSettings } from '@/helpers/settings';
import { themes } from '@/styles/themes';
import { debounce } from '@/utils/debounce';
import Slider from '@/components/Slider';
const FONT_SIZE_LIMITS = { MIN: 8, MAX: 30, DEFAULT: 16 } as const;
const LINE_HEIGHT_LIMITS = { MIN: 8, MAX: 24, MULTIPLIER: 10 } as const;
const MARGIN_CONSTANTS = { MAX_MARGIN_PX: 88, MAX_GAP_PERCENT: 10, MARGIN_RATIO: 50 } as const;
const SCREEN_BRIGHTNESS_LIMITS = { MIN: 0, MAX: 100, DEFAULT: 50 } as const;

export function MobileSettingsContent({ bookKey }: { bookKey: string; onClose?: () => void }) {
  return <MobileSettingsInner bookKey={bookKey} />;
}

function MobileSettingsInner({ bookKey }: { bookKey: string }) {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { getView, getViewSettings } = useReaderStore();
  const { themeMode, themeColor, isDarkMode, setThemeMode, setThemeColor } = useThemeStore();
  const { settings } = useSettingsStore();
  const { getScreenBrightness, setScreenBrightness } = useDeviceControlStore();
  const viewSettings = getViewSettings(bookKey);
  const view = getView(bookKey);

  const [screenBrightnessValue, setScreenBrightnessValue] = useState(
    settings.screenBrightness >= 0 ? settings.screenBrightness : SCREEN_BRIGHTNESS_LIMITS.DEFAULT,
  );

  // Sync brightness on open
  useEffect(() => {
    if (!appService?.isMobileApp) return;
    getScreenBrightness().then((brightness) => {
      if (brightness >= 0.0 && brightness <= 1.0) {
        setScreenBrightnessValue(Math.round(brightness * 100));
      }
    });
  }, [appService, getScreenBrightness]);

  const debouncedSetScreenBrightness = useMemo(
    () =>
      debounce(async (value: number) => {
        saveSysSettings(envConfig, 'screenBrightness', value);
        saveSysSettings(envConfig, 'autoScreenBrightness', false);
        await setScreenBrightness(value / 100);
      }, 100),
    [envConfig, setScreenBrightness],
  );

  const handleScreenBrightnessChange = useCallback(
    (value: number) => {
      setScreenBrightnessValue(value);
      debouncedSetScreenBrightness(value);
    },
    [debouncedSetScreenBrightness],
  );

  const handleFontSizeChange = useCallback(
    (value: number) => {
      saveViewSettings(envConfig, bookKey, 'defaultFontSize', value);
    },
    [envConfig, bookKey],
  );

  const handleMarginChange = useCallback(
    (value: number) => {
      const currentViewSettings = getViewSettings(bookKey);
      if (!currentViewSettings) return;

      const { MAX_MARGIN_PX, MAX_GAP_PERCENT } = MARGIN_CONSTANTS;
      const marginPx = Math.round((value / 100) * MAX_MARGIN_PX);
      const gapPercent = Math.round((value / 100) * MAX_GAP_PERCENT);

      currentViewSettings.marginTopPx = marginPx;
      currentViewSettings.marginBottomPx = marginPx / 2;
      currentViewSettings.marginLeftPx = marginPx / 2;
      currentViewSettings.marginRightPx = marginPx / 2;

      saveViewSettings(envConfig, bookKey, 'gapPercent', gapPercent, false, false);
      view?.renderer.setAttribute('margin', `${marginPx}px`);
      view?.renderer.setAttribute('gap', `${gapPercent}%`);

      if (currentViewSettings?.scrolled) {
        view?.renderer.setAttribute('flow', 'scrolled');
      }
    },
    [envConfig, bookKey, view, getViewSettings],
  );

  const handleLineHeightChange = useCallback(
    (value: number) => {
      saveViewSettings(envConfig, bookKey, 'lineHeight', value / LINE_HEIGHT_LIMITS.MULTIPLIER);
    },
    [envConfig, bookKey],
  );

  const getMarginProgressValue = useCallback((marginPx: number, gapPercent: number) => {
    const { MAX_MARGIN_PX, MAX_GAP_PERCENT, MARGIN_RATIO } = MARGIN_CONSTANTS;
    return (marginPx / MAX_MARGIN_PX + gapPercent / MAX_GAP_PERCENT) * MARGIN_RATIO;
  }, []);

  const cycleThemeMode = () => {
    const modeOrder = { auto: 'light', light: 'dark', dark: 'auto' } as const;
    setThemeMode(modeOrder[themeMode]);
  };

  return (
    <>
      <div className='flex flex-col gap-6 px-4 pb-20'>
        {/* Font Family */}
        <div>
          <label className='text-base-content/60 mb-2 block text-xs font-medium'>{_('Font')}</label>
          <div
            className='flex gap-2 overflow-x-auto pb-1'
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          >
            {[
              { id: '', label: _('Default') },
              { id: 'Georgia', label: 'Georgia' },
              { id: 'Literata', label: 'Literata' },
              { id: 'Helvetica Neue', label: 'Helvetica' },
              { id: 'Open Sans', label: 'Open Sans' },
            ].map((font) => {
              const isSelected = (viewSettings?.defaultFont ?? '') === font.id;
              return (
                <button
                  key={font.id}
                  onClick={() => {
                    saveViewSettings(envConfig, bookKey, 'defaultFont', font.id);
                    if (font.id) {
                      saveViewSettings(envConfig, bookKey, 'overrideFont', true, false, false);
                    } else {
                      saveViewSettings(envConfig, bookKey, 'overrideFont', false, false, false);
                    }
                  }}
                  className={clsx(
                    'flex h-[100px] w-[100px] flex-shrink-0 flex-col items-center justify-between rounded-xl p-3 transition-colors',
                    isSelected
                      ? 'bg-base-content/12 ring-base-content/40 ring-1.5'
                      : 'bg-base-300/40',
                  )}
                >
                  <span
                    className='text-base-content/80 line-clamp-3 text-center text-[11px] leading-[1.4]'
                    style={{ fontFamily: font.id || 'inherit' }}
                  >
                    It was the best of times, it was the worst of times...
                  </span>
                  <span
                    className={clsx(
                      'mt-1 w-full truncate text-center text-[10px]',
                      isSelected ? 'text-base-content font-semibold' : 'text-base-content/50',
                    )}
                  >
                    {font.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Font Size */}
        <div>
          <label className='text-base-content/60 mb-2 block text-xs font-medium'>
            {_('Font Size')}
          </label>
          <Slider
            label={_('Font Size')}
            initialValue={viewSettings?.defaultFontSize ?? FONT_SIZE_LIMITS.DEFAULT}
            bubbleLabel={`${viewSettings?.defaultFontSize ?? FONT_SIZE_LIMITS.DEFAULT}`}
            minLabel='A'
            maxLabel='A'
            minClassName='text-xs'
            maxClassName='text-base'
            onChange={handleFontSizeChange}
            min={FONT_SIZE_LIMITS.MIN}
            max={FONT_SIZE_LIMITS.MAX}
          />
        </div>

        {/* Brightness */}
        {appService?.hasScreenBrightness && (
          <div>
            <label className='text-base-content/60 mb-2 block text-xs font-medium'>
              {_('Brightness')}
            </label>
            <Slider
              label={_('Screen Brightness')}
              initialValue={screenBrightnessValue}
              bubbleLabel={`${screenBrightnessValue}`}
              minIcon={<PiSun size={16} />}
              maxIcon={<PiSun size={24} />}
              onChange={handleScreenBrightnessChange}
              min={SCREEN_BRIGHTNESS_LIMITS.MIN}
              max={SCREEN_BRIGHTNESS_LIMITS.MAX}
              valueToPosition={(value: number, min: number, max: number): number => {
                if (value <= min) return 0;
                if (value >= max) return 100;
                return Math.pow(value / max, 0.5) * 100;
              }}
              positionToValue={(position: number, min: number, max: number): number => {
                if (position <= 0) return min;
                if (position >= 100) return max;
                return Math.max(min, Math.min(max, Math.pow(position / 100, 2) * max));
              }}
            />
          </div>
        )}

        {/* Line Spacing */}
        <div>
          <label className='text-base-content/60 mb-2 block text-xs font-medium'>
            {_('Line Spacing')}
          </label>
          <Slider
            label={_('Line Spacing')}
            initialValue={(viewSettings?.lineHeight ?? 1.6) * LINE_HEIGHT_LIMITS.MULTIPLIER}
            bubbleElement={<RxLineHeight size={20} />}
            minLabel={_('Small')}
            maxLabel={_('Large')}
            min={LINE_HEIGHT_LIMITS.MIN}
            max={LINE_HEIGHT_LIMITS.MAX}
            onChange={handleLineHeightChange}
          />
        </div>

        {/* Margins */}
        <div>
          <label className='text-base-content/60 mb-2 block text-xs font-medium'>
            {_('Margins')}
          </label>
          <Slider
            label={_('Page Margin')}
            initialValue={getMarginProgressValue(
              viewSettings?.marginTopPx ?? 44,
              viewSettings?.gapPercent ?? 5,
            )}
            bubbleElement={<TbBoxMargin size={20} />}
            minLabel={_('Small')}
            maxLabel={_('Large')}
            step={10}
            onChange={handleMarginChange}
          />
        </div>

        {/* Theme colors */}
        <div>
          <label className='text-base-content/60 mb-2 block text-xs font-medium'>
            {_('Theme')}
          </label>
          <div
            className='flex gap-2.5 overflow-x-auto pb-1'
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          >
            {themes.map(({ name, label, colors }) => {
              const isSelected = themeColor === name;
              const bg = isDarkMode ? colors.dark['base-100'] : colors.light['base-100'];
              const fg = isDarkMode ? colors.dark['base-content'] : colors.light['base-content'];
              return (
                <button
                  key={name}
                  onClick={() => setThemeColor(name)}
                  className='flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full transition-all hover:opacity-80'
                  style={{
                    backgroundColor: bg,
                    color: fg,
                    border: `1.5px solid ${fg}20`,
                  }}
                  aria-label={_(label)}
                >
                  {isSelected ? (
                    <svg width='16' height='16' viewBox='0 0 16 16' fill='none'>
                      <path
                        d='M3.5 8.5L6.5 11.5L12.5 5.5'
                        stroke='currentColor'
                        strokeWidth='2'
                        strokeLinecap='round'
                        strokeLinejoin='round'
                      />
                    </svg>
                  ) : (
                    <span className='text-[10px] font-medium'>{_(label).charAt(0)}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Dark Mode toggle */}
        <div>
          <label className='text-base-content/60 mb-2 block text-xs font-medium'>
            {_('Dark Mode')}
          </label>
          <div className='bg-base-200 flex rounded-lg p-1'>
            {(
              [
                { key: 'auto', label: _('Auto'), Icon: TbSunMoon },
                { key: 'light', label: _('Light'), Icon: PiSun },
                { key: 'dark', label: _('Dark'), Icon: PiMoon },
              ] as const
            ).map(({ key, label, Icon }) => (
              <button
                key={key}
                onClick={() => (key === themeMode ? cycleThemeMode() : setThemeMode(key))}
                className={clsx(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium transition-colors',
                  themeMode === key
                    ? 'bg-base-100 text-base-content shadow-sm'
                    : 'text-base-content/50',
                )}
              >
                <Icon size={14} />
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

export default MobileSettingsContent;
