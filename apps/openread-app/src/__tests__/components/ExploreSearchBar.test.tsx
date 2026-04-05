import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ExploreSearchBar } from '@/components/explore/ExploreSearchBar';

describe('ExploreSearchBar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('should render with default placeholder text', () => {
    render(<ExploreSearchBar />);
    expect(screen.getByPlaceholderText('Search books, authors, subjects...')).toBeTruthy();
  });

  it('should render search icon', () => {
    const { container } = render(<ExploreSearchBar />);
    // Lucide Search icon renders as SVG
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('should not show clear button when empty', () => {
    render(<ExploreSearchBar />);
    expect(screen.queryByRole('button', { name: /clear search/i })).toBeNull();
  });

  it('should show clear button when text is entered', () => {
    render(<ExploreSearchBar value='test' onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /clear search/i })).toBeTruthy();
  });

  it('should call onChange on every keystroke', () => {
    const onChange = vi.fn();
    render(<ExploreSearchBar onChange={onChange} />);
    const input = screen.getByPlaceholderText('Search books, authors, subjects...');

    fireEvent.change(input, { target: { value: 'q' } });
    expect(onChange).toHaveBeenCalledWith('q');

    fireEvent.change(input, { target: { value: 'qu' } });
    expect(onChange).toHaveBeenCalledWith('qu');
  });

  it('should call onSearch after 300ms debounce', () => {
    const onSearch = vi.fn();
    render(<ExploreSearchBar onSearch={onSearch} />);
    const input = screen.getByPlaceholderText('Search books, authors, subjects...');

    fireEvent.change(input, { target: { value: 'quantum' } });

    // Should not fire immediately
    expect(onSearch).not.toHaveBeenCalled();

    // Advance timers by 300ms
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(onSearch).toHaveBeenCalledWith('quantum');
  });

  it('should debounce multiple rapid keystrokes', () => {
    const onSearch = vi.fn();
    render(<ExploreSearchBar onSearch={onSearch} />);
    const input = screen.getByPlaceholderText('Search books, authors, subjects...');

    fireEvent.change(input, { target: { value: 'q' } });
    fireEvent.change(input, { target: { value: 'qu' } });
    fireEvent.change(input, { target: { value: 'qua' } });
    fireEvent.change(input, { target: { value: 'quan' } });
    fireEvent.change(input, { target: { value: 'quant' } });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    // Only the last value should have triggered onSearch
    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(onSearch).toHaveBeenCalledWith('quant');
  });

  it('should call onClear and clear input when clear button clicked', () => {
    const onClear = vi.fn();
    const onChange = vi.fn();
    render(<ExploreSearchBar value='quantum' onChange={onChange} onClear={onClear} />);

    fireEvent.click(screen.getByRole('button', { name: /clear search/i }));

    expect(onClear).toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('should call onSearch immediately with empty string on clear', () => {
    const onSearch = vi.fn();
    render(<ExploreSearchBar value='quantum' onSearch={onSearch} onChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /clear search/i }));

    // onSearch should fire immediately (no debounce) with empty string
    expect(onSearch).toHaveBeenCalledWith('');
  });

  it('should display results count when provided', () => {
    render(<ExploreSearchBar value='quantum' resultsCount={23} onChange={vi.fn()} />);
    expect(screen.getByText(/23 results/)).toBeTruthy();
  });

  it('should display stale indicator when isStale is true', () => {
    render(<ExploreSearchBar value='quantum' resultsCount={23} isStale onChange={vi.fn()} />);
    expect(screen.getByText(/\.\.\. results/)).toBeTruthy();
  });

  it('should dim results count when isStale is true', () => {
    render(<ExploreSearchBar value='quantum' resultsCount={23} isStale onChange={vi.fn()} />);
    const resultsEl = screen.getByText(/\.\.\. results/);
    expect(resultsEl.className).toContain('opacity-50');
  });

  it('should not display results count when input is empty', () => {
    render(<ExploreSearchBar resultsCount={23} />);
    expect(screen.queryByText(/results/)).toBeNull();
  });

  it('should have 16px font size class to prevent iOS zoom', () => {
    render(<ExploreSearchBar />);
    const input = screen.getByPlaceholderText('Search books, authors, subjects...');
    expect(input.className).toContain('text-base');
  });

  it('should accept custom placeholder', () => {
    render(<ExploreSearchBar placeholder='Find something...' />);
    expect(screen.getByPlaceholderText('Find something...')).toBeTruthy();
  });

  it('should have accessible clear button with aria-label', () => {
    render(<ExploreSearchBar value='test' onChange={vi.fn()} />);
    const clearBtn = screen.getByRole('button', { name: /clear search/i });
    expect(clearBtn.getAttribute('aria-label')).toBe('Clear search');
  });

  it('should have input type="text"', () => {
    render(<ExploreSearchBar />);
    const input = screen.getByPlaceholderText('Search books, authors, subjects...');
    expect(input.getAttribute('type')).toBe('text');
  });

  it('should accept className prop for external layout control', () => {
    const { container } = render(<ExploreSearchBar className='mx-auto mt-4' />);
    const outerDiv = container.firstElementChild as HTMLElement;
    expect(outerDiv.className).toContain('mt-4');
    expect(outerDiv.className).toContain('mx-auto');
  });

  it('should use custom debounceMs value', () => {
    const onSearch = vi.fn();
    render(<ExploreSearchBar onSearch={onSearch} debounceMs={500} />);
    const input = screen.getByPlaceholderText('Search books, authors, subjects...');

    fireEvent.change(input, { target: { value: 'test' } });

    // Should not fire at 300ms
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(onSearch).not.toHaveBeenCalled();

    // Should fire at 500ms
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onSearch).toHaveBeenCalledWith('test');
  });

  it('should work in uncontrolled mode (no value prop)', () => {
    const onSearch = vi.fn();
    render(<ExploreSearchBar onSearch={onSearch} />);
    const input = screen.getByPlaceholderText(
      'Search books, authors, subjects...',
    ) as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'hello' } });
    expect(input.value).toBe('hello');

    // Clear button should appear
    expect(screen.getByRole('button', { name: /clear search/i })).toBeTruthy();

    // Clear should reset internal value
    fireEvent.click(screen.getByRole('button', { name: /clear search/i }));
    expect(input.value).toBe('');
  });
});
