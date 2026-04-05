import type { Meta, StoryObj } from '@storybook/react';
import { V2Wrapper } from '../V2Decorator';
import { BookDetailSheet } from '@/components/explore/BookDetailSheet';
import type { CatalogBookDetail } from '@/components/explore/BookDetailSheet';

// --- Mock Data ---

const mockBook: CatalogBookDetail = {
  id: 'test-uuid-1234-abcd-5678',
  title: 'Think Python',
  author_name: 'Allen B. Downey',
  language: 'en',
  format_type: 'epub',
  cover_image_key: 'covers/think-python',
  cover_is_generated: false,
  is_cached: true,
  import_count: 42,
  page_count: 292,
  file_size_bytes: 5200000,
  description:
    'Think Python is an introduction to Python programming for beginners. It starts with basic concepts of programming, and is carefully designed to define all terms when they are first used and to develop each new concept in a logical progression. Larger pieces, like recursion and object-oriented programming, are divided into a sequence of smaller steps and introduced over the course of several chapters.',
  license_type: 'cc-by-nc-4.0',
  publication_year: 2015,
  subjects: ['Computer Science', 'Python', 'Programming'],
  source: 'greenteapress',
};

const mockIABook: CatalogBookDetail = {
  ...mockBook,
  id: 'ia-book-uuid-1234',
  title: 'The Art of War',
  author_name: 'Sun Tzu',
  cover_image_key: null,
  cover_is_generated: false,
  source: 'internet-archive',
  source_id: 'artofwar00suntuoft',
  ia_identifier: 'artofwar00suntuoft',
  description:
    'The Art of War is an ancient Chinese military treatise dating from the Late Spring and Autumn Period. The work, which is attributed to the ancient Chinese military strategist Sun Tzu, is composed of 13 chapters. Each one is devoted to a different set of skills or art related to warfare and how it applies to military strategy and tactics.',
  license_type: 'public_domain',
  page_count: 128,
};

const mockNoDescription: CatalogBookDetail = {
  ...mockBook,
  id: 'no-desc-uuid',
  title: 'Calculus Made Easy',
  author_name: 'Silvanus P. Thompson',
  description: undefined,
  license_type: 'public_domain',
  page_count: null,
  source: 'gutenberg',
};

// --- Meta ---

const meta: Meta<typeof BookDetailSheet> = {
  title: 'V2/Explore/BookDetailSheet',
  component: BookDetailSheet,
  decorators: [
    (Story) => (
      <V2Wrapper>
        <div className='min-h-[600px]'>
          <Story />
        </div>
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
  args: {
    book: mockBook,
    isOpen: true,
    onClose: () => {},
    isWishlisted: false,
    importState: 'idle',
  },
};

export const IABook: Story = {
  args: {
    book: mockIABook,
    isOpen: true,
    onClose: () => {},
    isWishlisted: false,
    importState: 'idle',
  },
};

export const NoDescription: Story = {
  args: {
    book: mockNoDescription,
    isOpen: true,
    onClose: () => {},
    importState: 'idle',
  },
};

export const InLibrary: Story = {
  args: {
    book: mockBook,
    isOpen: true,
    onClose: () => {},
    importState: 'ready',
  },
};

export const Importing: Story = {
  args: {
    book: mockBook,
    isOpen: true,
    onClose: () => {},
    importState: 'importing',
    importProgress: 65,
  },
};

export const Mobile: Story = {
  parameters: {
    viewport: {
      defaultViewport: 'mobile1',
    },
  },
  args: {
    book: mockBook,
    isOpen: true,
    onClose: () => {},
    importState: 'idle',
  },
};

export const DarkMode: Story = {
  decorators: [
    (Story) => (
      <V2Wrapper dark>
        <div className='min-h-[600px]'>
          <Story />
        </div>
      </V2Wrapper>
    ),
  ],
  args: {
    book: mockBook,
    isOpen: true,
    onClose: () => {},
    importState: 'idle',
  },
};
