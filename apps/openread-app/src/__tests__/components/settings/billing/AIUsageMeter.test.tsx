import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { AIUsageMeter } from '@/components/settings/billing/AIUsageMeter';

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

const mockAIQuotaState: {
  used: number;
  limit: number;
  limitType: 'daily' | 'monthly';
  resetAt: string | null;
  percentUsed: number;
} = {
  used: 42,
  limit: 100,
  limitType: 'monthly',
  resetAt: '2026-04-28T00:00:00Z',
  percentUsed: 42,
};

vi.mock('@/store/aiQuotaStore', () => ({
  useAIQuotaStore: (selector: (s: typeof mockAIQuotaState) => unknown) =>
    selector(mockAIQuotaState),
}));

// ─── Tests ───────────────────────────────────────────────────────────

describe('AIUsageMeter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to defaults
    mockAIQuotaState.used = 42;
    mockAIQuotaState.limit = 100;
    mockAIQuotaState.limitType = 'monthly';
    mockAIQuotaState.resetAt = '2026-04-28T00:00:00Z';
    mockAIQuotaState.percentUsed = 42;
  });

  afterEach(() => {
    cleanup();
  });

  it('should show loading skeleton when isLoading is true', () => {
    render(<AIUsageMeter isLoading />);
    const skeletons = document.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('should display AI Usage title', () => {
    render(<AIUsageMeter />);
    expect(screen.getByText('AI Usage')).toBeTruthy();
  });

  it('should display usage count and limit for monthly metering', () => {
    render(<AIUsageMeter />);
    expect(screen.getByText(/42 \/ 100 this month\./)).toBeTruthy();
  });

  it('should display reset info text', () => {
    render(<AIUsageMeter />);
    // The reset text is in a child span, so use container textContent
    const container = screen.getByText(/42 \/ 100 this month\./).closest('p');
    expect(container?.textContent).toContain('Resets');
  });

  it('should show progress bar', () => {
    render(<AIUsageMeter />);
    expect(screen.getByRole('progressbar')).toBeTruthy();
  });

  it('should show unlimited label when limit is -1', () => {
    mockAIQuotaState.limit = -1;
    mockAIQuotaState.percentUsed = 0;

    render(<AIUsageMeter />);
    expect(screen.getByText('Unlimited')).toBeTruthy();
    // Should not show a progress bar for unlimited
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('should show daily label when limitType is daily', () => {
    mockAIQuotaState.limitType = 'daily';
    mockAIQuotaState.resetAt = '2026-04-02T00:00:00Z';

    render(<AIUsageMeter />);
    expect(screen.getByText(/42 \/ 100 today\./)).toBeTruthy();
  });

  it('should apply warning color when usage is high', () => {
    mockAIQuotaState.percentUsed = 85;

    render(<AIUsageMeter />);
    const usageText = screen.getByText(/42 \/ 100/);
    expect(usageText.className).toContain('text-warning');
  });

  it('should apply error color when usage exceeds 95%', () => {
    mockAIQuotaState.percentUsed = 98;

    render(<AIUsageMeter />);
    const usageText = screen.getByText(/42 \/ 100/);
    expect(usageText.className).toContain('text-error');
  });
});
