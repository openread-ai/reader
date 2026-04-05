import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';
import { V2Wrapper } from '../V2Decorator';
import {
  Button,
  Separator,
  Avatar,
  AvatarImage,
  AvatarFallback,
  ScrollArea,
} from '@/components/v2/ui';
import {
  HomeIcon,
  CompassIcon,
  HeartIcon,
  LibraryIcon,
  BookOpenIcon,
  CheckCircleIcon,
  FileTextIcon,
  FileIcon,
  FolderIcon,
  PlusIcon,
  SettingsIcon,
  ChevronDownIcon,
  ChevronRightIcon,
} from 'lucide-react';

// --- Mock Data ---
const navItems = [
  { icon: HomeIcon, label: 'Home' },
  { icon: CompassIcon, label: 'Explore' },
  { icon: HeartIcon, label: 'Wishlist' },
];

const libraryItems = [
  { icon: LibraryIcon, label: 'All Books', count: 24 },
  { icon: BookOpenIcon, label: 'Want to Read', count: 8 },
  { icon: CheckCircleIcon, label: 'Finished', count: 5 },
  { icon: FileTextIcon, label: 'Books', count: 18 },
  { icon: FileIcon, label: 'PDFs', count: 6 },
];

const collections = [
  { label: 'Design Thinking', count: 4 },
  { label: 'Productivity', count: 7 },
  { label: 'Science Fiction', count: 3 },
];

// --- Inline Components ---

function SidebarShell({ activeItem, collapsed }: { activeItem?: string; collapsed?: boolean }) {
  const [libraryOpen, setLibraryOpen] = React.useState(!collapsed);
  const [collectionsOpen, setCollectionsOpen] = React.useState(!collapsed);

  return (
    <div className='border-border bg-card flex h-[600px] w-[240px] flex-col border-r'>
      {/* Logo */}
      <div className='flex items-center gap-2 px-4 py-5'>
        <div className='bg-primary flex h-7 w-7 items-center justify-center rounded-lg'>
          <BookOpenIcon className='text-primary-foreground h-4 w-4' />
        </div>
        <span className='text-sm font-semibold tracking-tight'>OpenRead</span>
      </div>

      <ScrollArea className='flex-1 px-2'>
        {/* Main nav */}
        <div className='mb-2 space-y-0.5'>
          {navItems.map((item) => (
            <Button
              key={item.label}
              variant='ghost'
              className={`h-8 w-full justify-start gap-2 px-2 text-sm font-normal ${
                activeItem === item.label ? 'bg-accent text-accent-foreground' : ''
              }`}
            >
              <item.icon className='h-4 w-4' />
              {item.label}
            </Button>
          ))}
        </div>

        <Separator className='my-2' />

        {/* Library section */}
        <div className='mb-2'>
          <button
            className='text-muted-foreground hover:text-foreground flex w-full items-center gap-1 px-2 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors'
            onClick={() => setLibraryOpen(!libraryOpen)}
          >
            {libraryOpen ? (
              <ChevronDownIcon className='h-3 w-3' />
            ) : (
              <ChevronRightIcon className='h-3 w-3' />
            )}
            Library
          </button>
          {libraryOpen && (
            <div className='mt-0.5 space-y-0.5'>
              {libraryItems.map((item) => (
                <Button
                  key={item.label}
                  variant='ghost'
                  className={`h-8 w-full justify-start gap-2 px-2 text-sm font-normal ${
                    activeItem === item.label ? 'bg-accent text-accent-foreground' : ''
                  }`}
                >
                  <item.icon className='h-4 w-4' />
                  <span className='flex-1 text-left'>{item.label}</span>
                  <span className='text-muted-foreground text-xs'>{item.count}</span>
                </Button>
              ))}
            </div>
          )}
        </div>

        <Separator className='my-2' />

        {/* Collections section */}
        <div className='mb-2'>
          <button
            className='text-muted-foreground hover:text-foreground flex w-full items-center gap-1 px-2 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors'
            onClick={() => setCollectionsOpen(!collectionsOpen)}
          >
            {collectionsOpen ? (
              <ChevronDownIcon className='h-3 w-3' />
            ) : (
              <ChevronRightIcon className='h-3 w-3' />
            )}
            Collections
          </button>
          {collectionsOpen && (
            <div className='mt-0.5 space-y-0.5'>
              <Button
                variant='ghost'
                className='h-8 w-full justify-start gap-2 px-2 text-sm font-normal'
              >
                <FolderIcon className='h-4 w-4' />
                <span className='flex-1 text-left'>All Collections</span>
              </Button>
              {collections.map((col) => (
                <Button
                  key={col.label}
                  variant='ghost'
                  className='h-8 w-full justify-start gap-2 px-2 text-sm font-normal'
                >
                  <FolderIcon className='h-4 w-4' />
                  <span className='flex-1 text-left'>{col.label}</span>
                  <span className='text-muted-foreground text-xs'>{col.count}</span>
                </Button>
              ))}
              <Button
                variant='ghost'
                className='text-muted-foreground h-8 w-full justify-start gap-2 px-2 text-sm font-normal'
              >
                <PlusIcon className='h-4 w-4' />
                New Collection
              </Button>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Profile area */}
      <Separator />
      <div className='flex items-center gap-2 p-3'>
        <Avatar className='h-7 w-7'>
          <AvatarImage src='' alt='User' />
          <AvatarFallback className='text-xs'>TJ</AvatarFallback>
        </Avatar>
        <div className='min-w-0 flex-1'>
          <p className='truncate text-sm font-medium'>Tarun Joy</p>
        </div>
        <Button variant='ghost' size='icon' className='h-7 w-7'>
          <SettingsIcon className='h-3.5 w-3.5' />
        </Button>
      </div>
    </div>
  );
}

// --- Meta ---

const meta: Meta<typeof SidebarShell> = {
  title: 'V2/Platform/Sidebar',
  component: SidebarShell,
  decorators: [
    (Story) => (
      <V2Wrapper>
        <Story />
      </V2Wrapper>
    ),
  ],
  parameters: {
    layout: 'fullscreen',
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

// --- Stories ---

export const Default: Story = {
  render: () => <SidebarShell />,
};

export const ActiveLibrary: Story = {
  render: () => <SidebarShell activeItem='All Books' />,
};

export const Collapsed: Story = {
  render: () => <SidebarShell collapsed />,
};

export const ActiveExplore: Story = {
  render: () => <SidebarShell activeItem='Explore' />,
};

export const DarkMode: Story = {
  decorators: [
    (Story) => (
      <V2Wrapper dark>
        <Story />
      </V2Wrapper>
    ),
  ],
  render: () => <SidebarShell activeItem='All Books' />,
};
