import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import PlansComparison from '@/app/user/components/PlansComparison';
import type { AvailablePlan } from '@/types/quota';
import type { TierConfig } from '@/lib/tier-config';
import { getFallbackConfig } from '@/lib/tier-config';

// ─── Mocks ──────────────────────────────────────────────────────────

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/utils/misc', () => ({
  getLocale: () => 'en-US',
}));

let mockAppService: Record<string, unknown> = { isIOSApp: false };
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    envConfig: {},
    appService: mockAppService,
  }),
}));

vi.mock('@/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    from: vi.fn(),
  })),
}));

// ─── Test fixtures ──────────────────────────────────────────────────

const mockAvailablePlans: AvailablePlan[] = [
  {
    plan: 'reader',
    productId: 'price_reader_monthly',
    price: 999,
    currency: 'USD',
    interval: 'month',
    productName: 'Reader Monthly',
  },
  {
    plan: 'pro',
    productId: 'price_pro_monthly',
    price: 1999,
    currency: 'USD',
    interval: 'month',
    productName: 'Pro Monthly',
  },
];

const tierConfig: TierConfig = getFallbackConfig();

// ─── Tests ──────────────────────────────────────────────────────────

describe('PlansComparison', () => {
  const mockOnSubscribe = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockAppService = { isIOSApp: false };
  });

  afterEach(() => {
    cleanup();
  });

  // AC: 3 plan cards displayed: Free, Reader, Pro
  describe('Plan Cards Rendering', () => {
    it('should render 3 plan cards with correct names', () => {
      render(
        <PlansComparison
          availablePlans={mockAvailablePlans}
          userPlan='free'
          onSubscribe={mockOnSubscribe}
          tierConfig={tierConfig}
        />,
      );

      expect(screen.getByText('Free')).toBeTruthy();
      expect(screen.getByText('Reader')).toBeTruthy();
      expect(screen.getByText('Pro')).toBeTruthy();
    });

    it('should render correct monthly prices from tier config', () => {
      render(
        <PlansComparison
          availablePlans={mockAvailablePlans}
          userPlan='free'
          onSubscribe={mockOnSubscribe}
          tierConfig={tierConfig}
        />,
      );

      // Free = $0.00, Reader = $9.99, Pro = $19.99
      expect(screen.getByText('$0.00')).toBeTruthy();
      expect(screen.getByText('$9.99')).toBeTruthy();
      expect(screen.getByText('$19.99')).toBeTruthy();
    });
  });

  // AC: Reader card has "Most Popular" badge
  describe('Most Popular Badge', () => {
    it('should show "Most Popular" badge on Reader card only', () => {
      render(
        <PlansComparison
          availablePlans={mockAvailablePlans}
          userPlan='free'
          onSubscribe={mockOnSubscribe}
          tierConfig={tierConfig}
        />,
      );

      const badges = screen.getAllByText('Most Popular');
      expect(badges).toHaveLength(1);
    });
  });

  // AC: Feature groups ordered: AI Features, Reading, MCP, Storage
  describe('Feature Groups', () => {
    it('should render AI Features group for each plan', () => {
      render(
        <PlansComparison
          availablePlans={mockAvailablePlans}
          userPlan='free'
          onSubscribe={mockOnSubscribe}
          tierConfig={tierConfig}
        />,
      );

      // AI Features should appear for all 3 cards
      const aiHeaders = screen.getAllByText('AI Features');
      expect(aiHeaders.length).toBe(3);
    });

    it('should render Reading group for each plan', () => {
      render(
        <PlansComparison
          availablePlans={mockAvailablePlans}
          userPlan='free'
          onSubscribe={mockOnSubscribe}
          tierConfig={tierConfig}
        />,
      );

      const readingHeaders = screen.getAllByText('Reading');
      expect(readingHeaders.length).toBe(3);
    });

    it('should render Storage group for each plan', () => {
      render(
        <PlansComparison
          availablePlans={mockAvailablePlans}
          userPlan='free'
          onSubscribe={mockOnSubscribe}
          tierConfig={tierConfig}
        />,
      );

      const storageHeaders = screen.getAllByText('Storage');
      expect(storageHeaders.length).toBe(3);
    });

    it('should render MCP group only for paid plans', () => {
      render(
        <PlansComparison
          availablePlans={mockAvailablePlans}
          userPlan='free'
          onSubscribe={mockOnSubscribe}
          tierConfig={tierConfig}
        />,
      );

      // MCP should appear for reader and pro only
      const mcpHeaders = screen.getAllByText('MCP');
      expect(mcpHeaders.length).toBe(2);
    });

    it('should show correct AI usage labels for each tier', () => {
      render(
        <PlansComparison
          availablePlans={mockAvailablePlans}
          userPlan='free'
          onSubscribe={mockOnSubscribe}
          tierConfig={tierConfig}
        />,
      );

      // Free = Limited, Reader = Generous, Pro = Extended
      expect(screen.getByText('Limited AI usage')).toBeTruthy();
      expect(screen.getByText('Generous AI usage')).toBeTruthy();
      expect(screen.getByText('Extended AI usage')).toBeTruthy();
    });
  });

  // AC: Monthly/Annual toggle switches all prices
  describe('Billing Cycle Toggle', () => {
    it('should default to monthly billing', () => {
      render(
        <PlansComparison
          availablePlans={mockAvailablePlans}
          userPlan='free'
          onSubscribe={mockOnSubscribe}
          tierConfig={tierConfig}
        />,
      );

      const monthlyButton = screen.getByText('Monthly');
      expect(monthlyButton.getAttribute('data-active')).toBe('true');
    });

    it('should switch prices when toggling to annual', () => {
      render(
        <PlansComparison
          availablePlans={mockAvailablePlans}
          userPlan='free'
          onSubscribe={mockOnSubscribe}
          tierConfig={tierConfig}
        />,
      );

      // Initially shows monthly prices
      expect(screen.getByText('$9.99')).toBeTruthy();
      expect(screen.getByText('$19.99')).toBeTruthy();

      // Click annual
      const annualButton = screen.getByText('Annual');
      fireEvent.click(annualButton);

      // Annual prices: Reader $99.99/yr, Pro $199.99/yr
      expect(screen.getByText('$99.99')).toBeTruthy();
      expect(screen.getByText('$199.99')).toBeTruthy();
    });

    it('should toggle back to monthly prices', () => {
      render(
        <PlansComparison
          availablePlans={mockAvailablePlans}
          userPlan='free'
          onSubscribe={mockOnSubscribe}
          tierConfig={tierConfig}
        />,
      );

      // Switch to annual
      fireEvent.click(screen.getByText('Annual'));
      expect(screen.getByText('$99.99')).toBeTruthy();

      // Switch back to monthly
      fireEvent.click(screen.getByText('Monthly'));
      expect(screen.getByText('$9.99')).toBeTruthy();
    });
  });

  // AC: Annual toggle shows "Save 17%" badge
  describe('Savings Badge', () => {
    it('should show "Save 17%" badge next to annual option', () => {
      render(
        <PlansComparison
          availablePlans={mockAvailablePlans}
          userPlan='free'
          onSubscribe={mockOnSubscribe}
          tierConfig={tierConfig}
        />,
      );

      expect(screen.getByText('Save 17%')).toBeTruthy();
    });
  });

  // AC: Storage add-on row appears below cards
  describe('Storage Add-on Row', () => {
    it('should render storage add-on row with 4 options', () => {
      render(
        <PlansComparison
          availablePlans={mockAvailablePlans}
          userPlan='free'
          onSubscribe={mockOnSubscribe}
          tierConfig={tierConfig}
        />,
      );

      expect(screen.getByText('Need more storage? Add to any paid plan.')).toBeTruthy();

      // 4 addon options
      expect(screen.getByText('+5 GB')).toBeTruthy();
      expect(screen.getByText('+10 GB')).toBeTruthy();
      expect(screen.getByText('+25 GB')).toBeTruthy();
      expect(screen.getByText('+50 GB')).toBeTruthy();
    });

    it('should show correct add-on prices', () => {
      render(
        <PlansComparison
          availablePlans={mockAvailablePlans}
          userPlan='free'
          onSubscribe={mockOnSubscribe}
          tierConfig={tierConfig}
        />,
      );

      // Web prices: $1.99, $2.99, $4.99, $7.99
      expect(screen.getByText('$1.99/mo')).toBeTruthy();
      expect(screen.getByText('$2.99/mo')).toBeTruthy();
      expect(screen.getByText('$4.99/mo')).toBeTruthy();
      expect(screen.getByText('$7.99/mo')).toBeTruthy();
    });
  });

  // AC: Reader card CTA is primary style, Free/Pro are ghost
  describe('CTA Buttons', () => {
    it('should show correct CTA labels', () => {
      render(
        <PlansComparison
          availablePlans={mockAvailablePlans}
          userPlan='free'
          onSubscribe={mockOnSubscribe}
          tierConfig={tierConfig}
        />,
      );

      // Free user sees: "Current Plan" on free card (disabled), "Start Reading" on Reader, "Go Pro" on Pro
      expect(screen.getByText('Current Plan')).toBeTruthy();
      expect(screen.getByText('Start Reading')).toBeTruthy();
      expect(screen.getByText('Go Pro')).toBeTruthy();
    });

    it('should call onSubscribe when clicking a CTA', () => {
      render(
        <PlansComparison
          availablePlans={mockAvailablePlans}
          userPlan='free'
          onSubscribe={mockOnSubscribe}
          tierConfig={tierConfig}
        />,
      );

      const startReadingButton = screen.getByText('Start Reading');
      fireEvent.click(startReadingButton);

      expect(mockOnSubscribe).toHaveBeenCalledWith(undefined, 'subscription');
    });
  });

  // AC: Current plan highlighted with "Current plan" indicator
  describe('Current Plan Indicator', () => {
    it('should show "Current" badge on the current plan', () => {
      render(
        <PlansComparison
          availablePlans={mockAvailablePlans}
          userPlan='reader'
          onSubscribe={mockOnSubscribe}
          tierConfig={tierConfig}
        />,
      );

      expect(screen.getByText('Current')).toBeTruthy();
    });

    it('should disable CTA for current plan', () => {
      render(
        <PlansComparison
          availablePlans={mockAvailablePlans}
          userPlan='reader'
          onSubscribe={mockOnSubscribe}
          tierConfig={tierConfig}
        />,
      );

      const currentPlanButton = screen.getByText('Current Plan').closest('button');
      expect(currentPlanButton).toHaveProperty('disabled', true);
    });
  });

  // AC: Responsive: cards stack vertically on mobile
  describe('Responsive Layout', () => {
    it('should render with grid layout classes', () => {
      const { container } = render(
        <PlansComparison
          availablePlans={mockAvailablePlans}
          userPlan='free'
          onSubscribe={mockOnSubscribe}
          tierConfig={tierConfig}
        />,
      );

      // Grid container should have responsive classes
      const grid = container.querySelector('.grid.gap-6');
      expect(grid).toBeTruthy();
      expect(grid?.className).toContain('md:grid-cols-3');
    });
  });

  // AC: iOS shows IAP prices
  describe('iOS Anti-Steering', () => {
    it('should show mobile prices for storage addons on iOS', () => {
      mockAppService = { isIOSApp: true };

      render(
        <PlansComparison
          availablePlans={mockAvailablePlans}
          userPlan='free'
          onSubscribe={mockOnSubscribe}
          tierConfig={tierConfig}
        />,
      );

      // iOS prices: $2.99, $3.99, $6.99, $10.99 (mobile_price_cents)
      expect(screen.getByText('$2.99/mo')).toBeTruthy();
      expect(screen.getByText('$3.99/mo')).toBeTruthy();
      expect(screen.getByText('$6.99/mo')).toBeTruthy();
      expect(screen.getByText('$10.99/mo')).toBeTruthy();
    });
  });

  // Loading state
  describe('Loading State', () => {
    it('should show skeleton loaders when isLoading', () => {
      const { container } = render(
        <PlansComparison
          availablePlans={[]}
          userPlan='free'
          onSubscribe={mockOnSubscribe}
          isLoading={true}
        />,
      );

      const skeletons = container.querySelectorAll('.animate-pulse');
      // 1 toggle skeleton + 3 card skeletons + 1 addon row skeleton = 5
      expect(skeletons.length).toBe(5);
    });
  });

  // Free user sees all 3 cards
  describe('Free User View', () => {
    it('should show all 3 cards for a free user', () => {
      render(
        <PlansComparison
          availablePlans={mockAvailablePlans}
          userPlan='free'
          onSubscribe={mockOnSubscribe}
          tierConfig={tierConfig}
        />,
      );

      expect(screen.getByText('Free')).toBeTruthy();
      expect(screen.getByText('Reader')).toBeTruthy();
      expect(screen.getByText('Pro')).toBeTruthy();
    });
  });

  // Section header
  describe('Section Header', () => {
    it('should display heading and subtext', () => {
      render(
        <PlansComparison
          availablePlans={mockAvailablePlans}
          userPlan='free'
          onSubscribe={mockOnSubscribe}
          tierConfig={tierConfig}
        />,
      );

      expect(screen.getByText('Choose Your Plan')).toBeTruthy();
      expect(screen.getByText('Start free, upgrade anytime.')).toBeTruthy();
    });
  });
});
