import type { Meta, StoryObj } from '@storybook/react-vite'
import { Avatar } from './Avatar'

const meta = {
  title: 'Atoms/Avatar',
  component: Avatar,
  args: { initials: 'MV', size: 'md' },
  argTypes: {
    initials: { control: 'text' },
    label: { control: 'text' },
    size: { control: 'inline-radio', options: ['sm', 'md'] },
  },
} satisfies Meta<typeof Avatar>

export default meta

type Story = StoryObj<typeof meta>

export const Sender: Story = {}

export const Profile: Story = {
  args: { initials: 'WS', label: 'Profile Wesley Smits', size: 'sm' },
}
