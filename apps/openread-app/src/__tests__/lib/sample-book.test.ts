import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SAMPLE_BOOK_ID, SAMPLE_BOOK_ATTEMPTED_KEY, importSampleBook } from '@/lib/sample-book';

// Mock the logger
vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock CATALOG_API_BASE_URL
vi.mock('@/services/constants', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, CATALOG_API_BASE_URL: 'https://api.test.com' };
});

describe('sample-book constants', () => {
  it('should export a SAMPLE_BOOK_ID constant', () => {
    expect(SAMPLE_BOOK_ID).toBe('alice-in-wonderland');
  });

  it('should export a SAMPLE_BOOK_ATTEMPTED_KEY constant', () => {
    expect(SAMPLE_BOOK_ATTEMPTED_KEY).toBe('sample_book_attempted');
  });

  it('SAMPLE_BOOK_ID should be a non-empty string (easy to change)', () => {
    expect(typeof SAMPLE_BOOK_ID).toBe('string');
    expect(SAMPLE_BOOK_ID.length).toBeGreaterThan(0);
  });
});

describe('importSampleBook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should mark as attempted in localStorage immediately', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ status: 'ready', book_id: '123' }), { status: 200 }),
    );

    await importSampleBook('test-token');
    expect(localStorage.getItem(SAMPLE_BOOK_ATTEMPTED_KEY)).not.toBeNull();
  });

  it('should return true when import is immediately ready', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ status: 'ready', book_id: '123', book_hash: 'abc' }), {
        status: 200,
      }),
    );

    const result = await importSampleBook('test-token');
    expect(result).toBe(true);
  });

  it('should call the correct API endpoint with auth header', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ status: 'ready' }), { status: 200 }),
    );

    await importSampleBook('my-jwt-token');

    expect(fetch).toHaveBeenCalledWith(
      `https://api.test.com/api/catalog/books/${SAMPLE_BOOK_ID}/import`,
      {
        method: 'POST',
        headers: { Authorization: 'Bearer my-jwt-token' },
      },
    );
  });

  it('should return false when API returns non-OK status', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('Not Found', { status: 404 }));

    const result = await importSampleBook('test-token');
    expect(result).toBe(false);
  });

  it('should still mark as attempted even on API failure', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('Server Error', { status: 500 }));

    await importSampleBook('test-token');
    expect(localStorage.getItem(SAMPLE_BOOK_ATTEMPTED_KEY)).not.toBeNull();
  });

  it('should return false when book status is preparing (no polling)', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ status: 'preparing' }), { status: 200 }),
    );

    const result = await importSampleBook('test-token');
    expect(result).toBe(false);
  });

  it('should return false and not throw on network error', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

    const result = await importSampleBook('test-token');
    expect(result).toBe(false);
  });

  it('should still mark as attempted on network error', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

    await importSampleBook('test-token');
    expect(localStorage.getItem(SAMPLE_BOOK_ATTEMPTED_KEY)).not.toBeNull();
  });
});
