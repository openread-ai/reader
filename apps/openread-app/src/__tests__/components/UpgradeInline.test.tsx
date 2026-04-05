import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

import UpgradeInline from '@/components/UpgradeInline';

describe('UpgradeInline', () => {
  afterEach(() => {
    cleanup();
  });

  it('should render message and default CTA', () => {
    render(<UpgradeInline message='Text-to-Speech is available on Reader.' />);
    expect(screen.getByText('Text-to-Speech is available on Reader.')).toBeTruthy();
    expect(screen.getByText(/Start Reading/)).toBeTruthy();
  });

  it('should show price in CTA when price prop is provided', () => {
    render(<UpgradeInline message='Text-to-Speech is available on Reader.' price='$7.99/mo' />);
    const link = screen.getByRole('link');
    expect(link.textContent).toContain('$7.99/mo');
    expect(link.textContent).toContain('Start Reading');
  });

  it('should prefer ctaText over price when both are provided', () => {
    render(
      <UpgradeInline
        message='Text-to-Speech is available on Reader.'
        ctaText='Start Reader — $7.99/mo'
        price='$7.99/mo'
      />,
    );
    const link = screen.getByRole('link');
    expect(link.textContent).toContain('Start Reader');
  });

  it('should render default CTA without price when price is not provided', () => {
    render(<UpgradeInline message='Cloud Sync is available on Reader.' />);
    const link = screen.getByRole('link');
    // Should just say "Start Reading" without any price
    expect(link.textContent).toContain('Start Reading');
    expect(link.textContent).not.toContain('$');
  });

  it('should dismiss when close button is clicked', () => {
    const onDismiss = vi.fn();
    render(<UpgradeInline message='TTS is gated.' price='$7.99/mo' onDismiss={onDismiss} />);
    const dismissButton = screen.getByLabelText('Dismiss');
    fireEvent.click(dismissButton);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    // Component should be gone
    expect(screen.queryByText('TTS is gated.')).toBeNull();
  });

  it('should link to /user/plans by default', () => {
    render(<UpgradeInline message='Test message' price='$7.99/mo' />);
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('/user/plans');
  });

  it('should use custom ctaHref when provided', () => {
    render(<UpgradeInline message='Test message' price='$7.99/mo' ctaHref='/pricing' />);
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('/pricing');
  });
});
