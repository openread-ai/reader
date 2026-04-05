import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { UsageHistory, type MonthUsage } from '@/components/settings/billing/UsageHistory';

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

// ─── Helpers ─────────────────────────────────────────────────────────

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;

const sampleMonths: MonthUsage[] = [
  { month: 'Mar 2026', aiMessages: 87, storageDeltaBytes: 1.2 * GB },
  { month: 'Feb 2026', aiMessages: 45, storageDeltaBytes: 200 * MB },
  { month: 'Jan 2026', aiMessages: 12, storageDeltaBytes: -500 * MB },
];

// ─── Tests ───────────────────────────────────────────────────────────

describe('UsageHistory', () => {
  afterEach(() => {
    cleanup();
  });

  it('should show loading skeleton when isLoading is true', () => {
    render(<UsageHistory isLoading />);
    const skeletons = document.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('should show empty state when no months data', () => {
    render(<UsageHistory months={[]} />);
    expect(screen.getByText('No usage history yet')).toBeTruthy();
  });

  it('should show empty state with default empty array', () => {
    render(<UsageHistory />);
    expect(screen.getByText('No usage history yet')).toBeTruthy();
  });

  it('should display Monthly Usage title', () => {
    render(<UsageHistory months={sampleMonths} />);
    expect(screen.getByText('Monthly Usage')).toBeTruthy();
  });

  it('should display table headers', () => {
    render(<UsageHistory months={sampleMonths} />);
    expect(screen.getByText('Month')).toBeTruthy();
    expect(screen.getByText('AI Messages')).toBeTruthy();
    expect(screen.getByText('Storage Change')).toBeTruthy();
  });

  it('should display month labels', () => {
    render(<UsageHistory months={sampleMonths} />);
    expect(screen.getByText('Mar 2026')).toBeTruthy();
    expect(screen.getByText('Feb 2026')).toBeTruthy();
    expect(screen.getByText('Jan 2026')).toBeTruthy();
  });

  it('should display AI message counts', () => {
    render(<UsageHistory months={sampleMonths} />);
    expect(screen.getByText('87')).toBeTruthy();
    expect(screen.getByText('45')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
  });

  it('should format positive storage delta with +', () => {
    render(<UsageHistory months={sampleMonths} />);
    expect(screen.getByText('+1.2 GB')).toBeTruthy();
  });

  it('should format negative storage delta with -', () => {
    render(<UsageHistory months={sampleMonths} />);
    expect(screen.getByText('-500.0 MB')).toBeTruthy();
  });

  it('should display description text', () => {
    render(<UsageHistory months={sampleMonths} />);
    expect(screen.getByText('Your usage over the last 3 months')).toBeTruthy();
  });
});
