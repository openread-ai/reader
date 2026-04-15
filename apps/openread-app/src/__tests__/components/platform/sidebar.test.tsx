import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React, { forwardRef } from 'react';
import { Sidebar } from '@/components/platform/sidebar';
import { SidebarNav } from '@/components/platform/sidebar-nav';
import { SidebarSection } from '@/components/platform/sidebar-section';

// Mock next/navigation
const mockPathname = vi.fn(() => '/home');
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

// Mock useTranslation
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

// Mock AuthContext for ProfileMenu
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: {
      id: 'user-123',
      email: 'test@example.com',
      user_metadata: { display_name: 'Test User' },
    },
    token: 'mock-token',
    logout: vi.fn(),
    login: vi.fn(),
    refresh: vi.fn(),
  }),
}));

// Mock navigateToLogin
vi.mock('@/utils/nav', () => ({
  navigateToLogin: vi.fn(),
}));

// Mock EnvContext — Sidebar calls useEnv() for appService
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    appService: null,
    envConfig: {},
  }),
}));

// Mock useCollections — Sidebar uses it for collection CRUD.
// Reads from mockStore.collections so tests can modify it.
vi.mock('@/hooks/useCollections', () => ({
  useCollections: () => ({
    get collections() {
      return mockStore.collections;
    },
    createCollection: vi.fn(),
    deleteCollection: vi.fn(),
    renameCollection: vi.fn(),
  }),
}));

// Mock CreateCollectionDialog to avoid rendering the full dialog
vi.mock('@/components/platform/create-collection-dialog', () => ({
  CreateCollectionDialog: () => null,
}));

// Mock the platformSidebarStore
const mockStore = {
  librarySectionOpen: true,
  collectionsSectionOpen: true,
  collections: [
    { id: '1', name: 'Fiction', bookHashes: ['a', 'b', 'c', 'd', 'e'], createdAt: '2024-01-01' },
    { id: '2', name: 'Technical', bookHashes: Array(10).fill('x'), createdAt: '2024-01-02' },
  ],
  toggleLibrarySection: vi.fn(),
  toggleCollectionsSection: vi.fn(),
  addCollection: vi.fn(() => ({ id: 'new-1', name: 'New', bookHashes: [], createdAt: Date.now() })),
  removeCollection: vi.fn(),
  renameCollection: vi.fn(),
  addBookToCollection: vi.fn(),
};

vi.mock('@/store/platformSidebarStore', () => ({
  usePlatformSidebarStore: (selector: (state: typeof mockStore) => unknown) => selector(mockStore),
}));

describe('Sidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPathname.mockReturnValue('/home');
    mockStore.librarySectionOpen = true;
    mockStore.collectionsSectionOpen = true;
    mockStore.collections = [
      { id: '1', name: 'Fiction', bookHashes: ['a', 'b', 'c', 'd', 'e'], createdAt: '2024-01-01' },
      { id: '2', name: 'Technical', bookHashes: Array(10).fill('x'), createdAt: '2024-01-02' },
    ];
  });

  afterEach(() => {
    cleanup();
  });

  describe('Rendering', () => {
    it('should render the OpenRead logo and link', () => {
      render(<Sidebar />);
      expect(screen.getByText('OpenRead')).toBeTruthy();
      expect(screen.getByRole('link', { name: /openread/i }).getAttribute('href')).toBe('/home');
    });

    it('should render Home link', () => {
      render(<Sidebar />);
      expect(screen.getByRole('link', { name: /home/i })).toBeTruthy();
      expect(screen.getByRole('link', { name: /home/i }).getAttribute('href')).toBe('/home');
    });

    it('should render Library section with all filter links', () => {
      render(<Sidebar />);
      expect(screen.getByText('Library')).toBeTruthy();
      // Use getAllByRole since "All" appears in both Library and Collections sections
      const allLinks = screen.getAllByRole('link', { name: /^all$/i });
      expect(allLinks.length).toBeGreaterThanOrEqual(1);
      expect(allLinks[0].getAttribute('href')).toBe('/library');
      expect(screen.getByRole('link', { name: /want to read/i })).toBeTruthy();
      expect(screen.getByRole('link', { name: /finished/i })).toBeTruthy();
      expect(screen.getByRole('link', { name: /^books$/i })).toBeTruthy();
      expect(screen.getByRole('link', { name: /pdfs/i })).toBeTruthy();
    });

    it('should render Collections section with user collections', () => {
      render(<Sidebar />);
      expect(screen.getByText('Collections')).toBeTruthy();
      expect(screen.getByRole('link', { name: /fiction/i })).toBeTruthy();
      expect(screen.getByRole('link', { name: /technical/i })).toBeTruthy();
    });

    it('should render New Collection button', () => {
      render(<Sidebar />);
      expect(screen.getByRole('button', { name: /new collection/i })).toBeTruthy();
    });

    it('should render profile menu placeholder', () => {
      render(<Sidebar />);
      expect(screen.getByRole('button', { name: /profile menu/i })).toBeTruthy();
    });

    it('should show empty collections message when no collections exist', () => {
      mockStore.collections = [];
      render(<Sidebar />);
      expect(screen.getByText('No collections yet')).toBeTruthy();
    });
  });

  describe('Active Route Highlighting', () => {
    it('should highlight Home link when on home route', () => {
      mockPathname.mockReturnValue('/home');
      render(<Sidebar />);
      const homeLink = screen.getByRole('link', { name: /home/i });
      expect(homeLink.className).toContain('bg-base-300');
    });

    it('should highlight Library > All link when on library route', () => {
      mockPathname.mockReturnValue('/library');
      render(<Sidebar />);
      // First "All" link is the Library one (/library), second is Collections (/collections)
      const allLinks = screen.getAllByRole('link', { name: /^all$/i });
      const libraryAllLink = allLinks.find((link) => link.getAttribute('href') === '/library');
      expect(libraryAllLink).toBeTruthy();
      expect(libraryAllLink!.className).toContain('bg-base-300');
    });

    it('should highlight appropriate library filter when on sub-route', () => {
      mockPathname.mockReturnValue('/library/want-to-read');
      render(<Sidebar />);
      const wantToReadLink = screen.getByRole('link', { name: /want to read/i });
      expect(wantToReadLink.className).toContain('bg-base-300');
    });

    it('should highlight collection when on collection route', () => {
      mockStore.collections = [
        {
          id: '1',
          name: 'Fiction',
          bookHashes: ['a', 'b', 'c', 'd', 'e'],
          createdAt: '2024-01-01',
        },
      ];
      mockPathname.mockReturnValue('/collections/1');
      render(<Sidebar />);
      const fictionLink = screen.getByRole('link', { name: /fiction/i });
      expect(fictionLink.className).toContain('bg-base-300');
    });
  });

  describe('Section Collapse/Expand', () => {
    it('should call toggleLibrarySection when Library header is clicked', () => {
      render(<Sidebar />);
      const libraryHeader = screen.getByRole('button', { name: /library/i });
      fireEvent.click(libraryHeader);
      expect(mockStore.toggleLibrarySection).toHaveBeenCalled();
    });

    it('should call toggleCollectionsSection when Collections header is clicked', () => {
      render(<Sidebar />);
      const collectionsHeader = screen.getByRole('button', { name: /collections/i });
      fireEvent.click(collectionsHeader);
      expect(mockStore.toggleCollectionsSection).toHaveBeenCalled();
    });

    it('should hide library links when section is collapsed', () => {
      mockStore.librarySectionOpen = false;
      render(<Sidebar />);
      // When library section is collapsed, the Library "All" link (/library) should be hidden
      // but the Collections "All" link (/collections) may still be visible
      const allLinks = screen.queryAllByRole('link', { name: /^all$/i });
      const libraryAllLink = allLinks.find((link) => link.getAttribute('href') === '/library');
      expect(libraryAllLink).toBeUndefined();
    });

    it('should hide collection links when section is collapsed', () => {
      mockStore.collectionsSectionOpen = false;
      render(<Sidebar />);
      expect(screen.queryByRole('link', { name: /fiction/i })).toBeNull();
    });
  });

  describe('Navigation', () => {
    it('should call onNavigate when a link is clicked', () => {
      const onNavigate = vi.fn();
      render(<Sidebar onNavigate={onNavigate} />);
      const homeLink = screen.getByRole('link', { name: /home/i });
      fireEvent.click(homeLink);
      expect(onNavigate).toHaveBeenCalled();
    });
  });
});

describe('SidebarNav', () => {
  // Create a proper forwardRef mock icon component for lucide-react compatibility
  const MockIcon = forwardRef<SVGSVGElement>((props, ref) => (
    <svg data-testid='mock-icon' ref={ref} {...props} />
  ));
  MockIcon.displayName = 'MockIcon';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('should render link with correct href', () => {
    render(<SidebarNav href='/test' icon={MockIcon} label='Test Link' />);
    expect(screen.getByRole('link').getAttribute('href')).toBe('/test');
  });

  it('should render icon and label', () => {
    render(<SidebarNav href='/test' icon={MockIcon} label='Test Link' />);
    expect(screen.getByTestId('mock-icon')).toBeTruthy();
    expect(screen.getByText('Test Link')).toBeTruthy();
  });

  it('should apply active styles when active prop is true', () => {
    render(<SidebarNav href='/test' icon={MockIcon} label='Test Link' active />);
    expect(screen.getByRole('link').className).toContain('bg-base-300');
  });

  it('should apply inactive styles when active prop is false', () => {
    render(<SidebarNav href='/test' icon={MockIcon} label='Test Link' active={false} />);
    expect(screen.getByRole('link').className).toContain('text-base-content/70');
  });

  it('should call onClick when clicked', () => {
    const onClick = vi.fn();
    render(<SidebarNav href='/test' icon={MockIcon} label='Test Link' onClick={onClick} />);
    fireEvent.click(screen.getByRole('link'));
    expect(onClick).toHaveBeenCalled();
  });
});

describe('SidebarSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('should render title', () => {
    render(
      <SidebarSection title='Test Section' isOpen onToggle={() => {}}>
        <div>Content</div>
      </SidebarSection>,
    );
    expect(screen.getByText('Test Section')).toBeTruthy();
  });

  it('should render children when open', () => {
    render(
      <SidebarSection title='Test Section' isOpen onToggle={() => {}}>
        <div>Content</div>
      </SidebarSection>,
    );
    expect(screen.getByText('Content')).toBeTruthy();
  });

  it('should not render children when closed', () => {
    render(
      <SidebarSection title='Test Section' isOpen={false} onToggle={() => {}}>
        <div>Content</div>
      </SidebarSection>,
    );
    expect(screen.queryByText('Content')).toBeNull();
  });

  it('should call onToggle when header is clicked', () => {
    const onToggle = vi.fn();
    render(
      <SidebarSection title='Test Section' isOpen onToggle={onToggle}>
        <div>Content</div>
      </SidebarSection>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onToggle).toHaveBeenCalled();
  });

  it('should support keyboard navigation (Enter key)', () => {
    const onToggle = vi.fn();
    render(
      <SidebarSection title='Test Section' isOpen onToggle={onToggle}>
        <div>Content</div>
      </SidebarSection>,
    );
    fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' });
    expect(onToggle).toHaveBeenCalled();
  });

  it('should support keyboard navigation (Space key)', () => {
    const onToggle = vi.fn();
    render(
      <SidebarSection title='Test Section' isOpen onToggle={onToggle}>
        <div>Content</div>
      </SidebarSection>,
    );
    fireEvent.keyDown(screen.getByRole('button'), { key: ' ' });
    expect(onToggle).toHaveBeenCalled();
  });

  it('should have correct aria-expanded attribute', () => {
    const { rerender } = render(
      <SidebarSection title='Test Section' isOpen onToggle={() => {}}>
        <div>Content</div>
      </SidebarSection>,
    );
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('true');

    rerender(
      <SidebarSection title='Test Section' isOpen={false} onToggle={() => {}}>
        <div>Content</div>
      </SidebarSection>,
    );
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false');
  });

  it('should render action element when provided', () => {
    render(
      <SidebarSection
        title='Test Section'
        isOpen
        onToggle={() => {}}
        action={<button>Action</button>}
      >
        <div>Content</div>
      </SidebarSection>,
    );
    expect(screen.getByRole('button', { name: /action/i })).toBeTruthy();
  });

  it('should rotate chevron icon when collapsed', () => {
    const { container, rerender } = render(
      <SidebarSection title='Test Section' isOpen onToggle={() => {}}>
        <div>Content</div>
      </SidebarSection>,
    );

    const chevron = container.querySelector('svg');
    // When open, chevron should not have -rotate-90 class
    expect(chevron?.classList.contains('-rotate-90')).toBe(false);

    rerender(
      <SidebarSection title='Test Section' isOpen={false} onToggle={() => {}}>
        <div>Content</div>
      </SidebarSection>,
    );
    // When collapsed, chevron should have -rotate-90 class
    expect(container.querySelector('svg')?.classList.contains('-rotate-90')).toBe(true);
  });
});
