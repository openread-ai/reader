import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { StorageMeter } from '@/components/settings/billing/StorageMeter';

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

const mockUseStorageQuota = vi.fn();
vi.mock('@/hooks/useStorageQuota', () => ({
  useStorageQuota: () => mockUseStorageQuota(),
}));

// ─── Helpers ─────────────────────────────────────────────────────────

const GB = 1024 * 1024 * 1024;

function makeQuota(overrides: Record<string, unknown> = {}) {
  return {
    plan: 'reader',
    base_gb: 2,
    addon_gb: 8,
    total_bytes: 10 * GB,
    used_bytes: 6.2 * GB,
    available_bytes: 3.8 * GB,
    percent_used: 62,
    is_over_limit: false,
    active_addons: [],
    available_addons: [],
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('StorageMeter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('should show loading skeleton when loading', () => {
    mockUseStorageQuota.mockReturnValue({ quota: null, isLoading: true, error: null });

    render(<StorageMeter />);
    const skeletons = document.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('should show error state when fetch fails', () => {
    mockUseStorageQuota.mockReturnValue({
      quota: null,
      isLoading: false,
      error: new Error('fail'),
    });

    render(<StorageMeter />);
    expect(screen.getByText('Failed to load storage data')).toBeTruthy();
  });

  it('should display Storage title', () => {
    mockUseStorageQuota.mockReturnValue({
      quota: makeQuota(),
      isLoading: false,
      error: null,
    });

    render(<StorageMeter />);
    expect(screen.getByText('Storage')).toBeTruthy();
  });

  it('should display usage with total GB', () => {
    mockUseStorageQuota.mockReturnValue({
      quota: makeQuota(),
      isLoading: false,
      error: null,
    });

    render(<StorageMeter />);
    // 6.2 GB displayed as "6.2 GB"
    expect(screen.getByText(/6\.2 GB/)).toBeTruthy();
    expect(screen.getByText(/of/)).toBeTruthy();
    expect(screen.getByText(/10 GB/)).toBeTruthy();
  });

  it('should show breakdown with base + add-ons', () => {
    mockUseStorageQuota.mockReturnValue({
      quota: makeQuota({ base_gb: 2, addon_gb: 8 }),
      isLoading: false,
      error: null,
    });

    render(<StorageMeter />);
    expect(screen.getByText(/2 GB base \+ 8 GB add-ons/)).toBeTruthy();
  });

  it('should show base-only breakdown when no add-ons', () => {
    mockUseStorageQuota.mockReturnValue({
      quota: makeQuota({ base_gb: 2, addon_gb: 0 }),
      isLoading: false,
      error: null,
    });

    render(<StorageMeter />);
    expect(screen.getByText(/2 GB base/)).toBeTruthy();
  });

  it('should show progress bar', () => {
    mockUseStorageQuota.mockReturnValue({
      quota: makeQuota(),
      isLoading: false,
      error: null,
    });

    render(<StorageMeter />);
    expect(screen.getByRole('progressbar')).toBeTruthy();
  });

  it('should render Add Storage button when onAddStorage is provided', () => {
    mockUseStorageQuota.mockReturnValue({
      quota: makeQuota(),
      isLoading: false,
      error: null,
    });

    const onAdd = vi.fn();
    render(<StorageMeter onAddStorage={onAdd} />);
    const addButton = screen.getByText('Add Storage');
    expect(addButton).toBeTruthy();

    fireEvent.click(addButton);
    expect(onAdd).toHaveBeenCalled();
  });

  it('should not render Add Storage button when onAddStorage is not provided', () => {
    mockUseStorageQuota.mockReturnValue({
      quota: makeQuota(),
      isLoading: false,
      error: null,
    });

    render(<StorageMeter />);
    expect(screen.queryByText('Add Storage')).toBeNull();
  });

  it('should apply warning color when usage is high', () => {
    mockUseStorageQuota.mockReturnValue({
      quota: makeQuota({ percent_used: 85 }),
      isLoading: false,
      error: null,
    });

    render(<StorageMeter />);
    const usageText = screen.getByText(/6\.2 GB/);
    expect(usageText.className).toContain('text-warning');
  });
});
