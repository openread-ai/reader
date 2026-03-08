import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { McpConfigTabs } from '@/components/settings/mcp-config-tabs';
import { McpSetupGuide } from '@/components/settings/mcp-setup-guide';
import { CodeBlock } from '@/components/primitives/code-block';

// Mock the clipboard API
const mockWriteText = vi.fn().mockResolvedValue(undefined);
Object.assign(navigator, {
  clipboard: {
    writeText: mockWriteText,
  },
});

// Mock eventDispatcher
vi.mock('@/utils/event', () => ({
  eventDispatcher: {
    dispatch: vi.fn(),
  },
}));

// Mock Radix Select portal to render inline for testing
vi.mock('@radix-ui/react-select', async () => {
  const actual = await vi.importActual('@radix-ui/react-select');
  return {
    ...actual,
    Portal: ({ children }: { children: React.ReactNode }) => children,
  };
});

describe('McpConfigTabs Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe('Rendering', () => {
    it('should render the client selector dropdown', () => {
      render(<McpConfigTabs apiKey='or_test123' />);

      const trigger = screen.getByRole('combobox', { name: 'Select MCP client' });
      expect(trigger).toBeTruthy();
    });

    it('should default to Claude Desktop selection', () => {
      render(<McpConfigTabs apiKey='or_test123' />);

      // The trigger should show Claude Desktop as the selected value
      const trigger = screen.getByRole('combobox', { name: 'Select MCP client' });
      expect(trigger.textContent).toContain('Claude Desktop');
    });

    it('should show API key in config', () => {
      render(<McpConfigTabs apiKey='or_secretkey123' />);

      expect(screen.getByText(/or_secretkey123/)).toBeTruthy();
    });

    it('should show placeholder when no key provided', () => {
      render(<McpConfigTabs />);

      expect(screen.getByText(/your-api-key/)).toBeTruthy();
    });

    it('should show config file path above code block', () => {
      render(<McpConfigTabs apiKey='or_test123' />);

      expect(screen.getByText(/Add this to/)).toBeTruthy();
    });
  });

  describe('Key masking', () => {
    it('should mask key when only prefix provided', () => {
      const { container } = render(<McpConfigTabs keyPrefix='or_abc12' />);

      // The masked key should show prefix + asterisks
      expect(container.textContent).toContain('or_abc1');
      expect(container.textContent).toContain('*');
    });

    it('should prefer full apiKey over keyPrefix', () => {
      render(<McpConfigTabs apiKey='or_fullkey123' keyPrefix='or_prefix' />);

      expect(screen.getByText(/or_fullkey123/)).toBeTruthy();
      expect(screen.queryByText(/or_prefix/)).toBeFalsy();
    });
  });

  describe('Setup Instructions', () => {
    it('should show setup instructions by default', () => {
      render(<McpConfigTabs apiKey='or_test' />);

      expect(screen.getByText('Setup Instructions')).toBeTruthy();
    });

    it('should hide setup instructions when showInstructions is false', () => {
      render(<McpConfigTabs apiKey='or_test' showInstructions={false} />);

      expect(screen.queryByText('Setup Instructions')).toBeFalsy();
    });
  });

  describe('Custom baseUrl', () => {
    it('should not show custom baseUrl without showAdvanced', () => {
      const { container } = render(
        <McpConfigTabs apiKey='or_test' baseUrl='https://custom.openread.ai' />,
      );

      // baseUrl should NOT appear in output without showAdvanced (P11.20 change)
      expect(container.textContent).not.toContain('custom.openread.ai');
    });
  });
});

describe('McpSetupGuide Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('should render collapsed by default', () => {
    render(<McpSetupGuide client='claude-desktop' />);

    expect(screen.getByText('Setup Instructions')).toBeTruthy();
    // Instructions should not be visible
    expect(screen.queryByText('Open Claude Desktop settings')).toBeFalsy();
  });

  it('should expand when clicked', () => {
    render(<McpSetupGuide client='claude-desktop' />);

    const trigger = screen.getByText('Setup Instructions');
    fireEvent.click(trigger);

    expect(screen.getByText('Open Claude Desktop settings')).toBeTruthy();
  });

  it('should collapse when clicked again', () => {
    render(<McpSetupGuide client='claude-desktop' />);

    const trigger = screen.getByText('Setup Instructions');

    // Expand
    fireEvent.click(trigger);
    expect(screen.getByText('Open Claude Desktop settings')).toBeTruthy();

    // Collapse
    fireEvent.click(trigger);
    expect(screen.queryByText('Open Claude Desktop settings')).toBeFalsy();
  });

  it('should have proper aria attributes', () => {
    render(<McpSetupGuide client='cursor' />);

    const trigger = screen.getByRole('button');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('should show correct instructions for each client', () => {
    // Claude Desktop
    const { unmount: unmount1, container: c1 } = render(<McpSetupGuide client='claude-desktop' />);
    fireEvent.click(screen.getByText('Setup Instructions'));
    // Look specifically in the instructions list
    const list1 = c1.querySelector('ol');
    expect(list1?.textContent).toContain('Claude Desktop');
    unmount1();

    // Cursor
    const { unmount: unmount2, container: c2 } = render(<McpSetupGuide client='cursor' />);
    fireEvent.click(screen.getByText('Setup Instructions'));
    const list2 = c2.querySelector('ol');
    expect(list2?.textContent).toContain('Cursor');
    unmount2();

    // Claude Code
    const { container: c3 } = render(<McpSetupGuide client='claude-code' />);
    fireEvent.click(screen.getByText('Setup Instructions'));
    const list3 = c3.querySelector('ol');
    expect(list3?.textContent).toContain('terminal');
  });

  it('should show client-specific instructions for vscode', () => {
    const { container } = render(<McpSetupGuide client='vscode' />);

    expect(screen.getByText('Setup Instructions')).toBeTruthy();
    fireEvent.click(screen.getByText('Setup Instructions'));

    const list = container.querySelector('ol');
    expect(list?.textContent).toContain('VS Code');
  });
});

describe('CodeBlock Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('should render code content', () => {
    const code = '{"key": "value"}';
    render(<CodeBlock code={code} />);

    expect(screen.getByText(code)).toBeTruthy();
  });

  it('should show copy button by default', () => {
    render(<CodeBlock code='test' />);

    expect(screen.getByRole('button', { name: /copy/i })).toBeTruthy();
  });

  it('should hide copy button when showCopy is false', () => {
    render(<CodeBlock code='test' showCopy={false} />);

    expect(screen.queryByRole('button', { name: /copy/i })).toBeFalsy();
  });

  it('should copy code to clipboard when button clicked', async () => {
    const code = 'code to copy';
    render(<CodeBlock code={code} />);

    const copyButton = screen.getByRole('button', { name: /copy/i });
    fireEvent.click(copyButton);

    expect(mockWriteText).toHaveBeenCalledWith(code);
  });

  it('should apply custom className', () => {
    const { container } = render(<CodeBlock code='test' className='custom-class' />);

    expect(container.firstChild).toHaveProperty('className');
    expect((container.firstChild as HTMLElement).className).toContain('custom-class');
  });

  it('should apply language class to code element', () => {
    render(<CodeBlock code='test' language='json' />);

    const codeElement = screen.getByText('test');
    expect(codeElement.className).toContain('language-json');
  });

  it('should respect maxHeight prop', () => {
    render(<CodeBlock code='test' maxHeight='500px' />);

    const preElement = screen.getByText('test').closest('pre');
    expect(preElement?.style.maxHeight).toBe('500px');
  });
});
