import type { Meta, StoryObj } from '@storybook/react';
import { fn } from '@storybook/test';
import { ExploreSearchBar } from '@/components/explore/ExploreSearchBar';
import { V2Wrapper } from '../V2Decorator';

const meta: Meta<typeof ExploreSearchBar> = {
  title: 'V2/Explore/ExploreSearchBar',
  component: ExploreSearchBar,
  decorators: [
    (Story) => (
      <V2Wrapper>
        <div className='w-full max-w-[600px]'>
          <Story />
        </div>
      </V2Wrapper>
    ),
  ],
  parameters: {
    layout: 'centered',
  },
  args: {
    onSearch: fn(),
    onClear: fn(),
    onChange: fn(),
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

/** Default empty state with placeholder text */
export const Empty: Story = {};

/** Pre-filled with a search query, showing clear button */
export const WithQuery: Story = {
  args: {
    value: 'quantum physics',
  },
};

/** Focused state -- click into the input to see the ring */
export const Focused: Story = {
  parameters: {
    pseudo: { focus: true },
  },
};

/** With results count displayed below the bar */
export const WithResultsCount: Story = {
  args: {
    value: 'quantum physics',
    resultsCount: 23,
  },
};

/** Dark mode variant */
export const DarkMode: Story = {
  decorators: [
    (Story) => (
      <V2Wrapper dark>
        <div className='w-full max-w-[600px]'>
          <Story />
        </div>
      </V2Wrapper>
    ),
  ],
  args: {
    value: 'quantum physics',
    resultsCount: 23,
  },
};
