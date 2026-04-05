import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, params?: Record<string, string>) => {
    if (params) {
      return Object.entries(params).reduce((result, [k, v]) => result.replace(`{{${k}}}`, v), key);
    }
    return key;
  },
}));

import { LibraryLimitBanner } from '@/components/platform/library-limit-banner';

describe('LibraryLimitBanner', () => {
  afterEach(() => {
    cleanup();
  });

  it('should render the limit message', () => {
    render(<LibraryLimitBanner limit={10} priceCents={799} />);
    expect(screen.getByText(/Library full \(10 books\)/)).toBeTruthy();
  });

  it('should show price in the CTA', () => {
    render(<LibraryLimitBanner limit={10} priceCents={799} />);
    const link = screen.getByRole('link');
    expect(link.textContent).toContain('$7.99/mo');
  });

  it('should show tier name when provided', () => {
    render(<LibraryLimitBanner limit={10} priceCents={799} tierName='Reader' />);
    const link = screen.getByRole('link');
    expect(link.textContent).toContain('Reader');
    expect(link.textContent).toContain('$7.99/mo');
  });

  it('should show generic CTA when tierName is not provided', () => {
    render(<LibraryLimitBanner limit={10} priceCents={799} />);
    const link = screen.getByRole('link');
    expect(link.textContent).toContain('Start Reading');
  });

  it('should link to /user#plans', () => {
    render(<LibraryLimitBanner limit={10} priceCents={799} />);
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('/user#plans');
  });

  it('should format different prices correctly', () => {
    render(<LibraryLimitBanner limit={5} priceCents={1499} tierName='Pro' />);
    const link = screen.getByRole('link');
    expect(link.textContent).toContain('$14.99/mo');
    expect(link.textContent).toContain('Pro');
  });
});
