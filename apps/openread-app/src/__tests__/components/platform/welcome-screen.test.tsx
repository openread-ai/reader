import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { WelcomeScreen } from '@/components/platform/welcome-screen';

// Mock next/link
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// Mock useTranslation
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

describe('WelcomeScreen', () => {
  const mockOnImport = vi.fn();
  const mockOnDismiss = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  it('should render the welcome heading', () => {
    render(<WelcomeScreen onImport={mockOnImport} onDismiss={mockOnDismiss} />);
    expect(screen.getByTestId('welcome-heading')).toBeTruthy();
    expect(screen.getByTestId('welcome-heading').textContent).toBe('Welcome to OpenRead');
  });

  it('should render the import book button', () => {
    render(<WelcomeScreen onImport={mockOnImport} onDismiss={mockOnDismiss} />);
    const importBtn = screen.getByTestId('welcome-import-btn');
    expect(importBtn).toBeTruthy();
    expect(importBtn.textContent).toContain('Import a Book');
  });

  it('should render the browse catalog button linking to /explore', () => {
    render(<WelcomeScreen onImport={mockOnImport} onDismiss={mockOnDismiss} />);
    const exploreBtn = screen.getByTestId('welcome-explore-btn');
    expect(exploreBtn).toBeTruthy();
    expect(exploreBtn.textContent).toContain('Browse Free Catalog');
    expect(exploreBtn.getAttribute('href')).toBe('/explore');
  });

  it('should render the skip/dismiss button', () => {
    render(<WelcomeScreen onImport={mockOnImport} onDismiss={mockOnDismiss} />);
    const dismissBtn = screen.getByTestId('welcome-dismiss-btn');
    expect(dismissBtn).toBeTruthy();
    expect(dismissBtn.textContent).toContain('Skip for now');
  });

  it('should call onImport when import button is clicked', () => {
    render(<WelcomeScreen onImport={mockOnImport} onDismiss={mockOnDismiss} />);
    screen.getByTestId('welcome-import-btn').click();
    expect(mockOnImport).toHaveBeenCalledTimes(1);
  });

  it('should call onDismiss when skip button is clicked', () => {
    render(<WelcomeScreen onImport={mockOnImport} onDismiss={mockOnDismiss} />);
    screen.getByTestId('welcome-dismiss-btn').click();
    expect(mockOnDismiss).toHaveBeenCalledTimes(1);
  });

  it('should have the correct test id on the container', () => {
    render(<WelcomeScreen onImport={mockOnImport} onDismiss={mockOnDismiss} />);
    expect(screen.getByTestId('welcome-screen')).toBeTruthy();
  });
});
