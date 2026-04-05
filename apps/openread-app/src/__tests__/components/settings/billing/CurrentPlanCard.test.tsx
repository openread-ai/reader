import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { CurrentPlanCard } from '@/components/settings/billing/CurrentPlanCard';
import type { Subscription } from '@/hooks/useSubscription';

// ─── Mocks ───────────────────────────────────────────────────────────

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, vars?: Record<string, unknown>) => {
    if (!vars) return key;
    let result = key;
    for (const [k, v] of Object.entries(vars)) {
      result = result.replace(`{{${k}}}`, String(v));
    }
    return result;
  },
}));

vi.mock('@/utils/tailwind', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

vi.mock('@/components/settings/cancel-subscription-dialog', () => ({
  CancelSubscriptionDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid='cancel-dialog'>Cancel Dialog</div> : null,
}));

// ─── Helpers ─────────────────────────────────────────────────────────

// Use noon UTC to avoid date shifting across timezones
function makeSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    planId: 'reader',
    planName: 'Reader',
    status: 'active',
    currentPeriodEnd: new Date('2026-05-01T12:00:00Z'),
    cancelAtPeriodEnd: false,
    ...overrides,
  };
}

/** Format a date the same way the component does, for assertion stability. */
function expectedDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('CurrentPlanCard', () => {
  const mockOnManage = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('should show loading skeleton when isLoading is true', () => {
    render(<CurrentPlanCard subscription={null} isLoading onManagePlan={mockOnManage} />);
    const skeletons = document.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('should show simplified free plan view when subscription is null', () => {
    render(<CurrentPlanCard subscription={null} onManagePlan={mockOnManage} />);
    expect(screen.getByText("You're on the Free plan")).toBeTruthy();
    expect(screen.getByText('Upgrade')).toBeTruthy();
  });

  it('should show simplified free plan view when planId is free', () => {
    const sub = makeSubscription({ planId: 'free', planName: 'Free' });
    render(<CurrentPlanCard subscription={sub} onManagePlan={mockOnManage} />);
    expect(screen.getByText("You're on the Free plan")).toBeTruthy();
  });

  it('should display plan name for paid subscription', () => {
    const sub = makeSubscription();
    render(<CurrentPlanCard subscription={sub} onManagePlan={mockOnManage} />);
    expect(screen.getByText('Reader')).toBeTruthy();
  });

  it('should show next billing date', () => {
    const periodEnd = new Date('2026-05-01T12:00:00Z');
    const sub = makeSubscription({ currentPeriodEnd: periodEnd });
    render(<CurrentPlanCard subscription={sub} onManagePlan={mockOnManage} />);
    const expected = expectedDate(periodEnd);
    expect(screen.getByText(new RegExp(`Next billing: ${expected}`))).toBeTruthy();
  });

  it('should show cancellation date when cancelAtPeriodEnd is true', () => {
    const periodEnd = new Date('2026-05-01T12:00:00Z');
    const sub = makeSubscription({
      cancelAtPeriodEnd: true,
      currentPeriodEnd: periodEnd,
    });
    render(<CurrentPlanCard subscription={sub} onManagePlan={mockOnManage} />);
    const expected = expectedDate(periodEnd);
    expect(screen.getByText(new RegExp(`Cancels on ${expected}`))).toBeTruthy();
  });

  it('should show status badge', () => {
    const sub = makeSubscription({ status: 'active' });
    render(<CurrentPlanCard subscription={sub} onManagePlan={mockOnManage} />);
    expect(screen.getByText('active')).toBeTruthy();
  });

  it('should show Trial label for trialing status', () => {
    const sub = makeSubscription({ status: 'trialing' });
    render(<CurrentPlanCard subscription={sub} onManagePlan={mockOnManage} />);
    expect(screen.getByText('Trial')).toBeTruthy();
  });

  it('should show via Stripe source label', () => {
    const sub = makeSubscription();
    render(<CurrentPlanCard subscription={sub} onManagePlan={mockOnManage} />);
    expect(screen.getByText(/via Stripe/)).toBeTruthy();
  });

  it('should show Manage Plan button', () => {
    const sub = makeSubscription();
    render(<CurrentPlanCard subscription={sub} onManagePlan={mockOnManage} />);
    expect(screen.getByText('Manage Plan')).toBeTruthy();
  });

  it('should call onManagePlan when clicking Manage Plan', async () => {
    const sub = makeSubscription();
    render(<CurrentPlanCard subscription={sub} onManagePlan={mockOnManage} />);

    fireEvent.click(screen.getByText('Manage Plan'));

    await waitFor(() => {
      expect(mockOnManage).toHaveBeenCalled();
    });
  });

  it('should show Cancel button when not already canceling', () => {
    const sub = makeSubscription({ cancelAtPeriodEnd: false });
    render(<CurrentPlanCard subscription={sub} onManagePlan={mockOnManage} />);
    expect(screen.getByText('Cancel')).toBeTruthy();
  });

  it('should hide Cancel button when cancelAtPeriodEnd is true', () => {
    const sub = makeSubscription({ cancelAtPeriodEnd: true });
    render(<CurrentPlanCard subscription={sub} onManagePlan={mockOnManage} />);
    expect(screen.queryByText('Cancel')).toBeNull();
  });

  it('should open cancel dialog when clicking Cancel', () => {
    const sub = makeSubscription();
    render(<CurrentPlanCard subscription={sub} onManagePlan={mockOnManage} />);

    fireEvent.click(screen.getByText('Cancel'));

    expect(screen.getByTestId('cancel-dialog')).toBeTruthy();
  });
});
