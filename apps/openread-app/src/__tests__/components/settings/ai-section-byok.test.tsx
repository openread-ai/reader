import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

// --- Mock token value that tests can mutate ---
let mockAuthToken: string | null = null;

// Mock dependencies
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {} }),
}));

// Mock tier-config transitive dependencies (supabase, logger)
vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: vi.fn(() => ({ from: vi.fn() })),
}));
vi.mock('@/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    token: mockAuthToken,
    user: mockAuthToken ? { id: 'test-user' } : null,
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
  }),
}));

// Mock useQuotaStats (used by useFeatureGate -> useFeatureFlags)
vi.mock('@/hooks/useQuotaStats', () => ({
  useQuotaStats: () => ({
    quotas: [],
    userProfilePlan:
      mockAuthToken === 'plus-token' ? 'reader' : mockAuthToken === 'pro-token' ? 'pro' : 'free',
  }),
}));

vi.mock('@/store/settingsStore', () => {
  const mockState = {
    settings: {
      aiSettings: {
        enabled: true,
        provider: 'groq',
        ollamaBaseUrl: 'http://127.0.0.1:11434',
        ollamaModel: 'llama3.2',
        ollamaEmbeddingModel: 'nomic-embed-text',
        spoilerProtection: true,
      },
    },
    setSettings: vi.fn(),
    saveSettings: vi.fn(),
  };

  const fn = vi.fn(() => mockState) as unknown as {
    (): typeof mockState;
    getState: () => typeof mockState;
    setState: (partial: Partial<typeof mockState>) => void;
    subscribe: (listener: () => void) => () => void;
    destroy: () => void;
  };
  fn.getState = () => mockState;
  fn.setState = vi.fn();
  fn.subscribe = vi.fn();
  fn.destroy = vi.fn();

  return { useSettingsStore: fn };
});

vi.mock('@/hooks/useProviderKeys', () => ({
  useProviderKeys: () => ({
    keys: [],
    isLoading: false,
    error: null,
    addKey: vi.fn().mockResolvedValue(true),
    removeKey: vi.fn().mockResolvedValue(true),
    testKey: vi.fn().mockResolvedValue({ isValid: true }),
    refresh: vi.fn(),
  }),
}));

vi.mock('@/services/environment', () => ({
  isMobilePlatform: () => false,
  getAPIBaseUrl: () => 'http://localhost:3000/api',
}));

vi.mock('@/utils/access', () => ({
  getSubscriptionPlan: (token: string) => {
    if (token === 'plus-token') return 'reader';
    if (token === 'pro-token') return 'pro';
    return 'free';
  },
  getAccessToken: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/utils/event', () => ({
  eventDispatcher: { dispatch: vi.fn() },
}));

// Stub fetch for Ollama detection
vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('not available')));

import { AiSection, migrateAISettings } from '@/components/settings/ai-section';

describe('migrateAISettings', () => {
  it('should migrate ai-gateway provider to groq', () => {
    const settings = {
      enabled: true,
      provider: 'ai-gateway' as const,
      ollamaBaseUrl: 'http://127.0.0.1:11434',
      ollamaModel: 'llama3.2',
      ollamaEmbeddingModel: 'nomic-embed-text',
      spoilerProtection: true,
    };
    const migrated = migrateAISettings(settings);
    expect(migrated.provider).toBe('groq');
  });

  it('should not change groq provider', () => {
    const settings = {
      enabled: true,
      provider: 'groq' as const,
      ollamaBaseUrl: 'http://127.0.0.1:11434',
      ollamaModel: 'llama3.2',
      ollamaEmbeddingModel: 'nomic-embed-text',
      spoilerProtection: true,
    };
    const migrated = migrateAISettings(settings);
    expect(migrated.provider).toBe('groq');
  });
});

describe('AiSection - BYOK UI (free user)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthToken = null;
  });

  afterEach(() => {
    cleanup();
  });

  it('should render the BYOK section header', () => {
    render(<AiSection />);
    expect(screen.getByText('Bring Your Own Key')).toBeTruthy();
  });

  it('should show Plus+ badge', () => {
    render(<AiSection />);
    expect(screen.getByText('Plus+')).toBeTruthy();
  });

  it('should show upgrade link for free users (no token)', () => {
    render(<AiSection />);
    // Gate message from tier-gates: "Bring Your Own Key is available on Reader."
    expect(screen.getByText(/Bring Your Own Key is available on Reader/)).toBeTruthy();
    // CTA shows tier name and price from S4.2 (ctaText: "Start Reader -- $7.99/mo")
    expect(screen.getByText(/Start Reader/)).toBeTruthy();
  });

  it('should render the enable AI toggle', () => {
    render(<AiSection />);
    expect(screen.getByText('Enable AI Features')).toBeTruthy();
  });

  it('should render the mode selector', () => {
    render(<AiSection />);
    expect(screen.getByText('Online (Cloud)')).toBeTruthy();
    expect(screen.getByText('Offline (Local)')).toBeTruthy();
  });
});

describe('AiSection - BYOK for Plus users', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthToken = 'plus-token';
  });

  afterEach(() => {
    cleanup();
  });

  it('should show provider dropdown for Plus users', () => {
    render(<AiSection />);
    const selectButton = screen.getByLabelText('Select provider');
    expect(selectButton).toBeTruthy();
  });

  it('should open dropdown when clicked', async () => {
    render(<AiSection />);
    const selectButton = screen.getByLabelText('Select provider');
    fireEvent.click(selectButton);

    await waitFor(() => {
      expect(screen.getByText('OpenAI')).toBeTruthy();
      expect(screen.getByText('Anthropic')).toBeTruthy();
      expect(screen.getByText('Google')).toBeTruthy();
      expect(screen.getByText('Groq')).toBeTruthy();
      expect(screen.getByText('DeepSeek')).toBeTruthy();
      expect(screen.getByText('OpenRouter')).toBeTruthy();
      expect(screen.getByText('Custom')).toBeTruthy();
    });
  });

  it('should filter providers when searching', async () => {
    render(<AiSection />);
    const selectButton = screen.getByLabelText('Select provider');
    fireEvent.click(selectButton);

    const searchInput = screen.getByPlaceholderText('Search providers...');
    fireEvent.change(searchInput, { target: { value: 'open' } });

    await waitFor(() => {
      expect(screen.getByText('OpenAI')).toBeTruthy();
      expect(screen.getByText('OpenRouter')).toBeTruthy();
      expect(screen.queryByText('Anthropic')).toBeNull();
    });
  });

  it('should show API key input after selecting a provider', async () => {
    render(<AiSection />);
    const selectButton = screen.getByLabelText('Select provider');
    fireEvent.click(selectButton);

    await waitFor(() => {
      fireEvent.click(screen.getByText('OpenAI'));
    });

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Enter your API key...')).toBeTruthy();
      expect(screen.getByText('Test Connection')).toBeTruthy();
      expect(screen.getByText('Save')).toBeTruthy();
    });
  });

  it('should have show/hide toggle for API key', async () => {
    render(<AiSection />);
    const selectButton = screen.getByLabelText('Select provider');
    fireEvent.click(selectButton);

    await waitFor(() => {
      fireEvent.click(screen.getByText('OpenAI'));
    });

    await waitFor(() => {
      const showButton = screen.getByLabelText('Show key');
      expect(showButton).toBeTruthy();
      fireEvent.click(showButton);
      expect(screen.getByLabelText('Hide key')).toBeTruthy();
    });
  });

  it('should not show upgrade link for Plus users', () => {
    render(<AiSection />);
    expect(screen.queryByText(/Bring Your Own Key is available on Reader/)).toBeNull();
    // Plus users see the provider dropdown, not upgrade CTA
    expect(screen.queryByText(/Start Reader/)).toBeNull();
  });
});
