import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { PaymentMethod, type PaymentMethodData } from '@/components/settings/billing/PaymentMethod';

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

// ─── Tests ───────────────────────────────────────────────────────────

describe('PaymentMethod', () => {
  afterEach(() => {
    cleanup();
  });

  it('should show loading skeleton when isLoading is true', () => {
    render(<PaymentMethod isLoading />);
    const skeletons = document.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('should show no payment method message when data is null', () => {
    render(<PaymentMethod />);
    expect(screen.getByText('No payment method on file')).toBeTruthy();
  });

  it('should display card info for Stripe payment', () => {
    const method: PaymentMethodData = {
      source: 'stripe',
      last4: '4242',
      expiry: '12/27',
      brand: 'Visa',
    };
    render(<PaymentMethod paymentMethod={method} />);
    expect(screen.getByText(/Visa/)).toBeTruthy();
    expect(screen.getByText(/ending in/)).toBeTruthy();
    expect(screen.getByText(/4242/)).toBeTruthy();
    expect(screen.getByText(/Expires 12\/27/)).toBeTruthy();
  });

  it('should show card brand and last4 defaults', () => {
    const method: PaymentMethodData = {
      source: 'stripe',
    };
    render(<PaymentMethod paymentMethod={method} />);
    expect(screen.getByText(/Card/)).toBeTruthy();
    expect(screen.getByText(/\*\*\*\*/)).toBeTruthy();
  });

  it('should show Managed by Apple for Apple IAP', () => {
    const method: PaymentMethodData = {
      source: 'apple',
    };
    render(<PaymentMethod paymentMethod={method} />);
    expect(screen.getByText('Managed by Apple')).toBeTruthy();
  });

  it('should show Managed by Google Play for Google IAP', () => {
    const method: PaymentMethodData = {
      source: 'google',
    };
    render(<PaymentMethod paymentMethod={method} />);
    expect(screen.getByText('Managed by Google Play')).toBeTruthy();
  });

  it('should not show expiry when not provided for Stripe', () => {
    const method: PaymentMethodData = {
      source: 'stripe',
      last4: '1234',
    };
    render(<PaymentMethod paymentMethod={method} />);
    expect(screen.queryByText(/Expires/)).toBeNull();
  });

  it('should display Payment Method title', () => {
    render(<PaymentMethod />);
    expect(screen.getByText('Payment Method')).toBeTruthy();
  });
});
