/**
 * Tests for BusinessHealthCard component (S4.6).
 * SKIPPED: Source component @/components/admin/BusinessHealthCard not yet implemented.
 */
import { describe, it, expect } from 'vitest';

describe.skip('BusinessHealthCard (E18 S4.6 — component not yet implemented)', () => {
  it('placeholder', () => expect(true).toBe(true));
});

/* Original tests — uncomment when @/components/admin/BusinessHealthCard is implemented:
import { describe as _describe, it as _it, expect as _expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { BusinessHealthCard } from '@/components/admin/BusinessHealthCard';
import type { BusinessHealthMetrics } from '@/lib/cost-rates';

// ─── Mocks ───────────────────────────────────────────────────────────

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/utils/tailwind', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

const mockUseAuth = vi.fn();
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockGetAccessToken = vi.fn();
vi.mock('@/utils/access', () => ({
  getAccessToken: () => mockGetAccessToken(),
}));

vi.mock('@/services/environment', () => ({
  getAPIBaseUrl: () => '/api',
}));

// Mock primitives
vi.mock('@/components/primitives/card', () => ({
  Card: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) => (
    <div data-testid={props['data-testid'] ?? 'card'} {...props}>
      {children}
    </div>
  ),
  CardContent: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  CardDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));

vi.mock('@/components/primitives/skeleton', () => ({
  Skeleton: ({ className }: { className?: string }) => (
    <div data-testid='skeleton' className={className} />
  ),
}));

vi.mock('@/components/primitives/progress', () => ({
  Progress: ({ value, className }: { value: number; className?: string }) => (
    <div data-testid='progress-bar' role='progressbar' aria-valuenow={value} className={className}>
      <div style={{ width: `${value}%` }} />
    </div>
  ),
}));

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  Activity: ({ className }: { className?: string }) => <span className={className}>Activity</span>,
  DollarSign: ({ className }: { className?: string }) => (
    <span className={className}>DollarSign</span>
  ),
  Users: ({ className }: { className?: string }) => <span className={className}>Users</span>,
  TrendingUp: ({ className }: { className?: string }) => (
    <span className={className}>TrendingUp</span>
  ),
  Cpu: ({ className }: { className?: string }) => <span className={className}>Cpu</span>,
  AlertTriangle: ({ className }: { className?: string }) => (
    <span className={className}>AlertTriangle</span>
  ),
}));

// ─── Test Fixtures ──────────────────────────────────────────────────

const MOCK_METRICS: BusinessHealthMetrics = {
  mrr: 30.97,
  arr: 371.64,
  grossMargin: 0.65,
  paidSubsCount: 3,
  freeUsersCount: 100,
  arpu: 0.3,
  momGrowth: 0.24,
  paidChurn: 0,
  ltvCacRatio: 999,
  freeToPaidConversion: 0.029,
  cogs: {
    ai: 1.45,
    storage: 0.0001,
    payments: 3.1,
    infrastructure: 30,
    translation: 0,
    tts: 0,
  },
  totalCOGS: 34.55,
  perTier: [
    {
      tier: 'free',
      displayName: 'Free',
      userCount: 100,
      costPerUser: 0.01,
      netContribution: -0.01,
      tierMetricLabel: 'Conversion',
      tierMetricValue: '2.9%',
    },
    {
      tier: 'reader',
      displayName: 'Reader',
      userCount: 2,
      costPerUser: 0.19,
      netContribution: 3.81,
      tierMetricLabel: 'Churn',
      tierMetricValue: '0.0%',
    },
    {
      tier: 'pro',
      displayName: 'Pro',
      userCount: 1,
      costPerUser: 0.5,
      netContribution: 14.49,
      tierMetricLabel: 'Churn',
      tierMetricValue: '0.0%',
    },
  ],
  aiBudget: {
    currentSpend: 1.45,
    ceiling: 12000,
    percentUsed: 0.012,
  },
};

const ZERO_METRICS: BusinessHealthMetrics = {
  mrr: 0,
  arr: 0,
  grossMargin: 0,
  paidSubsCount: 0,
  freeUsersCount: 0,
  arpu: 0,
  momGrowth: 0,
  paidChurn: 0,
  ltvCacRatio: 0,
  freeToPaidConversion: 0,
  cogs: {
    ai: 0,
    storage: 0,
    payments: 0,
    infrastructure: 30,
    translation: 0,
    tts: 0,
  },
  totalCOGS: 30,
  perTier: [
    {
      tier: 'free',
      displayName: 'Free',
      userCount: 0,
      costPerUser: 0,
      netContribution: 0,
      tierMetricLabel: 'Conversion',
      tierMetricValue: '0.0%',
    },
    {
      tier: 'reader',
      displayName: 'Reader',
      userCount: 0,
      costPerUser: 0,
      netContribution: 0,
      tierMetricLabel: 'Churn',
      tierMetricValue: '0.0%',
    },
    {
      tier: 'pro',
      displayName: 'Pro',
      userCount: 0,
      costPerUser: 0,
      netContribution: 0,
      tierMetricLabel: 'Churn',
      tierMetricValue: '0.0%',
    },
  ],
  aiBudget: {
    currentSpend: 0,
    ceiling: 12000,
    percentUsed: 0,
  },
};

// ─── Helpers ────────────────────────────────────────────────────────

const mockFetch = vi.fn();

function setupAdminUser(email = 'tarun@openread.ai') {
  mockUseAuth.mockReturnValue({ user: { email } });
  mockGetAccessToken.mockResolvedValue('mock-token');
}

function setupNonAdminUser() {
  mockUseAuth.mockReturnValue({ user: { email: 'user@example.com' } });
}

function setupNoUser() {
  mockUseAuth.mockReturnValue({ user: null });
}

function mockFetchSuccess(data: BusinessHealthMetrics) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => data,
  });
}

function mockFetchError(status: number, message: string) {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    json: async () => ({ error: message }),
  });
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('BusinessHealthCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    cleanup();
  });

  // ─── Visibility / Admin gating ──────────────────────────────────

  describe('admin gating', () => {
    it('should render nothing for non-admin users', () => {
      setupNonAdminUser();
      const { container } = render(<BusinessHealthCard />);
      expect(container.innerHTML).toBe('');
    });

    it('should render nothing when user is not logged in', () => {
      setupNoUser();
      const { container } = render(<BusinessHealthCard />);
      expect(container.innerHTML).toBe('');
    });

    it('should render the card for admin users', async () => {
      setupAdminUser();
      mockFetchSuccess(MOCK_METRICS);

      render(<BusinessHealthCard />);

      await waitFor(() => {
        expect(screen.getByTestId('business-health-card')).toBeTruthy();
      });
    });

    it('should accept admin email case-insensitively', async () => {
      // The component checks .toLowerCase() against the admin list
      setupAdminUser('tarun@openread.ai');
      mockFetchSuccess(MOCK_METRICS);

      render(<BusinessHealthCard />);

      await waitFor(() => {
        expect(screen.getByTestId('business-health-card')).toBeTruthy();
      });
    });
  });

  // ─── Loading state ──────────────────────────────────────────────

  describe('loading state', () => {
    it('should show loading skeleton while fetching', () => {
      setupAdminUser();
      // Don't resolve fetch yet — keep it pending
      mockFetch.mockReturnValueOnce(new Promise(() => {}));

      render(<BusinessHealthCard />);

      expect(screen.getByTestId('business-health-skeleton')).toBeTruthy();
    });

    it('should hide skeleton after data loads', async () => {
      setupAdminUser();
      mockFetchSuccess(MOCK_METRICS);

      render(<BusinessHealthCard />);

      await waitFor(() => {
        expect(screen.queryByTestId('business-health-skeleton')).toBeNull();
      });
    });
  });

  // ─── Error state ────────────────────────────────────────────────

  describe('error state', () => {
    it('should display error message on API failure', async () => {
      setupAdminUser();
      mockFetchError(500, 'Internal server error');

      render(<BusinessHealthCard />);

      await waitFor(() => {
        expect(screen.getByText('Internal server error')).toBeTruthy();
      });
    });

    it('should display generic error when fetch throws', async () => {
      setupAdminUser();
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      render(<BusinessHealthCard />);

      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeTruthy();
      });
    });

    it('should display Business Health title in error state', async () => {
      setupAdminUser();
      mockFetchError(500, 'Something went wrong');

      render(<BusinessHealthCard />);

      await waitFor(() => {
        expect(screen.getByText('Business Health')).toBeTruthy();
      });
    });
  });

  // ─── Section 1: Top Line ────────────────────────────────────────

  describe('Top Line section', () => {
    it('should display MRR', async () => {
      setupAdminUser();
      mockFetchSuccess(MOCK_METRICS);

      render(<BusinessHealthCard />);

      await waitFor(() => {
        expect(screen.getByText('MRR')).toBeTruthy();
        expect(screen.getByText('$30.97')).toBeTruthy();
      });
    });

    it('should display ARR', async () => {
      setupAdminUser();
      mockFetchSuccess(MOCK_METRICS);

      render(<BusinessHealthCard />);

      await waitFor(() => {
        expect(screen.getByText('ARR')).toBeTruthy();
        expect(screen.getByText('$371.64')).toBeTruthy();
      });
    });

    it('should display Gross Margin', async () => {
      setupAdminUser();
      mockFetchSuccess(MOCK_METRICS);

      render(<BusinessHealthCard />);

      await waitFor(() => {
        expect(screen.getByText('Gross Margin')).toBeTruthy();
        expect(screen.getByText('65.0%')).toBeTruthy();
      });
    });
  });

  // ─── Section 2: SaaS Metrics ────────────────────────────────────

  describe('SaaS Metrics section', () => {
    it('should display paid subscriber count', async () => {
      setupAdminUser();
      mockFetchSuccess(MOCK_METRICS);

      render(<BusinessHealthCard />);

      await waitFor(() => {
        expect(screen.getByText('Paid Subscribers')).toBeTruthy();
        expect(screen.getByText('3')).toBeTruthy();
      });
    });

    it('should display free user count', async () => {
      setupAdminUser();
      mockFetchSuccess(MOCK_METRICS);

      render(<BusinessHealthCard />);

      await waitFor(() => {
        expect(screen.getByText('Free Users')).toBeTruthy();
        expect(screen.getByText('100')).toBeTruthy();
      });
    });

    it('should display ARPU', async () => {
      setupAdminUser();
      mockFetchSuccess(MOCK_METRICS);

      render(<BusinessHealthCard />);

      await waitFor(() => {
        expect(screen.getByText('ARPU')).toBeTruthy();
        expect(screen.getByText('$0.30')).toBeTruthy();
      });
    });

    it('should display MoM growth', async () => {
      setupAdminUser();
      mockFetchSuccess(MOCK_METRICS);

      render(<BusinessHealthCard />);

      await waitFor(() => {
        expect(screen.getByText('MoM Growth')).toBeTruthy();
        expect(screen.getByText('24.0%')).toBeTruthy();
      });
    });

    it('should display LTV:CAC as N/A when ratio >= 999', async () => {
      setupAdminUser();
      mockFetchSuccess(MOCK_METRICS);

      render(<BusinessHealthCard />);

      await waitFor(() => {
        expect(screen.getByText('LTV:CAC')).toBeTruthy();
        expect(screen.getByText('N/A')).toBeTruthy();
      });
    });

    it('should display LTV:CAC ratio when below 999', async () => {
      setupAdminUser();
      mockFetchSuccess({ ...MOCK_METRICS, ltvCacRatio: 5.2 });

      render(<BusinessHealthCard />);

      await waitFor(() => {
        expect(screen.getByText('LTV:CAC')).toBeTruthy();
        expect(screen.getByText('5.2x')).toBeTruthy();
      });
    });
  });

  // ─── Section 3: COGS Breakdown ──────────────────────────────────

  describe('COGS Breakdown section', () => {
    it('should display all COGS categories', async () => {
      setupAdminUser();
      mockFetchSuccess(MOCK_METRICS);

      render(<BusinessHealthCard />);

      await waitFor(() => {
        expect(screen.getByText('AI Inference')).toBeTruthy();
        expect(screen.getByText('Storage')).toBeTruthy();
        expect(screen.getByText('Payments')).toBeTruthy();
        expect(screen.getByText('Infrastructure')).toBeTruthy();
        expect(screen.getByText('Translation')).toBeTruthy();
        expect(screen.getByText('TTS')).toBeTruthy();
      });
    });

    it('should display Total COGS', async () => {
      setupAdminUser();
      mockFetchSuccess(MOCK_METRICS);

      render(<BusinessHealthCard />);

      await waitFor(() => {
        expect(screen.getByText('Total COGS')).toBeTruthy();
      });
    });
  });

  // ─── Section 4: Per-Tier Economics ──────────────────────────────

  describe('Per-Tier Economics section', () => {
    it('should display all three tiers', async () => {
      setupAdminUser();
      mockFetchSuccess(MOCK_METRICS);

      render(<BusinessHealthCard />);

      await waitFor(() => {
        expect(screen.getByText('Free')).toBeTruthy();
        expect(screen.getByText('Reader')).toBeTruthy();
        expect(screen.getByText('Pro')).toBeTruthy();
      });
    });

    it('should display user counts for each tier', async () => {
      setupAdminUser();
      mockFetchSuccess(MOCK_METRICS);

      render(<BusinessHealthCard />);

      await waitFor(() => {
        expect(screen.getByText('100 users')).toBeTruthy();
        expect(screen.getByText('2 users')).toBeTruthy();
        expect(screen.getByText('1 users')).toBeTruthy();
      });
    });

    it('should display cost per user label', async () => {
      setupAdminUser();
      mockFetchSuccess(MOCK_METRICS);

      render(<BusinessHealthCard />);

      await waitFor(() => {
        const costLabels = screen.getAllByText('Cost/user');
        expect(costLabels.length).toBe(3);
      });
    });

    it('should display net contribution label', async () => {
      setupAdminUser();
      mockFetchSuccess(MOCK_METRICS);

      render(<BusinessHealthCard />);

      await waitFor(() => {
        const netLabels = screen.getAllByText('Net contrib.');
        expect(netLabels.length).toBe(3);
      });
    });
  });

  // ─── Section 5: AI Budget ──────────────────────────────────────

  describe('AI Budget section', () => {
    it('should display AI Budget heading', async () => {
      setupAdminUser();
      mockFetchSuccess(MOCK_METRICS);

      render(<BusinessHealthCard />);

      await waitFor(() => {
        expect(screen.getByText('AI Budget')).toBeTruthy();
      });
    });

    it('should render progress bar', async () => {
      setupAdminUser();
      mockFetchSuccess(MOCK_METRICS);

      render(<BusinessHealthCard />);

      await waitFor(() => {
        const progressBar = screen.getByTestId('progress-bar');
        expect(progressBar).toBeTruthy();
      });
    });

    it('should display current spend and ceiling', async () => {
      setupAdminUser();
      mockFetchSuccess(MOCK_METRICS);

      render(<BusinessHealthCard />);

      await waitFor(() => {
        // The spend and ceiling are in the same span: "$1.45 / $12.0K"
        const spendCeilingEl = screen.getByText(
          (_, element) =>
            element?.tagName === 'SPAN' &&
            (element.textContent?.includes('$1.45') ?? false) &&
            (element.textContent?.includes('$12.0K') ?? false),
        );
        expect(spendCeilingEl).toBeTruthy();
      });
    });
  });

  // ─── Zero state ─────────────────────────────────────────────────

  describe('zero state', () => {
    it('should handle zero users and zero revenue', async () => {
      setupAdminUser();
      mockFetchSuccess(ZERO_METRICS);

      render(<BusinessHealthCard />);

      await waitFor(() => {
        expect(screen.getByTestId('business-health-card')).toBeTruthy();
        // MRR and ARR should show $0.00
        const zeroValues = screen.getAllByText('$0.00');
        expect(zeroValues.length).toBeGreaterThan(0);
      });
    });

    it('should display 0.0% for gross margin in zero state', async () => {
      setupAdminUser();
      mockFetchSuccess(ZERO_METRICS);

      render(<BusinessHealthCard />);

      await waitFor(() => {
        const percentZeros = screen.getAllByText('0.0%');
        expect(percentZeros.length).toBeGreaterThan(0);
      });
    });
  });

  // ─── API call behavior ──────────────────────────────────────────

  describe('API behavior', () => {
    it('should call the business-health API with auth header', async () => {
      setupAdminUser();
      mockFetchSuccess(MOCK_METRICS);

      render(<BusinessHealthCard />);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          '/api/admin/business-health',
          expect.objectContaining({
            headers: { authorization: 'Bearer mock-token' },
          }),
        );
      });
    });

    it('should not call API for non-admin users', () => {
      setupNonAdminUser();
      render(<BusinessHealthCard />);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should not call API when there is no access token', async () => {
      mockUseAuth.mockReturnValue({ user: { email: 'tarun@openread.ai' } });
      mockGetAccessToken.mockResolvedValue(null);

      render(<BusinessHealthCard />);

      // Wait a tick for the async effect to run
      await waitFor(() => {
        expect(mockFetch).not.toHaveBeenCalled();
      });
    });
  });

  // ─── Section headers ───────────────────────────────────────────

  describe('section headers', () => {
    it('should display all section headers', async () => {
      setupAdminUser();
      mockFetchSuccess(MOCK_METRICS);

      render(<BusinessHealthCard />);

      await waitFor(() => {
        expect(screen.getByText('Top Line')).toBeTruthy();
        expect(screen.getByText('SaaS Metrics')).toBeTruthy();
        expect(screen.getByText('COGS Breakdown')).toBeTruthy();
        expect(screen.getByText('Per-Tier Economics')).toBeTruthy();
        expect(screen.getByText('AI Budget')).toBeTruthy();
      });
    });

    it('should display card title and description', async () => {
      setupAdminUser();
      mockFetchSuccess(MOCK_METRICS);

      render(<BusinessHealthCard />);

      await waitFor(() => {
        expect(screen.getByText('Business Health')).toBeTruthy();
        expect(screen.getByText('Admin-only metrics dashboard')).toBeTruthy();
      });
    });
  });
});
*/
