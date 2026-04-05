import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { PlanCards } from '@/components/settings/plan-cards';
import type { PlanDetails } from '@/app/user/utils/plan';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

// Mock useTranslation
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

// Mock getLocale
vi.mock('@/utils/misc', () => ({
  getLocale: () => 'en-US',
}));

// Mock logger
vi.mock('@/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// Mock supabase (needed by tier-config)
vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    from: vi.fn(),
  })),
}));

// Mock eventDispatcher
const mockDispatch = vi.fn();
vi.mock('@/utils/event', () => ({
  eventDispatcher: {
    dispatch: (...args: unknown[]) => mockDispatch(...args),
    on: vi.fn(),
    off: vi.fn(),
  },
}));

const mockPlans: PlanDetails[] = [
  {
    name: 'Free Plan',
    plan: 'free',
    type: 'subscription',
    color: 'bg-gray-200 text-gray-800',
    hintColor: 'text-gray-800/75',
    price: 0,
    currency: 'USD',
    productId: undefined,
    interval: 'month',
    features: [{ label: 'Local reading' }, { label: 'Basic AI' }],
    limits: {
      'Cloud Sync Storage': '500 MB',
    },
  },
  {
    name: 'Reader Plan',
    plan: 'reader',
    type: 'subscription',
    color: 'bg-blue-200 text-blue-800',
    hintColor: 'text-blue-800/75',
    price: 999,
    currency: 'USD',
    productId: 'price_reader_monthly',
    interval: 'month',
    features: [
      { label: 'Everything in Free' },
      { label: 'Cloud sync' },
      { label: 'Extended translations' },
    ],
    limits: {
      'Cloud Sync Storage': '5 GB',
    },
  },
  {
    name: 'Pro Plan',
    plan: 'pro',
    type: 'subscription',
    color: 'bg-purple-200 text-purple-800',
    hintColor: 'text-purple-800/75',
    price: 1999,
    currency: 'USD',
    productId: 'price_pro_monthly',
    interval: 'month',
    features: [
      { label: 'Everything in Plus' },
      { label: 'AI analysis' },
      { label: 'Priority support' },
    ],
    limits: {
      'Cloud Sync Storage': '20 GB',
    },
  },
];

describe('PlanCards', () => {
  const mockOnUpgrade = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe('Rendering', () => {
    it('should render all 3 plan cards from tier config', () => {
      render(<PlanCards plans={mockPlans} onUpgrade={mockOnUpgrade} />);
      // Plans now come from tier config: Free, Reader, Pro
      expect(screen.getByText('Free')).toBeTruthy();
      expect(screen.getByText('Reader')).toBeTruthy();
      expect(screen.getByText('Pro')).toBeTruthy();
    });

    it('should show "Most Popular" badge on Reader plan', () => {
      render(<PlanCards plans={mockPlans} onUpgrade={mockOnUpgrade} />);
      expect(screen.getByText('Most Popular')).toBeTruthy();
    });

    it('should show plan prices from tier config', () => {
      render(<PlanCards plans={mockPlans} onUpgrade={mockOnUpgrade} />);
      expect(screen.getByText('$0.00')).toBeTruthy();
      expect(screen.getByText('$9.99')).toBeTruthy();
      expect(screen.getByText('$19.99')).toBeTruthy();
    });

    it('should show feature groups', () => {
      render(<PlanCards plans={mockPlans} onUpgrade={mockOnUpgrade} />);
      // Feature groups from tier config
      const aiHeaders = screen.getAllByText('AI Features');
      expect(aiHeaders.length).toBe(3);
    });

    it('should show loading skeletons when isLoading is true', () => {
      render(<PlanCards plans={[]} isLoading={true} onUpgrade={mockOnUpgrade} />);
      // Should render skeleton loaders
      const skeletons = document.querySelectorAll('.animate-pulse');
      expect(skeletons.length).toBeGreaterThan(0);
    });
  });

  describe('Billing Cycle Toggle', () => {
    it('should show billing cycle toggle', () => {
      render(<PlanCards plans={mockPlans} onUpgrade={mockOnUpgrade} />);
      expect(screen.getByText('Monthly')).toBeTruthy();
      expect(screen.getByText('Annual')).toBeTruthy();
    });

    it('should switch prices when toggling to annual', () => {
      render(<PlanCards plans={mockPlans} onUpgrade={mockOnUpgrade} />);

      // Initially monthly: $9.99, $19.99
      expect(screen.getByText('$9.99')).toBeTruthy();

      // Switch to annual
      fireEvent.click(screen.getByText('Annual'));

      // Annual: $99.99, $199.99
      expect(screen.getByText('$99.99')).toBeTruthy();
      expect(screen.getByText('$199.99')).toBeTruthy();
    });

    it('should show "Save 17%" badge', () => {
      render(<PlanCards plans={mockPlans} onUpgrade={mockOnUpgrade} />);
      expect(screen.getByText('Save 17%')).toBeTruthy();
    });
  });

  describe('Current Plan Indication', () => {
    it('should mark the current plan with Current badge', () => {
      render(<PlanCards plans={mockPlans} currentPlanId='reader' onUpgrade={mockOnUpgrade} />);
      expect(screen.getByText('Current')).toBeTruthy();
    });

    it('should show "Current Plan" button for current plan', () => {
      render(<PlanCards plans={mockPlans} currentPlanId='reader' onUpgrade={mockOnUpgrade} />);
      expect(screen.getByText('Current Plan')).toBeTruthy();
    });

    it('should disable the current plan button', () => {
      render(<PlanCards plans={mockPlans} currentPlanId='reader' onUpgrade={mockOnUpgrade} />);
      const currentPlanButton = screen.getByText('Current Plan').closest('button');
      expect(currentPlanButton).toHaveProperty('disabled', true);
    });
  });

  describe('Upgrade Actions', () => {
    it('should show "Switch Plan" button for other plans when user has a plan', () => {
      render(<PlanCards plans={mockPlans} currentPlanId='free' onUpgrade={mockOnUpgrade} />);
      const switchButtons = screen.getAllByText('Switch Plan');
      // Should have 2 switch buttons (for Reader and Pro)
      expect(switchButtons.length).toBe(2);
    });

    it('should call onUpgrade when clicking upgrade button', async () => {
      mockOnUpgrade.mockResolvedValue(undefined);
      render(<PlanCards plans={mockPlans} currentPlanId='free' onUpgrade={mockOnUpgrade} />);

      const switchButtons = screen.getAllByText('Switch Plan');
      fireEvent.click(switchButtons[0]!);

      await waitFor(() => {
        expect(mockOnUpgrade).toHaveBeenCalledWith('price_reader_monthly');
      });
    });

    it('should not call onUpgrade when clicking on free plan', () => {
      render(<PlanCards plans={mockPlans} currentPlanId='reader' onUpgrade={mockOnUpgrade} />);

      // Find the Free Plan button specifically
      const freeButtons = screen
        .getAllByRole('button')
        .filter((btn) => btn.textContent === 'Free Plan');
      if (freeButtons.length > 0) {
        fireEvent.click(freeButtons[0]!);
      }

      expect(mockOnUpgrade).not.toHaveBeenCalled();
    });

    it('should show error toast when plan has no productId', async () => {
      const plansWithoutProductId = mockPlans.map((p) => ({
        ...p,
        productId: p.plan === 'reader' ? undefined : p.productId,
      }));

      render(
        <PlanCards plans={plansWithoutProductId} currentPlanId='free' onUpgrade={mockOnUpgrade} />,
      );

      const switchButtons = screen.getAllByText('Switch Plan');
      fireEvent.click(switchButtons[0]!);

      await waitFor(() => {
        expect(mockDispatch).toHaveBeenCalledWith('toast', {
          type: 'error',
          message: 'No product available for this plan',
        });
      });
    });

    it('should show Processing state when upgrade is in progress', async () => {
      let resolveUpgrade: () => void;
      const slowUpgrade = new Promise<void>((resolve) => {
        resolveUpgrade = resolve;
      });
      mockOnUpgrade.mockReturnValue(slowUpgrade);

      render(<PlanCards plans={mockPlans} currentPlanId='free' onUpgrade={mockOnUpgrade} />);

      const switchButtons = screen.getAllByText('Switch Plan');
      fireEvent.click(switchButtons[0]!);

      await waitFor(() => {
        expect(screen.getByText('Processing...')).toBeTruthy();
      });

      // Cleanup
      resolveUpgrade!();
    });
  });

  describe('Upgrade Restrictions', () => {
    it('should disable upgrade buttons when user is on Pro plan', () => {
      render(<PlanCards plans={mockPlans} currentPlanId='pro' onUpgrade={mockOnUpgrade} />);

      // Find the Free Plan button specifically
      const freeButtons = screen
        .getAllByRole('button')
        .filter((btn) => btn.textContent === 'Free Plan');
      expect(freeButtons.length).toBeGreaterThan(0);
      expect(freeButtons[0]).toHaveProperty('disabled', true);

      // Switch Plan buttons should be disabled
      const switchButtons = screen.queryAllByText('Switch Plan');
      switchButtons.forEach((btn) => {
        expect(btn.closest('button')).toHaveProperty('disabled', true);
      });
    });
  });

  describe('Accessibility', () => {
    it('should have accessible check icons', () => {
      render(<PlanCards plans={mockPlans} onUpgrade={mockOnUpgrade} />);
      const checkIcons = document.querySelectorAll('[aria-hidden="true"]');
      expect(checkIcons.length).toBeGreaterThan(0);
    });
  });
});
