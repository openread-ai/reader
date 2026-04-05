import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

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

const mockGetAccessToken = vi.fn().mockResolvedValue('mock-token');
vi.mock('@/utils/access', () => ({
  getAccessToken: () => mockGetAccessToken(),
}));

vi.mock('@/services/environment', () => ({
  getAPIBaseUrl: () => '/api',
}));

const mockDispatch = vi.fn();
vi.mock('@/utils/event', () => ({
  eventDispatcher: {
    dispatch: (...args: unknown[]) => mockDispatch(...args),
    on: vi.fn(),
    off: vi.fn(),
  },
}));

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// ─── Import components after mocks ──────────────────────────────────

import { RetentionOffer } from '@/components/settings/retention-offer';
import { PreCancelPrompt } from '@/components/settings/pre-cancel-prompt';
import { CancelSurvey } from '@/components/settings/cancel-survey';
import { CancelConfirmation } from '@/components/settings/cancel-confirmation';
import { CancellationFlow } from '@/components/settings/cancellation-flow';

// ─── Tests ──────────────────────────────────────────────────────────

describe('RetentionOffer', () => {
  const mockOnKeep = vi.fn();
  const mockOnProceed = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('should render 20% off offer text', () => {
    render(
      <RetentionOffer onKeep={mockOnKeep} onProceed={mockOnProceed} isApplyingCoupon={false} />,
    );
    expect(screen.getByText('Special offer: 20% off your next month')).toBeTruthy();
  });

  it('should call onKeep when "Keep my plan" is clicked', () => {
    render(
      <RetentionOffer onKeep={mockOnKeep} onProceed={mockOnProceed} isApplyingCoupon={false} />,
    );
    fireEvent.click(screen.getByText('Keep my plan - 20% off'));
    expect(mockOnKeep).toHaveBeenCalledOnce();
  });

  it('should call onProceed when "Continue canceling" is clicked', () => {
    render(
      <RetentionOffer onKeep={mockOnKeep} onProceed={mockOnProceed} isApplyingCoupon={false} />,
    );
    fireEvent.click(screen.getByText('Continue canceling'));
    expect(mockOnProceed).toHaveBeenCalledOnce();
  });

  it('should show loading state when applying coupon', () => {
    render(
      <RetentionOffer onKeep={mockOnKeep} onProceed={mockOnProceed} isApplyingCoupon={true} />,
    );
    expect(screen.getByText('Applying discount...')).toBeTruthy();
  });

  it('should disable buttons when applying coupon', () => {
    render(
      <RetentionOffer onKeep={mockOnKeep} onProceed={mockOnProceed} isApplyingCoupon={true} />,
    );
    const buttons = screen.getAllByRole('button');
    buttons.forEach((btn) => {
      expect(btn).toHaveProperty('disabled', true);
    });
  });
});

describe('PreCancelPrompt', () => {
  const mockOnKeep = vi.fn();
  const mockOnProceed = vi.fn();
  const features = ['Cloud sync', 'AI analysis', 'TTS'];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('should render feature loss list', () => {
    render(
      <PreCancelPrompt
        planName='Reader'
        features={features}
        onKeep={mockOnKeep}
        onProceed={mockOnProceed}
      />,
    );
    expect(screen.getByText('Cloud sync')).toBeTruthy();
    expect(screen.getByText('AI analysis')).toBeTruthy();
    expect(screen.getByText('TTS')).toBeTruthy();
  });

  it('should include plan name in heading', () => {
    render(
      <PreCancelPrompt
        planName='Reader'
        features={features}
        onKeep={mockOnKeep}
        onProceed={mockOnProceed}
      />,
    );
    expect(screen.getByText("Here's what you'll lose with Reader:")).toBeTruthy();
  });

  it('should call onKeep when "Keep my plan" is clicked', () => {
    render(
      <PreCancelPrompt
        planName='Reader'
        features={features}
        onKeep={mockOnKeep}
        onProceed={mockOnProceed}
      />,
    );
    fireEvent.click(screen.getByText('Keep my plan'));
    expect(mockOnKeep).toHaveBeenCalledOnce();
  });

  it('should call onProceed when "Continue canceling" is clicked', () => {
    render(
      <PreCancelPrompt
        planName='Reader'
        features={features}
        onKeep={mockOnKeep}
        onProceed={mockOnProceed}
      />,
    );
    fireEvent.click(screen.getByText('Continue canceling'));
    expect(mockOnProceed).toHaveBeenCalledOnce();
  });
});

describe('CancelSurvey', () => {
  const mockOnSubmit = vi.fn();
  const mockOnSkip = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('should render 4 radio options', () => {
    render(<CancelSurvey onSubmit={mockOnSubmit} onSkip={mockOnSkip} isSubmitting={false} />);
    expect(screen.getByText('Too expensive')).toBeTruthy();
    expect(screen.getByText('Not using it enough')).toBeTruthy();
    expect(screen.getByText('Found an alternative')).toBeTruthy();
    expect(screen.getByText('Other')).toBeTruthy();
  });

  it('should render free text textarea', () => {
    render(<CancelSurvey onSubmit={mockOnSubmit} onSkip={mockOnSkip} isSubmitting={false} />);
    expect(screen.getByLabelText('Additional feedback (optional)')).toBeTruthy();
  });

  it('should have "Submit & Cancel" button disabled when no reason selected', () => {
    render(<CancelSurvey onSubmit={mockOnSubmit} onSkip={mockOnSkip} isSubmitting={false} />);
    const submitButton = screen.getByText('Submit & Cancel');
    expect(submitButton.closest('button')).toHaveProperty('disabled', true);
  });

  it('should enable "Submit & Cancel" when a reason is selected', () => {
    render(<CancelSurvey onSubmit={mockOnSubmit} onSkip={mockOnSkip} isSubmitting={false} />);
    fireEvent.click(screen.getByText('Too expensive'));
    const submitButton = screen.getByText('Submit & Cancel');
    expect(submitButton.closest('button')).toHaveProperty('disabled', false);
  });

  it('should call onSubmit with reason and feedback', () => {
    render(<CancelSurvey onSubmit={mockOnSubmit} onSkip={mockOnSkip} isSubmitting={false} />);

    fireEvent.click(screen.getByText('Too expensive'));
    fireEvent.change(screen.getByLabelText('Additional feedback (optional)'), {
      target: { value: 'Price is too high' },
    });
    fireEvent.click(screen.getByText('Submit & Cancel'));

    expect(mockOnSubmit).toHaveBeenCalledWith({
      reason: 'too_expensive',
      feedback: 'Price is too high',
    });
  });

  it('should call onSkip when "Skip & Cancel" is clicked', () => {
    render(<CancelSurvey onSubmit={mockOnSubmit} onSkip={mockOnSkip} isSubmitting={false} />);
    fireEvent.click(screen.getByText('Skip & Cancel'));
    expect(mockOnSkip).toHaveBeenCalledOnce();
  });

  it('should show loading state when submitting', () => {
    render(<CancelSurvey onSubmit={mockOnSubmit} onSkip={mockOnSkip} isSubmitting={true} />);
    expect(screen.getByText('Canceling...')).toBeTruthy();
  });
});

describe('CancelConfirmation', () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('should show cancellation confirmed message', () => {
    render(<CancelConfirmation endDate={new Date('2026-05-01')} onClose={mockOnClose} />);
    expect(screen.getByText('Your subscription has been canceled')).toBeTruthy();
  });

  it('should show end-of-period date when provided', () => {
    // Use noon UTC to avoid timezone date-shift issues
    const endDate = new Date('2026-05-15T12:00:00Z');
    render(<CancelConfirmation endDate={endDate} onClose={mockOnClose} />);
    expect(screen.getByText(/Your plan will remain active until May 15, 2026/)).toBeTruthy();
  });

  it('should show generic message when no end date', () => {
    render(<CancelConfirmation endDate={null} onClose={mockOnClose} />);
    expect(
      screen.getByText(/Your plan will remain active until the end of your current billing period/),
    ).toBeTruthy();
  });

  it('should show resubscribe message', () => {
    render(<CancelConfirmation endDate={new Date('2026-05-01')} onClose={mockOnClose} />);
    expect(
      screen.getByText(
        'You can resubscribe at any time to restore full access. No data will be deleted.',
      ),
    ).toBeTruthy();
  });

  it('should call onClose when "Done" is clicked', () => {
    render(<CancelConfirmation endDate={new Date('2026-05-01')} onClose={mockOnClose} />);
    fireEvent.click(screen.getByText('Done'));
    expect(mockOnClose).toHaveBeenCalledOnce();
  });
});

describe('CancellationFlow', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    source: 'stripe' as const,
    planName: 'Reader',
    periodEnd: new Date('2026-05-01'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    cleanup();
  });

  describe('Stripe flow', () => {
    it('should show retention offer first for Stripe subscribers', () => {
      render(<CancellationFlow {...defaultProps} />);
      expect(screen.getByText('Special offer: 20% off your next month')).toBeTruthy();
    });

    it('should show dialog title "Before you go..."', () => {
      render(<CancellationFlow {...defaultProps} />);
      expect(screen.getByText('Before you go...')).toBeTruthy();
    });

    it('should proceed to survey when "Continue canceling" is clicked', () => {
      render(<CancellationFlow {...defaultProps} />);
      fireEvent.click(screen.getByText('Continue canceling'));
      // Survey step should be visible
      expect(screen.getByText("We're sorry to see you go. Why are you leaving?")).toBeTruthy();
    });

    it('should call apply-retention-coupon API when keeping plan', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      render(<CancellationFlow {...defaultProps} />);
      fireEvent.click(screen.getByText('Keep my plan - 20% off'));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          '/api/stripe/apply-retention-coupon',
          expect.objectContaining({
            method: 'POST',
          }),
        );
      });
    });

    it('should show success toast when coupon is applied', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      render(<CancellationFlow {...defaultProps} />);
      fireEvent.click(screen.getByText('Keep my plan - 20% off'));

      await waitFor(() => {
        expect(mockDispatch).toHaveBeenCalledWith('toast', {
          type: 'success',
          message: '20% discount applied to your next billing cycle!',
        });
      });
    });

    it('should call cancel-subscription API on survey submit', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      render(<CancellationFlow {...defaultProps} />);

      // Go to survey step
      fireEvent.click(screen.getByText('Continue canceling'));

      // Select a reason and submit
      fireEvent.click(screen.getByText('Too expensive'));
      fireEvent.click(screen.getByText('Submit & Cancel'));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          '/api/stripe/cancel-subscription',
          expect.objectContaining({
            method: 'POST',
            body: expect.any(String),
          }),
        );
      });
    });

    it('should store survey response via API', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      render(<CancellationFlow {...defaultProps} />);

      // Go to survey step
      fireEvent.click(screen.getByText('Continue canceling'));

      // Select reason and add feedback
      fireEvent.click(screen.getByText('Too expensive'));
      fireEvent.change(screen.getByLabelText('Additional feedback (optional)'), {
        target: { value: 'Too costly' },
      });
      fireEvent.click(screen.getByText('Submit & Cancel'));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          '/api/billing/cancel-survey',
          expect.objectContaining({
            method: 'POST',
          }),
        );
      });
    });

    it('should show confirmation with end date after successful cancel', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      render(<CancellationFlow {...defaultProps} />);

      // Go to survey, skip it
      fireEvent.click(screen.getByText('Continue canceling'));
      fireEvent.click(screen.getByText('Skip & Cancel'));

      await waitFor(() => {
        expect(screen.getByText('Your subscription has been canceled')).toBeTruthy();
      });
    });

    it('should show error toast when cancel API fails', async () => {
      (global.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true }),
        }) // survey succeeds
        .mockResolvedValueOnce({
          ok: false,
          json: async () => ({ error: 'Failed' }),
        }); // cancel fails

      render(<CancellationFlow {...defaultProps} />);

      // Go to survey, skip
      fireEvent.click(screen.getByText('Continue canceling'));
      fireEvent.click(screen.getByText('Skip & Cancel'));

      await waitFor(() => {
        expect(mockDispatch).toHaveBeenCalledWith('toast', {
          type: 'error',
          message: 'Failed to cancel subscription. Please try again.',
        });
      });
    });
  });

  describe('Apple IAP flow', () => {
    const appleProps = { ...defaultProps, source: 'apple' as const };

    it('should show pre-cancel prompt for Apple subscribers', () => {
      render(<CancellationFlow {...appleProps} />);
      expect(screen.getByText("Here's what you'll lose with Reader:")).toBeTruthy();
    });

    it('should NOT show retention offer for Apple subscribers', () => {
      render(<CancellationFlow {...appleProps} />);
      expect(screen.queryByText('Special offer: 20% off your next month')).toBeNull();
    });

    it('should list features that will be lost', () => {
      render(<CancellationFlow {...appleProps} />);
      expect(screen.getByText('Cloud sync across devices')).toBeTruthy();
      expect(screen.getByText('AI-powered book analysis')).toBeTruthy();
    });

    it('should proceed to survey on "Continue canceling"', () => {
      render(<CancellationFlow {...appleProps} />);
      fireEvent.click(screen.getByText('Continue canceling'));
      expect(screen.getByText("We're sorry to see you go. Why are you leaving?")).toBeTruthy();
    });

    it('should open Apple subscription management deep link', async () => {
      const mockOpen = vi.fn();
      window.open = mockOpen;

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      render(<CancellationFlow {...appleProps} />);

      // Go to survey, skip
      fireEvent.click(screen.getByText('Continue canceling'));
      fireEvent.click(screen.getByText('Skip & Cancel'));

      await waitFor(() => {
        expect(mockOpen).toHaveBeenCalledWith(
          'itms-apps://apps.apple.com/account/subscriptions',
          '_blank',
        );
      });
    });
  });

  describe('Google Play flow', () => {
    const googleProps = { ...defaultProps, source: 'google' as const };

    it('should show pre-cancel prompt for Google subscribers', () => {
      render(<CancellationFlow {...googleProps} />);
      expect(screen.getByText("Here's what you'll lose with Reader:")).toBeTruthy();
    });

    it('should open Google Play subscription management link', async () => {
      const mockOpen = vi.fn();
      window.open = mockOpen;

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      });

      render(<CancellationFlow {...googleProps} />);

      // Go to survey, skip
      fireEvent.click(screen.getByText('Continue canceling'));
      fireEvent.click(screen.getByText('Skip & Cancel'));

      await waitFor(() => {
        expect(mockOpen).toHaveBeenCalledWith(
          'https://play.google.com/store/account/subscriptions',
          '_blank',
        );
      });
    });
  });
});
