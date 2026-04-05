import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MCPLimitDisplay } from '@/components/settings/billing/MCPLimitDisplay';

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

describe('MCPLimitDisplay', () => {
  afterEach(() => {
    cleanup();
  });

  it('should display MCP title', () => {
    render(<MCPLimitDisplay />);
    expect(screen.getByText('MCP')).toBeTruthy();
  });

  it('should display default rate limit (60 req/min)', () => {
    render(<MCPLimitDisplay />);
    expect(screen.getByText('0 / 60 req/min')).toBeTruthy();
  });

  it('should display custom rate limit', () => {
    render(<MCPLimitDisplay used={42} limitPerMinute={60} />);
    expect(screen.getByText('42 / 60 req/min')).toBeTruthy();
  });

  it('should show View docs link', () => {
    render(<MCPLimitDisplay />);
    const link = screen.getByText('View docs');
    expect(link).toBeTruthy();
    expect(link.closest('a')).toHaveProperty('href');
  });

  it('should show rate limit description', () => {
    render(<MCPLimitDisplay />);
    expect(screen.getByText('Rate limit for MCP tool calls')).toBeTruthy();
  });

  it('should link to api-keys settings page', () => {
    render(<MCPLimitDisplay />);
    const link = screen.getByText('View docs').closest('a');
    expect(link?.getAttribute('href')).toBe('/settings/api-keys');
  });
});
