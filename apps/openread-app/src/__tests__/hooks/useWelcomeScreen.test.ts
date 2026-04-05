import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWelcomeScreen, WELCOME_SEEN_KEY } from '@/hooks/useWelcomeScreen';

describe('useWelcomeScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('should show welcome when localStorage flag is not set', () => {
    const { result } = renderHook(() => useWelcomeScreen());
    expect(result.current.showWelcome).toBe(true);
  });

  it('should not show welcome when localStorage flag is set', () => {
    localStorage.setItem(WELCOME_SEEN_KEY, '2024-01-01T00:00:00.000Z');
    const { result } = renderHook(() => useWelcomeScreen());
    expect(result.current.showWelcome).toBe(false);
  });

  it('should hide welcome after dismissWelcome is called', () => {
    const { result } = renderHook(() => useWelcomeScreen());
    expect(result.current.showWelcome).toBe(true);

    act(() => {
      result.current.dismissWelcome();
    });

    expect(result.current.showWelcome).toBe(false);
  });

  it('should persist dismissal to localStorage', () => {
    const { result } = renderHook(() => useWelcomeScreen());

    act(() => {
      result.current.dismissWelcome();
    });

    const stored = localStorage.getItem(WELCOME_SEEN_KEY);
    expect(stored).not.toBeNull();
    // Should be a valid ISO date string
    expect(new Date(stored!).toISOString()).toBe(stored);
  });

  it('should not show welcome after dismissal even on re-render', () => {
    const { result, rerender } = renderHook(() => useWelcomeScreen());

    act(() => {
      result.current.dismissWelcome();
    });

    rerender();
    expect(result.current.showWelcome).toBe(false);
  });

  it('should return a stable dismissWelcome function', () => {
    const { result, rerender } = renderHook(() => useWelcomeScreen());
    const firstRef = result.current.dismissWelcome;
    rerender();
    expect(result.current.dismissWelcome).toBe(firstRef);
  });

  it('should use the correct localStorage key', () => {
    expect(WELCOME_SEEN_KEY).toBe('has_seen_welcome');
  });
});
