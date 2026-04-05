import type { Meta, StoryObj } from '@storybook/react';
import { V2Wrapper } from '../V2Decorator';
import { ExploreBookCard } from '@/components/explore/ExploreBookCard';
import type { CatalogBook } from '@/types/catalog';

// --- Mock Data ---

const mockBook: CatalogBook = {
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
};

const mockBookNoCover: CatalogBook = {
  ...mockBook,
  id: 'no-cover-book-uuid',
  title: 'Introduction to Algorithms',
  author_name: 'Thomas H. Cormen',
  cover_image_key: null,
  cover_is_generated: false,
};

const mockBookLongTitle: CatalogBook = {
  ...mockBook,
  id: 'long-title-book-uuid',
  title:
    'A Comprehensive Introduction to the Theory and Practice of Modern Distributed Systems Architecture',
  author_name: 'Dr. Alexandra Konstantinidou-Papadopoulos',
};

const mockBookIA: CatalogBook = {
  ...mockBook,
  id: 'ia-book-uuid-1234',
  title: 'The Art of War',
  author_name: 'Sun Tzu',
  cover_image_key: null,
  cover_is_generated: false,
};

// --- Meta ---

const meta: Meta<typeof ExploreBookCard> = {
  title: 'V2/Explore/ExploreBookCard',
  component: ExploreBookCard,
  decorators: [
    (Story) => (
      <V2Wrapper>
        <div className='w-[180px]'>
          <Story />
        </div>
      </V2Wrapper>
    ),
  ],
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

// --- Stories ---

export const Default: Story = {
  args: {
    book: mockBook,
  },
};

export const InLibrary: Story = {
  args: {
    book: mockBook,
    state: 'in-library',
  },
};

export const Importing: Story = {
  args: {
    book: mockBook,
    state: 'importing',
    importProgress: 60,
  },
};

export const ImportProgress: Story = {
  args: {
    book: mockBook,
    state: 'importing',
    importProgress: 0,
  },
};

export const Wishlisted: Story = {
  args: {
    book: mockBook,
    isWishlisted: true,
  },
};

export const IAResult: Story = {
  args: {
    book: mockBookIA,
    isIA: true,
  },
};

export const NoImage: Story = {
  args: {
    book: mockBookNoCover,
  },
};

export const LongTitle: Story = {
  args: {
    book: mockBookLongTitle,
  },
};

export const DarkMode: Story = {
  decorators: [
    (Story) => (
      <V2Wrapper dark>
        <div className='w-[180px]'>
          <Story />
        </div>
      </V2Wrapper>
    ),
  ],
  args: {
    book: mockBook,
  },
};
