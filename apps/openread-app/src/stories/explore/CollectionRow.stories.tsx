import type { Meta, StoryObj } from '@storybook/react';
import { Flame, BookOpen, Star, TrendingUp } from 'lucide-react';
import { V2Wrapper } from '../V2Decorator';
import { CollectionRow } from '@/components/explore/CollectionRow';
import type { CatalogBook } from '@/types/catalog';

// --- Mock Data ---

function makeMockBook(index: number): CatalogBook {
  const titles = [
    'Think Python',
    'Introduction to Algorithms',
    'Clean Code',
    'Design Patterns',
    'The Pragmatic Programmer',
    'Structure and Interpretation',
    'Artificial Intelligence',
    'Database Systems',
    'Operating Systems',
    'Computer Networks',
  ];
  const authors = [
    'Allen B. Downey',
    'Thomas H. Cormen',
    'Robert C. Martin',
    'Gang of Four',
    'David Thomas',
    'Harold Abelson',
    'Stuart Russell',
    'Raghu Ramakrishnan',
    'Andrew Tanenbaum',
    'James Kurose',
  ];
  return {
    id: `mock-book-${index}`,
    title: titles[index % titles.length]!,
    author_name: authors[index % authors.length]!,
    language: 'en',
    format_type: 'epub',
    cover_image_key: index % 3 === 0 ? null : `covers/book-${index}`,
    cover_is_generated: false,
    is_cached: true,
    import_count: Math.floor(Math.random() * 100),
    page_count: 200 + index * 30,
    file_size_bytes: 3000000 + index * 500000,
  };
}

const eightBooks: CatalogBook[] = Array.from({ length: 8 }, (_, i) => makeMockBook(i));
const threeBooks: CatalogBook[] = Array.from({ length: 3 }, (_, i) => makeMockBook(i));

// --- Meta ---

const meta: Meta<typeof CollectionRow> = {
  title: 'V2/Explore/CollectionRow',
  component: CollectionRow,
  decorators: [
    (Story) => (
      <V2Wrapper>
        <div className='max-w-3xl'>
          <Story />
        </div>
      </V2Wrapper>
    ),
  ],
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

// --- Stories ---

export const Default: Story = {
  args: {
    title: 'Trending This Week',
    icon: <TrendingUp className='h-[18px] w-[18px]' />,
    books: eightBooks,
  },
};

export const Loading: Story = {
  args: {
    title: 'Popular in Science',
    icon: <Flame className='h-[18px] w-[18px]' />,
    books: [],
    isLoading: true,
  },
};

export const Empty: Story = {
  args: {
    title: 'Your Recommendations',
    icon: <Star className='h-[18px] w-[18px]' />,
    books: [],
  },
};

export const FewBooks: Story = {
  args: {
    title: 'Recently Added',
    icon: <BookOpen className='h-[18px] w-[18px]' />,
    books: threeBooks,
  },
};

export const WithSeeAll: Story = {
  args: {
    title: 'Computer Science',
    icon: <TrendingUp className='h-[18px] w-[18px]' />,
    books: eightBooks,
    seeAllHref: '/explore/collection/computer-science',
  },
};

export const DarkMode: Story = {
  decorators: [
    (Story) => (
      <V2Wrapper dark>
        <div className='max-w-3xl'>
          <Story />
        </div>
      </V2Wrapper>
    ),
  ],
  args: {
    title: 'Featured Collection',
    icon: <Star className='h-[18px] w-[18px]' />,
    books: eightBooks,
    seeAllHref: '/explore/collection/featured',
  },
};
