import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import BillingPage from '@/app/(platform)/settings/billing/page';

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

const mockUseSubscription = vi.fn();
vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: () => mockUseSubscription(),
}));

// Mock all billing sub-components to isolate page-level tests
vi.mock('@/components/settings/billing', () => ({
  AIUsageMeter: ({ isLoading }: { isLoading?: boolean }) => (
    <div data-testid='ai-meter'>{isLoading ? 'loading' : 'ai-meter'}</div>
  ),
  StorageMeter: () => <div data-testid='storage-meter'>storage-meter</div>,
  MCPLimitDisplay: () => <div data-testid='mcp-display'>mcp-display</div>,
  UsageHistory: ({ isLoading }: { isLoading?: boolean }) => (
    <div data-testid='usage-history'>{isLoading ? 'loading' : 'usage-history'}</div>
  ),
  CurrentPlanCard: () => <div data-testid='current-plan'>current-plan</div>,
  PaymentMethod: () => <div data-testid='payment-method'>payment-method</div>,
  InvoiceList: () => <div data-testid='invoice-list'>invoice-list</div>,
}));

vi.mock('@/components/settings/plan-cards', () => ({
  PlanCards: () => <div data-testid='plan-cards'>plan-cards</div>,
}));

vi.mock('@/components/admin/BusinessHealthCard', () => ({
  BusinessHealthCard: () => <div data-testid='business-health-card'>business-health</div>,
}));

// ─── Tests ───────────────────────────────────────────────────────────

describe('BillingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('should show error state when useSubscription returns error', () => {
    mockUseSubscription.mockReturnValue({
      subscription: null,
      plans: [],
      invoices: [],
      isLoading: false,
      error: new Error('fail'),
      upgradeToPlan: vi.fn(),
      openPortal: vi.fn(),
    });

    render(<BillingPage />);
    expect(screen.getByText('Failed to load billing information')).toBeTruthy();
  });

  it('should show simplified free plan view for free users', () => {
    mockUseSubscription.mockReturnValue({
      subscription: null,
      plans: [],
      invoices: [],
      isLoading: false,
      error: null,
      upgradeToPlan: vi.fn(),
      openPortal: vi.fn(),
    });

    render(<BillingPage />);
    expect(screen.getByText("You're on the Free plan")).toBeTruthy();
    expect(screen.getByText('Upgrade')).toBeTruthy();
    // Should still show plan cards
    expect(screen.getByTestId('plan-cards')).toBeTruthy();
    // Should NOT show usage meters
    expect(screen.queryByTestId('ai-meter')).toBeNull();
    expect(screen.queryByTestId('storage-meter')).toBeNull();
  });

  it('should show full layout for paid users', () => {
    mockUseSubscription.mockReturnValue({
      subscription: {
        planId: 'reader',
        planName: 'Reader',
        status: 'active',
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
      },
      plans: [],
      invoices: [],
      isLoading: false,
      error: null,
      upgradeToPlan: vi.fn(),
      openPortal: vi.fn(),
    });

    render(<BillingPage />);

    // Top row meters
    expect(screen.getByTestId('ai-meter')).toBeTruthy();
    expect(screen.getByTestId('storage-meter')).toBeTruthy();
    expect(screen.getByTestId('mcp-display')).toBeTruthy();

    // Sections below
    expect(screen.getByTestId('usage-history')).toBeTruthy();
    expect(screen.getByTestId('current-plan')).toBeTruthy();
    expect(screen.getByTestId('payment-method')).toBeTruthy();
    expect(screen.getByTestId('invoice-list')).toBeTruthy();
    expect(screen.getByTestId('plan-cards')).toBeTruthy();
  });

  it('should show Available Plans heading for paid users', () => {
    mockUseSubscription.mockReturnValue({
      subscription: {
        planId: 'pro',
        planName: 'Pro',
        status: 'active',
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
      },
      plans: [],
      invoices: [],
      isLoading: false,
      error: null,
      upgradeToPlan: vi.fn(),
      openPortal: vi.fn(),
    });

    render(<BillingPage />);
    expect(screen.getByText('Available Plans')).toBeTruthy();
  });

  it('should show free user simplified view for free planId', () => {
    mockUseSubscription.mockReturnValue({
      subscription: {
        planId: 'free',
        planName: 'Free',
        status: 'active',
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
      },
      plans: [],
      invoices: [],
      isLoading: false,
      error: null,
      upgradeToPlan: vi.fn(),
      openPortal: vi.fn(),
    });

    render(<BillingPage />);
    expect(screen.getByText("You're on the Free plan")).toBeTruthy();
  });
});
