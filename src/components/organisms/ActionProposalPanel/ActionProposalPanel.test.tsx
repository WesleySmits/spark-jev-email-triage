import type * as React from 'react'
import type { ReactElement, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Badge } from '../../atoms/Badge/Badge'
import { Button } from '../../atoms/Button/Button'
import { ActionProposalPanel } from './ActionProposalPanel'

// The panel calls only useId. Replacing it lets the test call the component
// as a plain function and walk the elements it returns. Keyboard, focus and
// rendering are checked in Storybook.
let nextId = 0
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof React>()),
  useId: () => `id${String(nextId++)}`,
}))

type Element = ReactElement<Record<string, unknown>>
type Props = Parameters<typeof ActionProposalPanel>[0]

const leaves = new Set<unknown>([Badge, Button])

function flatten(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap((child: ReactNode) => flatten(child))
  if (!node || typeof node !== 'object' || !('props' in node)) return []
  const element = node as Element
  if (typeof element.type === 'function' && !leaves.has(element.type)) {
    const component = element.type as (props: unknown) => ReactNode
    return flatten(component(element.props))
  }
  return [element, ...flatten(element.props['children'] as ReactNode)]
}

const rendered = (props: Props) => flatten(ActionProposalPanel(props))

const withClass = (elements: Element[], name: string) =>
  elements.filter((element) => element.props['className'] === name)

const base: Props = {
  title: 'Mailbox action',
  summary: 'Proposed here, approved by you, and never carried out.',
  stages: [
    {
      id: 'proposal',
      name: 'Proposal',
      state: { label: 'Proposed', tone: 'review' },
      detail: 'Archive, against the 1 mailbox copy named below.',
    },
    {
      id: 'approval',
      name: 'Approval',
      state: { label: 'Waiting for you', tone: 'review' },
      detail: 'Approving records your decision here.',
    },
    {
      id: 'execution',
      name: 'Execution',
      state: { label: 'Blocked', tone: 'neutral' },
      detail: 'This app has no way to write to a mailbox.',
    },
  ],
  targetsTitle: 'Mailbox copies named',
  targets: [
    {
      id: 'c1',
      label: 'Studio Noord',
      identity: 'studio@mail.example · message 11',
      detail: 'Proposed against thread t-11, latest message 11.',
    },
  ],
  targetsNote: 'Only the copies named here would be acted on.',
  targetsEmpty: 'Nothing is proposed, so no mailbox copy is named.',
  effect: {
    title: 'What it would change',
    statement: 'It would ask a mail provider to archive the copy named above, and nothing else.',
    note: 'What a provider does when asked that is not verified here. Your mailbox is unchanged.',
  },
  preconditionsTitle: 'Before anything could run',
  preconditions: [
    {
      id: 'human_approval',
      label: 'A person approved this exact proposal',
      state: { label: 'Not met', tone: 'neutral' },
    },
    {
      id: 'write_adapter_connected',
      label: 'Something could carry the action out',
      state: { label: 'Not connected', tone: 'neutral' },
    },
  ],
  actions: [{ id: 'approve', label: 'Approve', onClick: vi.fn() }],
  result: { title: 'Not approved', detail: 'Your mailbox is unchanged.' },
}

describe('ActionProposalPanel', () => {
  it('names the panel by its heading', () => {
    const elements = rendered(base)
    const [section] = elements
    const [heading] = withClass(elements, 'action-proposal-panel__title')

    expect(section?.type).toBe('section')
    expect(section?.props['aria-labelledby']).toBe(heading?.props['id'])
  })

  it('shows every stage in the order it was given, each as words', () => {
    const elements = rendered(base)
    const names = withClass(elements, 'action-proposal-panel__stage-name')
    const badges = elements.filter((element) => element.type === Badge)

    expect(names.map((name) => name.props['children'])).toEqual([
      'Proposal',
      'Approval',
      'Execution',
    ])
    expect(badges.slice(0, 3).map((badge) => badge.props['children'])).toEqual([
      'Proposed',
      'Waiting for you',
      'Blocked',
    ])
  })

  it('lists the stages as an ordered list, because the order is the meaning', () => {
    const [stages] = withClass(rendered(base), 'action-proposal-panel__stages')

    expect(stages?.type).toBe('ol')
  })

  it('names every mailbox copy it was given, and adds none', () => {
    const targets = withClass(
      rendered({
        ...base,
        targets: [
          ...base.targets,
          {
            id: 'c2',
            label: 'Atelier Linden',
            identity: 'atelier@mail.example · message 11',
            detail: 'Unobserved.',
          },
        ],
      }),
      'action-proposal-panel__target-label',
    )

    expect(targets.map((target) => target.props['children'])).toEqual([
      'Studio Noord',
      'Atelier Linden',
    ])
  })

  it('shows the ids of every copy, so two shown under one name stay apart', () => {
    const shownAlike = [
      { id: 'c1', label: 'Shared', identity: 'one@mail.example · message 11', detail: 'A.' },
      { id: 'c2', label: 'Shared', identity: 'two@mail.example · message 11', detail: 'B.' },
    ]
    const identities = withClass(
      rendered({ ...base, targets: shownAlike }),
      'action-proposal-panel__target-identity',
    )

    expect(identities.map((target) => target.props['children'])).toEqual([
      'one@mail.example · message 11',
      'two@mail.example · message 11',
    ])
  })

  it('says what the action would change and what about that is unknown', () => {
    const elements = rendered(base)
    const [statement] = withClass(elements, 'action-proposal-panel__effect')
    const notes = withClass(elements, 'action-proposal-panel__note')

    expect(statement?.props['children']).toBe(base.effect.statement)
    expect(notes.map((note) => note.props['children'])).toContain(base.effect.note)
  })

  it('says so instead of listing nothing when no copy is named', () => {
    const elements = rendered({ ...base, targets: [] })

    expect(withClass(elements, 'action-proposal-panel__targets')).toHaveLength(0)
    expect(withClass(elements, 'action-proposal-panel__empty')[0]?.props['children']).toBe(
      base.targetsEmpty,
    )
  })

  it('keeps the note about other copies whether or not any is named', () => {
    for (const targets of [base.targets, []]) {
      const [note] = withClass(rendered({ ...base, targets }), 'action-proposal-panel__note')

      expect(note?.props['children']).toBe(base.targetsNote)
    }
  })

  it('names every precondition beside whether it is met', () => {
    const items = withClass(rendered(base), 'action-proposal-panel__precondition')

    expect(items).toHaveLength(2)
    expect(flatten(items[1]).map((element) => element.props['children'])).toContain('Not connected')
  })

  it('renders one button per action, disabled where the caller says so', () => {
    const buttons = rendered({
      ...base,
      actions: [
        { id: 'propose', label: 'Propose archive', disabled: true, onClick: vi.fn() },
        { id: 'withdraw', label: 'Withdraw', variant: 'quiet', onClick: vi.fn() },
      ],
    }).filter((element) => element.type === Button)

    expect(buttons.map((button) => button.props['children'])).toEqual([
      'Propose archive',
      'Withdraw',
    ])
    expect(buttons[0]?.props['disabled']).toBe(true)
    expect(buttons[1]?.props['variant']).toBe('quiet')
  })

  it('calls back the action that was pressed', () => {
    const onClick = vi.fn()
    const [button] = rendered({
      ...base,
      actions: [{ id: 'approve', label: 'Approve', onClick }],
    }).filter((element) => element.type === Button)
    const press = button?.props['onClick'] as () => void
    press()

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('shows the result copy the caller gave', () => {
    const [result] = withClass(rendered(base), 'action-proposal-panel__result')

    expect(flatten(result).map((element) => element.props['children'])).toContain(
      'Your mailbox is unchanged.',
    )
  })
})
