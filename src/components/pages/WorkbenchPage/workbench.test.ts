import { describe, expect, it } from 'vitest'
import type { SidebarItem } from '../../organisms/Sidebar/Sidebar'
import {
  afterRemoval,
  allMailboxes,
  appliedFilter,
  defaultFilter,
  neighbour,
  openedMessage,
  railGroups,
  visibleMessages,
  type WorkbenchFilter,
  type WorkbenchMessage,
} from './workbench'

function message(
  id: string,
  workflow: string,
  marker: 'studio' | 'atelier',
  text: Partial<Pick<WorkbenchMessage, 'sender' | 'subject' | 'snippet' | 'body'>> = {},
): WorkbenchMessage {
  return {
    id,
    workflow,
    sender: `Sender ${id}`,
    time: '09:00',
    subject: `Subject ${id}`,
    snippet: `Snippet ${id}`,
    body: `Body ${id}`,
    account: { marker, label: marker },
    status: { label: workflow, tone: 'review' },
    ...text,
  }
}

const messages = [
  message('a', 'review', 'studio', { subject: 'Invoice AL-2048' }),
  message('b', 'review', 'atelier', { body: 'The INVOICE is attached.' }),
  message('c', 'action', 'studio'),
  message('d', 'review', 'studio'),
]

const workflows: SidebarItem[] = [
  { id: 'review', icon: 'clock', label: 'Needs review' },
  { id: 'action', icon: 'alert', label: 'Needs action' },
  { id: 'done', icon: 'check', label: 'Done' },
]

const mailboxes: SidebarItem[] = [
  { id: 'studio', account: 'studio', label: 'Studio Noord' },
  { id: 'atelier', account: 'atelier', label: 'Atelier Linden' },
]

const filter = (change: Partial<WorkbenchFilter> = {}): WorkbenchFilter => ({
  workflow: 'review',
  mailbox: allMailboxes,
  query: '',
  ...change,
})

const ids = (list: readonly WorkbenchMessage[]) => list.map((item) => item.id)

describe('visibleMessages', () => {
  it('keeps the workflow in the caller order across all mailboxes', () => {
    expect(ids(visibleMessages(messages, filter()))).toEqual(['a', 'b', 'd'])
  })

  it('narrows to one mailbox', () => {
    expect(ids(visibleMessages(messages, filter({ mailbox: 'atelier' })))).toEqual(['b'])
  })

  it('searches subject and body, ignoring case and outer spaces', () => {
    expect(ids(visibleMessages(messages, filter({ query: '  invoice ' })))).toEqual(['a', 'b'])
  })

  it('searches sender and snippet', () => {
    expect(ids(visibleMessages(messages, filter({ query: 'sender d' })))).toEqual(['d'])
    expect(ids(visibleMessages(messages, filter({ query: 'snippet a' })))).toEqual(['a'])
  })

  it('shows nothing when nothing matches', () => {
    expect(visibleMessages(messages, filter({ workflow: 'done' }))).toEqual([])
    expect(visibleMessages(messages, filter({ query: 'zzz' }))).toEqual([])
  })
})

describe('railGroups', () => {
  it('marks the applied filters and adds All accounts first', () => {
    const [workflow, mailbox] = railGroups({
      messages,
      filter: filter({ mailbox: 'studio' }),
      workflows,
      mailboxes,
    })
    expect(workflow).toMatchObject({ id: 'workflow', label: 'Workflow', selectedId: 'review' })
    expect(mailbox).toMatchObject({ id: 'mailbox', label: 'Mailboxes', selectedId: 'studio' })
    expect(mailbox?.items[0]).toEqual({
      id: allMailboxes,
      icon: 'inbox',
      label: 'All accounts',
      count: 3,
    })
  })

  it('counts workflows in the chosen mailbox and mailboxes in the chosen workflow, without the search', () => {
    const [workflow, mailbox] = railGroups({
      messages,
      filter: filter({ mailbox: 'studio', query: 'zzz' }),
      workflows,
      mailboxes,
    })
    expect(workflow?.items.map((item) => item.count)).toEqual([2, 1, 0])
    expect(mailbox?.items.map((item) => item.count)).toEqual([3, 2, 1])
  })
})

describe('appliedFilter', () => {
  it('keeps a known workflow and mailbox', () => {
    const chosen = filter({ workflow: 'action', mailbox: 'studio', query: 'x' })
    expect(appliedFilter(chosen, workflows, mailboxes)).toEqual(chosen)
  })

  it('starts on the first workflow and all mailboxes', () => {
    expect(appliedFilter(defaultFilter, workflows, mailboxes)).toEqual(filter())
  })

  it('falls back when the chosen filters are no longer offered', () => {
    const stale = filter({ workflow: 'gone', mailbox: 'gone', query: 'x' })
    expect(appliedFilter(stale, workflows, mailboxes)).toEqual(filter({ query: 'x' }))
  })

  it('applies no workflow until the workflows arrive', () => {
    expect(appliedFilter(defaultFilter, [], [])).toEqual(filter({ workflow: '' }))
    expect(visibleMessages(messages, appliedFilter(defaultFilter, [], []))).toEqual([])
  })
})

describe('openedMessage', () => {
  it('keeps the chosen message while it is in the list', () => {
    expect(openedMessage(messages, 'c')?.id).toBe('c')
  })

  it('opens the first row without a choice, or when the choice left the list', () => {
    expect(openedMessage(messages, undefined)?.id).toBe('a')
    expect(openedMessage(messages, 'gone')?.id).toBe('a')
    expect(openedMessage([], 'a')).toBeUndefined()
  })
})

describe('neighbour', () => {
  it('steps forward and back', () => {
    expect(neighbour(messages, 'b', 1)).toBe('c')
    expect(neighbour(messages, 'b', -1)).toBe('a')
  })

  it('stays put at either end', () => {
    expect(neighbour(messages, 'd', 1)).toBe('d')
    expect(neighbour(messages, 'a', -1)).toBe('a')
  })

  it('starts at the first row without a current one', () => {
    expect(neighbour(messages, undefined, 1)).toBe('a')
    expect(neighbour(messages, 'gone', -1)).toBe('a')
    expect(neighbour([], undefined, 1)).toBeUndefined()
  })
})

describe('afterRemoval', () => {
  it('opens the next row, else the previous one, else nothing', () => {
    expect(afterRemoval(messages, 'b')).toBe('c')
    expect(afterRemoval(messages, 'd')).toBe('c')
    expect(afterRemoval(messages.slice(0, 1), 'a')).toBeUndefined()
  })
})
