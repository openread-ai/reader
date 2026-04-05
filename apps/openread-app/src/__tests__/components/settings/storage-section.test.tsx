import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { StorageSection } from '@/components/settings/storage-section';

// ─── Mocks ───────────────────────────────────────────────────────────

// Mock useTranslation
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

// Mock useQuotaStats
const mockUserProfilePlan = vi.fn();
vi.mock('@/hooks/useQuotaStats', () => ({
  useQuotaStats: () => ({
    userProfilePlan: mockUserProfilePlan(),
    quotas: [],
  }),
}));

// Mock useStorageQuota
const mockUseStorageQuota = vi.fn();
vi.mock('@/hooks/useStorageQuota', () => ({
  useStorageQuota: () => mockUseStorageQuota(),
}));

// Mock tier-gates
vi.mock('@/lib/tier-gates', () => ({
  formatPriceDisplay: (cents: number) => (cents <= 0 ? '' : `$${(cents / 100).toFixed(2)}/mo`),
}));

// Mock Stripe client
const mockCreateCheckout = vi.fn();
const mockRedirectToCheckout = vi.fn();
vi.mock('@/libs/payment/stripe/client', () => ({
  createStripeCheckoutSession: (...args: unknown[]) => mockCreateCheckout(...args),
  redirectToStripeCheckout: (...args: unknown[]) => mockRedirectToCheckout(...args),
}));

// Mock access utils
vi.mock('@/utils/access', () => ({
  getAccessToken: vi.fn().mockResolvedValue('mock-token'),
}));

// Mock environment
vi.mock('@/services/environment', () => ({
  getAPIBaseUrl: () => '/api',
}));

// Mock event dispatcher
const mockDispatch = vi.fn();
vi.mock('@/utils/event', () => ({
  eventDispatcher: {
    dispatch: (...args: unknown[]) => mockDispatch(...args),
    on: vi.fn(),
    off: vi.fn(),
  },
}));

// Mock cn util
vi.mock('@/utils/tailwind', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

// ─── Helpers ─────────────────────────────────────────────────────────

const GB = 1024 * 1024 * 1024;

const AVAILABLE_ADDONS = [
  { gb: 5, price_cents: 199, mobile_price_cents: 299 },
  { gb: 10, price_cents: 299, mobile_price_cents: 399 },
  { gb: 25, price_cents: 499, mobile_price_cents: 699 },
  { gb: 50, price_cents: 799, mobile_price_cents: 1099 },
];

function makeQuota(overrides: Record<string, unknown> = {}) {
  return {
    plan: 'reader',
    base_gb: 2,
    addon_gb: 0,
    total_bytes: 2 * GB,
    used_bytes: 1 * GB,
    available_bytes: 1 * GB,
    percent_used: 50,
    is_over_limit: false,
    active_addons: [],
    available_addons: AVAILABLE_ADDONS,
    ...overrides,
  };
}

function setupHook(
  quota: ReturnType<typeof makeQuota> | null,
  isLoading = false,
  error: Error | null = null,
) {
  mockUseStorageQuota.mockReturnValue({
    quota,
    isLoading,
    error,
    refetch: vi.fn(),
  });
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('StorageSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserProfilePlan.mockReturnValue('reader');
  });

  afterEach(() => {
    cleanup();
  });

  // ─── Free User ───────────────────────────────────────────────────

  describe('Free User', () => {
    it('should show upgrade prompt for free users', () => {
      mockUserProfilePlan.mockReturnValue('free');
      setupHook(null, false);

      render(<StorageSection />);

      expect(screen.getByText('Cloud storage is available on paid plans.')).toBeTruthy();
      expect(screen.getByText('Upgrade')).toBeTruthy();
    });

    it('should show upgrade prompt when plan is undefined', () => {
      mockUserProfilePlan.mockReturnValue(undefined);
      setupHook(null, false);

      render(<StorageSection />);

      expect(screen.getByText('Cloud storage is available on paid plans.')).toBeTruthy();
    });

    it('should not show usage bar for free users', () => {
      mockUserProfilePlan.mockReturnValue('free');
      setupHook(null, false);

      render(<StorageSection />);

      expect(screen.queryByRole('progressbar')).toBeNull();
    });
  });

  // ─── Loading State ───────────────────────────────────────────────

  describe('Loading State', () => {
    it('should show loading skeletons', () => {
      setupHook(null, true);

      render(<StorageSection />);

      // Card title should still be visible
      expect(screen.getByText('Cloud Storage')).toBeTruthy();
      // Should have skeleton elements (animate-pulse)
      const skeletons = document.querySelectorAll('.animate-pulse');
      expect(skeletons.length).toBeGreaterThan(0);
    });
  });

  // ��── Error State ─────────────────────────────────────────────────

  describe('Error State', () => {
    it('should show error message when fetch fails', () => {
      setupHook(null, false, new Error('Network error'));

      render(<StorageSection />);

      expect(screen.getByText('Failed to load storage information')).toBeTruthy();
    });
  });

  // ─── Usage Bar ───────────────────────────────────────────────────

  describe('Usage Bar', () => {
    it('should render usage bar with correct values', () => {
      setupHook(makeQuota({ used_bytes: 1 * GB, percent_used: 50 }));

      render(<StorageSection />);

      expect(screen.getByText(/1 GB.*of.*2 GB.*used/)).toBeTruthy();
      expect(screen.getByText('50%')).toBeTruthy();
    });

    it('should show green color for usage below 80%', () => {
      setupHook(makeQuota({ percent_used: 50 }));

      render(<StorageSection />);

      const percentText = screen.getByText('50%');
      expect(percentText.className).toContain('text-success');
    });

    it('should show yellow color for usage between 80-95%', () => {
      setupHook(makeQuota({ percent_used: 85 }));

      render(<StorageSection />);

      const percentText = screen.getByText('85%');
      expect(percentText.className).toContain('text-warning');
    });

    it('should show red color for usage above 95%', () => {
      setupHook(makeQuota({ percent_used: 98 }));

      render(<StorageSection />);

      const percentText = screen.getByText('98%');
      expect(percentText.className).toContain('text-error');
    });
  });

  // ─── Breakdown ───────────────────────────────────────────────────

  describe('Breakdown', () => {
    it('should show base-only breakdown when no add-ons', () => {
      setupHook(makeQuota({ base_gb: 2, addon_gb: 0 }));

      render(<StorageSection />);

      expect(screen.getByText('2 GB base (Reader plan)')).toBeTruthy();
    });

    it('should show full breakdown with add-ons', () => {
      setupHook(
        makeQuota({
          base_gb: 2,
          addon_gb: 5,
          total_bytes: 7 * GB,
        }),
      );

      render(<StorageSection />);

      expect(screen.getByText('2 GB base (Reader) + 5 GB add-ons = 7 GB total')).toBeTruthy();
    });

    it('should show correct plan name in breakdown', () => {
      setupHook(makeQuota({ plan: 'pro', base_gb: 5 }));

      render(<StorageSection />);

      expect(screen.getByText('5 GB base (Pro plan)')).toBeTruthy();
    });
  });

  // ─── Active Add-ons ──────────────────────────────────────────────

  describe('Active Add-ons', () => {
    it('should display active add-ons list', () => {
      setupHook(
        makeQuota({
          addon_gb: 15,
          active_addons: [
            {
              id: 'a1',
              gb_amount: 5,
              price_cents: 199,
              source: 'stripe',
              created_at: '2026-01-01',
            },
            {
              id: 'a2',
              gb_amount: 10,
              price_cents: 299,
              source: 'stripe',
              created_at: '2026-02-01',
            },
          ],
        }),
      );

      render(<StorageSection />);

      expect(screen.getByText('Active Add-ons')).toBeTruthy();
      expect(screen.getByText('+5 GB')).toBeTruthy();
      expect(screen.getByText('+10 GB')).toBeTruthy();
      expect(screen.getByText('$1.99/mo')).toBeTruthy();
      expect(screen.getByText('$2.99/mo')).toBeTruthy();
    });

    it('should show Cancel link for each active add-on', () => {
      setupHook(
        makeQuota({
          addon_gb: 5,
          active_addons: [
            {
              id: 'a1',
              gb_amount: 5,
              price_cents: 199,
              source: 'stripe',
              created_at: '2026-01-01',
            },
          ],
        }),
      );

      render(<StorageSection />);

      const cancelButtons = screen.getAllByText('Cancel');
      expect(cancelButtons.length).toBe(1);
    });

    it('should not show add-ons section when no active add-ons', () => {
      setupHook(makeQuota({ active_addons: [] }));

      render(<StorageSection />);

      expect(screen.queryByText('Active Add-ons')).toBeNull();
    });
  });

  // ─── Add Storage Button ──────────────────────────────────────────

  describe('Add Storage Button', () => {
    it('should show Add Storage button for paid users', () => {
      setupHook(makeQuota());

      render(<StorageSection />);

      expect(screen.getByText('Add Storage')).toBeTruthy();
    });

    it('should open addon selector when clicking Add Storage', () => {
      setupHook(makeQuota());

      render(<StorageSection />);

      fireEvent.click(screen.getByText('Add Storage'));

      // The dialog should now be open
      expect(
        screen.getByText('Choose a storage add-on. Billed monthly as a separate subscription.'),
      ).toBeTruthy();
    });

    it('should show 4 available add-on options in selector', () => {
      setupHook(makeQuota());

      render(<StorageSection />);

      fireEvent.click(screen.getByText('Add Storage'));

      expect(screen.getByText('+5 GB')).toBeTruthy();
      expect(screen.getByText('+10 GB')).toBeTruthy();
      expect(screen.getByText('+25 GB')).toBeTruthy();
      expect(screen.getByText('+50 GB')).toBeTruthy();
    });
  });

  // ─── Cancel Add-on ───────────────────────────────────────────────

  describe('Cancel Add-on', () => {
    it('should call cancel API when clicking Cancel', async () => {
      const mockRefetch = vi.fn();
      mockUseStorageQuota.mockReturnValue({
        quota: makeQuota({
          addon_gb: 5,
          active_addons: [
            {
              id: 'a1',
              gb_amount: 5,
              price_cents: 199,
              source: 'stripe',
              created_at: '2026-01-01',
            },
          ],
        }),
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });

      render(<StorageSection />);

      const cancelButton = screen.getByText('Cancel');
      fireEvent.click(cancelButton);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          '/api/stripe/cancel-storage-addon',
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ addonId: 'a1' }),
          }),
        );
      });

      await waitFor(() => {
        expect(mockDispatch).toHaveBeenCalledWith('toast', {
          type: 'success',
          message: 'Storage add-on will be canceled at end of billing period',
        });
      });
    });

    it('should show error toast on cancel failure', async () => {
      mockUseStorageQuota.mockReturnValue({
        quota: makeQuota({
          addon_gb: 5,
          active_addons: [
            {
              id: 'a1',
              gb_amount: 5,
              price_cents: 199,
              source: 'stripe',
              created_at: '2026-01-01',
            },
          ],
        }),
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: 'Failed' }),
      });

      render(<StorageSection />);

      const cancelButton = screen.getByText('Cancel');
      fireEvent.click(cancelButton);

      await waitFor(() => {
        expect(mockDispatch).toHaveBeenCalledWith('toast', {
          type: 'error',
          message: 'Failed to cancel storage add-on',
        });
      });
    });
  });

  // ─── Over-limit Warning ──────────────────────────────────────────

  describe('Over-limit Warning', () => {
    it('should show over-limit warning when storage is exceeded', () => {
      setupHook(
        makeQuota({
          is_over_limit: true,
          percent_used: 150,
          used_bytes: 3 * GB,
        }),
      );

      render(<StorageSection />);

      expect(
        screen.getByText(
          'You have exceeded your storage limit. Please add more storage or remove files.',
        ),
      ).toBeTruthy();
    });

    it('should not show over-limit warning when within limit', () => {
      setupHook(makeQuota({ is_over_limit: false }));

      render(<StorageSection />);

      expect(
        screen.queryByText(
          'You have exceeded your storage limit. Please add more storage or remove files.',
        ),
      ).toBeNull();
    });
  });
});
