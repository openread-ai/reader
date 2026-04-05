import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';

// ─── Mocks ───────────────────────────────────────────────────────────

const mockUser = { id: 'user-123', email: 'test@example.com' };
const mockAuth = vi.fn();

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => mockAuth(),
}));

vi.mock('@/utils/access', () => ({
  getAccessToken: vi.fn().mockResolvedValue('mock-access-token'),
}));

vi.mock('@/services/environment', () => ({
  getAPIBaseUrl: () => '/api',
}));

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// ─── Helpers ─────────────────────────────────────────────────────────

const GB = 1024 * 1024 * 1024;

const MOCK_QUOTA_RESPONSE = {
  plan: 'reader',
  base_gb: 2,
  addon_gb: 5,
  total_bytes: 7 * GB,
  used_bytes: 3 * GB,
  available_bytes: 4 * GB,
  percent_used: 42.86,
  is_over_limit: false,
  active_addons: [
    { id: 'a1', gb_amount: 5, price_cents: 199, source: 'stripe', created_at: '2026-01-01' },
  ],
  available_addons: [
    { gb: 5, price_cents: 199, mobile_price_cents: 299 },
    { gb: 10, price_cents: 299, mobile_price_cents: 399 },
  ],
};

// ─── Tests ───────────────────────────────────────────────────────────

describe('useStorageQuota', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockReturnValue({ user: mockUser, token: 'mock-token' });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('should fetch and return storage quota data', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(MOCK_QUOTA_RESPONSE),
    });

    const { useStorageQuota } = await import('@/hooks/useStorageQuota');
    const { result } = renderHook(() => useStorageQuota());

    // Initially loading
    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.quota).toEqual(MOCK_QUOTA_RESPONSE);
    expect(result.current.error).toBeNull();
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/storage/quota',
      expect.objectContaining({
        headers: { Authorization: 'Bearer mock-access-token' },
      }),
    );
  });

  it('should return null quota when user is not authenticated', async () => {
    mockAuth.mockReturnValue({ user: null, token: null });

    const { useStorageQuota } = await import('@/hooks/useStorageQuota');
    const { result } = renderHook(() => useStorageQuota());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.quota).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('should set error on fetch failure', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'Internal error' }),
    });

    const { useStorageQuota } = await import('@/hooks/useStorageQuota');
    const { result } = renderHook(() => useStorageQuota());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.quota).toBeNull();
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toContain('500');
  });

  it('should set error on network failure', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const { useStorageQuota } = await import('@/hooks/useStorageQuota');
    const { result } = renderHook(() => useStorageQuota());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.quota).toBeNull();
    expect(result.current.error?.message).toBe('Network error');
  });

  it('should provide a refetch function', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(MOCK_QUOTA_RESPONSE),
    });

    const { useStorageQuota } = await import('@/hooks/useStorageQuota');
    const { result } = renderHook(() => useStorageQuota());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(typeof result.current.refetch).toBe('function');
  });
});
