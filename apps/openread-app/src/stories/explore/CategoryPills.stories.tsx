import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { V2Wrapper } from '../V2Decorator';
import { CategoryPills } from '@/components/explore/CategoryPills';

// --- Interactive wrapper to show callbacks in action ---

function InteractivePills({ sticky }: { sticky?: boolean }) {
  const [lastSubjects, setLastSubjects] = useState<string[] | undefined>(undefined);

  return (
    <div className='space-y-4'>
      <CategoryPills onCategoryChange={(subjects) => setLastSubjects(subjects)} sticky={sticky} />
      <div className='rounded-md border border-[#D6D3CB] bg-white p-3 text-xs text-[#6B6963]'>
        <p className='font-medium text-[#1C1C1A]'>onCategoryChange output:</p>
        <pre className='mt-1 overflow-x-auto'>
          {lastSubjects ? JSON.stringify(lastSubjects, null, 2) : 'undefined (All selected)'}
        </pre>
      </div>
    </div>
  );
}

// --- Meta ---

const meta: Meta<typeof CategoryPills> = {
  title: 'V2/Explore/CategoryPills',
  component: CategoryPills,
  decorators: [
    (Story) => (
      <V2Wrapper>
        <Story />
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

/** Default state: "All" pill is active, no subcategory row visible */
export const Default: Story = {
  render: () => <InteractivePills />,
};

/** A top-level category (Science) is selected, showing its subcategory row */
export const CategorySelected: Story = {
  render: () => {
    // We use an interactive wrapper that pre-clicks Science
    const PreSelected = () => {
      const [subjects, setSubjects] = useState<string[] | undefined>(undefined);
      return (
        <div className='space-y-4'>
          <p className='text-xs text-[#6B6963]'>
            Click &quot;Science&quot; to see subcategories. The component is fully interactive.
          </p>
          <CategoryPills onCategoryChange={setSubjects} />
          <div className='rounded-md border border-[#D6D3CB] bg-white p-3 text-xs text-[#6B6963]'>
            <p className='font-medium text-[#1C1C1A]'>Selected subjects:</p>
            <pre className='mt-1'>{subjects ? JSON.stringify(subjects, null, 2) : 'All'}</pre>
          </div>
        </div>
      );
    };
    return <PreSelected />;
  },
};

/** Subcategory selected: Shows both parent category and subcategory highlighted */
export const SubcategorySelected: Story = {
  render: () => {
    const SubSelected = () => {
      const [subjects, setSubjects] = useState<string[] | undefined>(undefined);
      return (
        <div className='space-y-4'>
          <p className='text-xs text-[#6B6963]'>
            Click &quot;Computer Science&quot; then &quot;Python&quot; to see subcategory selection.
          </p>
          <CategoryPills onCategoryChange={setSubjects} />
          <div className='rounded-md border border-[#D6D3CB] bg-white p-3 text-xs text-[#6B6963]'>
            <p className='font-medium text-[#1C1C1A]'>Selected subjects:</p>
            <pre className='mt-1'>{subjects ? JSON.stringify(subjects, null, 2) : 'All'}</pre>
          </div>
        </div>
      );
    };
    return <SubSelected />;
  },
};

/** Expanded: All categories visible (simulates clicking "+N more") */
export const Expanded: Story = {
  render: () => {
    return (
      <div className='space-y-2'>
        <p className='text-xs text-[#6B6963]'>
          Click the &quot;+N more&quot; pill to expand all categories. The button disappears after
          expansion.
        </p>
        <CategoryPills />
      </div>
    );
  },
};

/** Dark mode: Same component rendered in dark theme wrapper */
export const DarkMode: Story = {
  decorators: [
    (Story) => (
      <V2Wrapper dark>
        <Story />
      </V2Wrapper>
    ),
  ],
  render: () => (
    <div className='space-y-2'>
      <p className='text-xs text-[#9B9890]'>Dark mode rendering of CategoryPills.</p>
      <CategoryPills />
    </div>
  ),
};
