import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { LimitReachedCard } from '@/components/assistant/LimitReachedCard';

// Mock useTranslation
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, options?: Record<string, string>) => {
    if (options) {
      return Object.entries(options).reduce((result, [k, v]) => result.replace(`{{${k}}}`, v), key);
    }
    return key;
  },
}));

describe('LimitReachedCard', () => {
  const mockOnUpgrade = vi.fn();
  const mockOnDismiss = vi.fn();
  const mockOnAddBoost = vi.fn();
  const mockOnUseBoost = vi.fn();

  // A resetAt time 8 hours and 23 minutes from "now"
  const futureResetAt = new Date(Date.now() + 8 * 60 * 60 * 1000 + 23 * 60 * 1000).toISOString();
  // A resetAt time in the past
  const pastResetAt = new Date(Date.now() - 60 * 1000).toISOString();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  // ─── Daily limit (default) ────────────────────────────────────────

  it('should render the card with daily title and description by default', () => {
    render(
      <LimitReachedCard
        resetAt={futureResetAt}
        onUpgrade={mockOnUpgrade}
        onDismiss={mockOnDismiss}
      />,
    );

    expect(screen.getByText('Daily limit reached')).toBeTruthy();
    expect(screen.getByText(/You've used all your AI messages for today/)).toBeTruthy();
  });

  it('should have role="alert" for accessibility', () => {
    render(
      <LimitReachedCard
        resetAt={futureResetAt}
        onUpgrade={mockOnUpgrade}
        onDismiss={mockOnDismiss}
      />,
    );

    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('should display the reset countdown', () => {
    render(
      <LimitReachedCard
        resetAt={futureResetAt}
        onUpgrade={mockOnUpgrade}
        onDismiss={mockOnDismiss}
      />,
    );

    // Should contain hours and minutes like "Resets in 8h 23m."
    expect(screen.getByText(/Resets in \d+h \d+m/)).toBeTruthy();
  });

  it('should not display countdown when resetAt is in the past', () => {
    render(
      <LimitReachedCard
        resetAt={pastResetAt}
        onUpgrade={mockOnUpgrade}
        onDismiss={mockOnDismiss}
      />,
    );

    // Should show the base text without a reset countdown
    expect(screen.getByText("You've used all your AI messages for today.")).toBeTruthy();
    expect(screen.queryByText(/Resets in/)).toBeNull();
  });

  it('should render Upgrade and Dismiss buttons', () => {
    render(
      <LimitReachedCard
        resetAt={futureResetAt}
        onUpgrade={mockOnUpgrade}
        onDismiss={mockOnDismiss}
      />,
    );

    expect(screen.getByText(/Upgrade/)).toBeTruthy();
    expect(screen.getByText('Dismiss')).toBeTruthy();
  });

  it('should call onUpgrade when Upgrade button is clicked', () => {
    render(
      <LimitReachedCard
        resetAt={futureResetAt}
        onUpgrade={mockOnUpgrade}
        onDismiss={mockOnDismiss}
      />,
    );

    fireEvent.click(screen.getByText(/Upgrade/));
    expect(mockOnUpgrade).toHaveBeenCalledOnce();
  });

  it('should call onDismiss when Dismiss button is clicked', () => {
    render(
      <LimitReachedCard
        resetAt={futureResetAt}
        onUpgrade={mockOnUpgrade}
        onDismiss={mockOnDismiss}
      />,
    );

    fireEvent.click(screen.getByText('Dismiss'));
    expect(mockOnDismiss).toHaveBeenCalledOnce();
  });

  it('should update countdown every minute', () => {
    // Set a known time for predictable results
    const now = new Date('2025-06-15T12:00:00Z').getTime();
    vi.setSystemTime(now);

    const resetAt = new Date(now + 2 * 60 * 60 * 1000 + 30 * 60 * 1000).toISOString(); // 2h 30m from now

    render(
      <LimitReachedCard resetAt={resetAt} onUpgrade={mockOnUpgrade} onDismiss={mockOnDismiss} />,
    );

    expect(screen.getByText(/Resets in 2h 30m/)).toBeTruthy();

    // Advance time by 1 minute
    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(screen.getByText(/Resets in 2h 29m/)).toBeTruthy();
  });

  it('should show only minutes when less than 1 hour left', () => {
    const now = new Date('2025-06-15T12:00:00Z').getTime();
    vi.setSystemTime(now);

    const resetAt = new Date(now + 45 * 60 * 1000).toISOString(); // 45 minutes from now

    render(
      <LimitReachedCard resetAt={resetAt} onUpgrade={mockOnUpgrade} onDismiss={mockOnDismiss} />,
    );

    expect(screen.getByText(/Resets in 45m/)).toBeTruthy();
  });

  // ─── Monthly limit ────────────────────────────────────────────────

  it('should render monthly title and description when limitType is monthly', () => {
    render(
      <LimitReachedCard
        resetAt={futureResetAt}
        limitType='monthly'
        onUpgrade={mockOnUpgrade}
        onDismiss={mockOnDismiss}
      />,
    );

    expect(screen.getByText('Monthly limit reached')).toBeTruthy();
    expect(screen.getByText(/You've used all your AI messages for this month/)).toBeTruthy();
  });

  it('should show days for monthly countdown when more than 1 day away', () => {
    const now = new Date('2025-06-15T12:00:00Z').getTime();
    vi.setSystemTime(now);

    // 15 days from now
    const resetAt = new Date(now + 15 * 24 * 60 * 60 * 1000).toISOString();

    render(
      <LimitReachedCard
        resetAt={resetAt}
        limitType='monthly'
        onUpgrade={mockOnUpgrade}
        onDismiss={mockOnDismiss}
      />,
    );

    expect(screen.getByText(/Resets in 15 days/)).toBeTruthy();
  });

  it('should show hours for monthly countdown when less than 1 day away', () => {
    const now = new Date('2025-06-15T12:00:00Z').getTime();
    vi.setSystemTime(now);

    // 18 hours from now
    const resetAt = new Date(now + 18 * 60 * 60 * 1000).toISOString();

    render(
      <LimitReachedCard
        resetAt={resetAt}
        limitType='monthly'
        onUpgrade={mockOnUpgrade}
        onDismiss={mockOnDismiss}
      />,
    );

    expect(screen.getByText(/Resets in 18h/)).toBeTruthy();
  });

  it('should not display countdown for monthly when resetAt is in the past', () => {
    render(
      <LimitReachedCard
        resetAt={pastResetAt}
        limitType='monthly'
        onUpgrade={mockOnUpgrade}
        onDismiss={mockOnDismiss}
      />,
    );

    expect(screen.getByText("You've used all your AI messages for this month.")).toBeTruthy();
    expect(screen.queryByText(/Resets in/)).toBeNull();
  });

  it('should default to daily when limitType is not provided', () => {
    render(
      <LimitReachedCard
        resetAt={futureResetAt}
        onUpgrade={mockOnUpgrade}
        onDismiss={mockOnDismiss}
      />,
    );

    expect(screen.getByText('Daily limit reached')).toBeTruthy();
  });

  // ─── Upgrade CTA (S4.1) ──────────────────────────────────────────

  it('should show Upgrade arrow button for free user (no boost)', () => {
    render(
      <LimitReachedCard
        resetAt={futureResetAt}
        limitType='daily'
        canBoost={false}
        onUpgrade={mockOnUpgrade}
        onDismiss={mockOnDismiss}
      />,
    );

    // Upgrade button present, no Add boost
    const upgradeBtn = screen.getByText(/Upgrade/);
    expect(upgradeBtn).toBeTruthy();
    expect(screen.queryByText(/Add boost/)).toBeNull();
    expect(screen.queryByText(/Use boost/)).toBeNull();
  });

  it('should NOT show boost options for free user', () => {
    render(
      <LimitReachedCard
        resetAt={futureResetAt}
        limitType='daily'
        canBoost={false}
        boostBalance={0}
        onUpgrade={mockOnUpgrade}
        onAddBoost={mockOnAddBoost}
        onUseBoost={mockOnUseBoost}
        onDismiss={mockOnDismiss}
      />,
    );

    expect(screen.queryByText(/Add boost/)).toBeNull();
    expect(screen.queryByText(/Use boost/)).toBeNull();
    expect(screen.queryByText(/boost messages remaining/)).toBeNull();
  });

  // ─── Paid user at limit, no boost balance (S4.1) ─────────────────

  it('should show Add boost button for paid user at limit with no boost balance', () => {
    render(
      <LimitReachedCard
        resetAt={futureResetAt}
        limitType='monthly'
        canBoost={true}
        boostBalance={0}
        onUpgrade={mockOnUpgrade}
        onAddBoost={mockOnAddBoost}
        onDismiss={mockOnDismiss}
      />,
    );

    expect(screen.getByText(/Upgrade/)).toBeTruthy();
    expect(screen.getByText(/Add boost/)).toBeTruthy();
    expect(screen.queryByText(/Use boost/)).toBeNull();
  });

  it('should call onAddBoost when Add boost is clicked', () => {
    render(
      <LimitReachedCard
        resetAt={futureResetAt}
        limitType='monthly'
        canBoost={true}
        boostBalance={0}
        onUpgrade={mockOnUpgrade}
        onAddBoost={mockOnAddBoost}
        onDismiss={mockOnDismiss}
      />,
    );

    fireEvent.click(screen.getByText(/Add boost/));
    expect(mockOnAddBoost).toHaveBeenCalledOnce();
  });

  // ─── Paid user with boost balance (S4.1) ──────────────────────────

  it('should show Use boost as primary and Upgrade as secondary when boost balance > 0', () => {
    render(
      <LimitReachedCard
        resetAt={futureResetAt}
        limitType='monthly'
        canBoost={true}
        boostBalance={15}
        onUpgrade={mockOnUpgrade}
        onAddBoost={mockOnAddBoost}
        onUseBoost={mockOnUseBoost}
        onDismiss={mockOnDismiss}
      />,
    );

    expect(screen.getByText('Use boost')).toBeTruthy();
    expect(screen.getByText(/Upgrade/)).toBeTruthy();
    expect(screen.queryByText(/Add boost/)).toBeNull();
  });

  it('should show boost balance message when boostBalance > 0', () => {
    render(
      <LimitReachedCard
        resetAt={futureResetAt}
        limitType='monthly'
        canBoost={true}
        boostBalance={15}
        onUpgrade={mockOnUpgrade}
        onUseBoost={mockOnUseBoost}
        onDismiss={mockOnDismiss}
      />,
    );

    expect(screen.getByText('15 boost messages remaining.')).toBeTruthy();
  });

  it('should call onUseBoost when Use boost is clicked', () => {
    render(
      <LimitReachedCard
        resetAt={futureResetAt}
        limitType='monthly'
        canBoost={true}
        boostBalance={10}
        onUpgrade={mockOnUpgrade}
        onUseBoost={mockOnUseBoost}
        onDismiss={mockOnDismiss}
      />,
    );

    fireEvent.click(screen.getByText('Use boost'));
    expect(mockOnUseBoost).toHaveBeenCalledOnce();
  });

  it('should not show boost balance message when boostBalance is 0', () => {
    render(
      <LimitReachedCard
        resetAt={futureResetAt}
        limitType='monthly'
        canBoost={true}
        boostBalance={0}
        onUpgrade={mockOnUpgrade}
        onDismiss={mockOnDismiss}
      />,
    );

    expect(screen.queryByText(/boost messages remaining/)).toBeNull();
  });
});
