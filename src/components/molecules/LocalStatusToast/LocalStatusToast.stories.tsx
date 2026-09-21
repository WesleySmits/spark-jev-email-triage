import type { Meta, StoryObj } from '@storybook/react-vite'
import { useRef, useState, type ComponentProps } from 'react'
import { fn } from 'storybook/test'
import { Button } from '../../atoms/Button/Button'
import { LocalStatusToast } from './LocalStatusToast'

const meta = {
  title: 'Molecules/Local status toast',
  component: LocalStatusToast,
  args: {
    visible: true,
    title: 'Handled locally',
    detail: 'Mailbox unchanged.',
    actionLabel: 'Undo',
    dismissLabel: 'Dismiss',
    onAction: fn(),
    onDismiss: fn(),
  },
  argTypes: {
    visible: { control: 'boolean' },
    title: { control: 'text' },
    detail: { control: 'text' },
    actionLabel: { control: 'text' },
    dismissLabel: { control: 'text' },
  },
  // The toast is fixed to the viewport. The transform makes this frame its
  // containing block, so each story stays in place on the docs page.
  decorators: [
    (Story) => (
      <div style={{ minHeight: 320, transform: 'translateZ(0)' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof LocalStatusToast>

export default meta

type Story = StoryObj<typeof meta>

/** Completion feedback with undo, as in the source. */
export const Completed: Story = {}

/** No undo: the action is left out and only dismiss remains. */
export const WithoutAction: Story = {
  args: {
    title: 'Change undone',
    detail: 'The previous local status is restored.',
    actionLabel: undefined,
  },
}

export const LongCopy: Story = {
  args: {
    title: '12 results handled locally in Needs review for all three mailboxes',
    detail:
      'Only the selection from the current filter · mailbox unchanged. Nothing is sent to Spark until you open the message there.',
  },
}

/** Hidden, only an empty status region remains, ready to announce the next message. */
export const Hidden: Story = { args: { visible: false } }

/** Below 600px the toast spans the viewport with a 12px inset; long copy wraps. */
export const Narrow: Story = {
  ...LongCopy,
  globals: { viewport: { value: 'mobile1', isRotated: false } },
}

type Props = ComponentProps<typeof LocalStatusToast>
type Message = Pick<Props, 'title' | 'detail' | 'actionLabel'>

const messages: readonly Message[] = [
  { title: 'Handled locally', detail: 'Mailbox unchanged.', actionLabel: 'Undo' },
  {
    title: 'Review saved',
    detail: 'Category set to Newsletter · not handled yet.',
    actionLabel: 'Undo',
  },
  { title: 'Connection restored', detail: 'Fixture status is updated.', actionLabel: undefined },
]

const hidden: Message = { title: '' }

// The caller owns visibility, copy and focus. Nothing hides on a timer here;
// hiding moves focus back to the button that showed the toast.
function CallerStory(args: Props) {
  const [message, setMessage] = useState<Message | null>(null)
  const shown = useRef(0)
  const trigger = useRef<HTMLButtonElement>(null)

  function showNext() {
    setMessage(messages[shown.current % messages.length] ?? null)
    shown.current += 1
  }

  function hide() {
    setMessage(null)
    trigger.current?.focus()
  }

  return (
    <>
      <Button ref={trigger} variant="secondary" onClick={showNext}>
        Show next status
      </Button>
      <LocalStatusToast
        {...args}
        {...(message ?? hidden)}
        visible={message !== null}
        onAction={() => {
          args.onAction?.()
          hide()
        }}
        onDismiss={() => {
          args.onDismiss()
          hide()
        }}
      />
    </>
  )
}

/**
 * Press the button to show the next status. Each message is announced once.
 * Tab to Undo or Dismiss; Enter, Space or Escape hides the toast and returns
 * focus to the button.
 */
export const CallerControlled: Story = {
  argTypes: {
    visible: { table: { disable: true } },
    title: { table: { disable: true } },
    detail: { table: { disable: true } },
    actionLabel: { table: { disable: true } },
  },
  render: (args) => <CallerStory {...args} />,
}
