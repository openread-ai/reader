import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { StorageAddonSelector } from '@/components/settings/storage-addon-selector';

// ─── Mocks ───────────────────────────────────────────────────────────

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/lib/tier-gates', () => ({
  formatPriceDisplay: (cents: number) => (cents <= 0 ? '' : `$${(cents / 100).toFixed(2)}/mo`),
}));

vi.mock('@/utils/tailwind', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

// ─── Test Data ───────────────────────────────────────────────────────

const ADDONS = [
  { gb: 5, price_cents: 199, mobile_price_cents: 299 },
  { gb: 10, price_cents: 299, mobile_price_cents: 399 },
  { gb: 25, price_cents: 499, mobile_price_cents: 699 },
  { gb: 50, price_cents: 799, mobile_price_cents: 1099 },
];

// ─── Tests ───────────────────────────────────────────────────────────

describe('StorageAddonSelector', () => {
  const mockOnSelect = vi.fn().mockResolvedValue(undefined);
  const mockOnOpenChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('should render all 4 add-on options', () => {
    render(
      <StorageAddonSelector
        open={true}
        onOpenChange={mockOnOpenChange}
        availableAddons={ADDONS}
        onSelect={mockOnSelect}
      />,
    );

    expect(screen.getByText('+5 GB')).toBeTruthy();
    expect(screen.getByText('+10 GB')).toBeTruthy();
    expect(screen.getByText('+25 GB')).toBeTruthy();
    expect(screen.getByText('+50 GB')).toBeTruthy();
  });

  it('should show prices for each option', () => {
    render(
      <StorageAddonSelector
        open={true}
        onOpenChange={mockOnOpenChange}
        availableAddons={ADDONS}
        onSelect={mockOnSelect}
      />,
    );

    expect(screen.getByText('$1.99/mo')).toBeTruthy();
    expect(screen.getByText('$2.99/mo')).toBeTruthy();
    expect(screen.getByText('$4.99/mo')).toBeTruthy();
    expect(screen.getByText('$7.99/mo')).toBeTruthy();
  });

  it('should show dialog title and description', () => {
    render(
      <StorageAddonSelector
        open={true}
        onOpenChange={mockOnOpenChange}
        availableAddons={ADDONS}
        onSelect={mockOnSelect}
      />,
    );

    expect(screen.getByText('Add Storage')).toBeTruthy();
    expect(
      screen.getByText('Choose a storage add-on. Billed monthly as a separate subscription.'),
    ).toBeTruthy();
  });

  it('should disable Continue button until an option is selected', () => {
    render(
      <StorageAddonSelector
        open={true}
        onOpenChange={mockOnOpenChange}
        availableAddons={ADDONS}
        onSelect={mockOnSelect}
      />,
    );

    const continueButton = screen.getByText('Continue to Checkout').closest('button');
    expect(continueButton).toHaveProperty('disabled', true);
  });

  it('should enable Continue button after selecting an option', () => {
    render(
      <StorageAddonSelector
        open={true}
        onOpenChange={mockOnOpenChange}
        availableAddons={ADDONS}
        onSelect={mockOnSelect}
      />,
    );

    fireEvent.click(screen.getByText('+10 GB'));

    const continueButton = screen.getByText('Continue to Checkout').closest('button');
    expect(continueButton).toHaveProperty('disabled', false);
  });

  it('should call onSelect with the selected add-on when Continue is clicked', async () => {
    render(
      <StorageAddonSelector
        open={true}
        onOpenChange={mockOnOpenChange}
        availableAddons={ADDONS}
        onSelect={mockOnSelect}
      />,
    );

    fireEvent.click(screen.getByText('+25 GB'));
    fireEvent.click(screen.getByText('Continue to Checkout'));

    await waitFor(() => {
      expect(mockOnSelect).toHaveBeenCalledWith(ADDONS[2]);
    });
  });

  it('should call onOpenChange when Cancel is clicked', () => {
    render(
      <StorageAddonSelector
        open={true}
        onOpenChange={mockOnOpenChange}
        availableAddons={ADDONS}
        onSelect={mockOnSelect}
      />,
    );

    fireEvent.click(screen.getByText('Cancel'));

    expect(mockOnOpenChange).toHaveBeenCalledWith(false);
  });

  it('should not render when open is false', () => {
    render(
      <StorageAddonSelector
        open={false}
        onOpenChange={mockOnOpenChange}
        availableAddons={ADDONS}
        onSelect={mockOnSelect}
      />,
    );

    expect(screen.queryByText('Add Storage')).toBeNull();
  });
});
