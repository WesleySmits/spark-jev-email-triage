import type { QueueMessage } from '../../organisms/MessageQueue/MessageQueue'
import type { SidebarGroup, SidebarItem } from '../../organisms/Sidebar/Sidebar'

/**
 * One message as the workbench lists it: its queue row plus what the reader
 * header needs. It holds no body; the page loads that when the message opens.
 */
export type WorkbenchMessage = QueueMessage &
  Readonly<{
    /** Id of the workflow it is in, one of the page's `workflows`. */
    workflow: string
    /**
     * Id of the mailbox it is in, one of the page's `mailboxes`. Its account
     * marker is only a color, which several mailboxes may share.
     */
    mailbox: string
    /** Provider message id, when this row came from a live mailbox. */
    messageId?: string | undefined
    /** The sender's address, shown in the reader. */
    address?: string | undefined
  }>

export type WorkbenchFilter = Readonly<{ workflow: string; mailbox: string; query: string }>

/** The mailbox filter that shows every loaded mailbox. */
export const allMailboxes = 'all'

// It shows every loaded mailbox, not every mailbox or every message in one,
// so both names say loaded: the page has only ever read a bounded selection.
// The rail's is short enough to show whole in its 156px column; the queue
// header has the room for the full phrase.
const allAccounts: SidebarItem = { id: allMailboxes, icon: 'inbox', label: 'All loaded' }
const allLoaded = 'All loaded mailboxes'

/** The applied mailbox filter's name, e.g. "All loaded mailboxes" or the mailbox's label. */
export function mailboxLabel(mailbox: string, mailboxes: readonly SidebarItem[]) {
  return mailboxes.find((item) => item.id === mailbox)?.label ?? allLoaded
}

/** Where the page starts and what Reset goes back to: the first workflow, all mailboxes. */
export const defaultFilter: WorkbenchFilter = { workflow: '', mailbox: allMailboxes, query: '' }

const hasItem = (items: readonly SidebarItem[], id: string) => items.some((item) => item.id === id)

/**
 * The filter as applied to the current props. A workflow or mailbox that
 * isn't (or is no longer) among them falls back to the first workflow or to
 * all mailboxes, so data that arrives or changes later still shows.
 */
export function appliedFilter(
  filter: WorkbenchFilter,
  workflows: readonly SidebarItem[],
  mailboxes: readonly SidebarItem[],
): WorkbenchFilter {
  return {
    workflow: hasItem(workflows, filter.workflow) ? filter.workflow : (workflows[0]?.id ?? ''),
    mailbox: hasItem(mailboxes, filter.mailbox) ? filter.mailbox : allMailboxes,
    query: filter.query,
  }
}

function inMailbox(message: WorkbenchMessage, mailbox: string) {
  return mailbox === allMailboxes || message.mailbox === mailbox
}

function hasText(message: WorkbenchMessage, query: string) {
  const needle = query.trim().toLowerCase()
  return [message.sender, message.subject, message.snippet].some((text) =>
    text.toLowerCase().includes(needle),
  )
}

function matches(message: WorkbenchMessage, { workflow, mailbox, query }: WorkbenchFilter) {
  return message.workflow === workflow && inMailbox(message, mailbox) && hasText(message, query)
}

/** The rows the queue shows for a filter, in the caller's order. */
export function visibleMessages(messages: readonly WorkbenchMessage[], filter: WorkbenchFilter) {
  return messages.filter((message) => matches(message, filter))
}

type RailInput = Readonly<{
  messages: readonly WorkbenchMessage[]
  filter: WorkbenchFilter
  workflows: readonly SidebarItem[]
  mailboxes: readonly SidebarItem[]
}>

/**
 * The rail's two groups with the applied filters. A workflow's count is its
 * messages in the chosen mailbox; a mailbox's count is its messages in the
 * chosen workflow. The search is left out, so the counts stay put while typing.
 */
export function railGroups({ messages, filter, workflows, mailboxes }: RailInput): SidebarGroup[] {
  const count = (change: Partial<WorkbenchFilter>) =>
    visibleMessages(messages, { ...filter, ...change, query: '' }).length
  const withCounts = (items: readonly SidebarItem[], key: 'workflow' | 'mailbox') =>
    items.map((item) => ({ ...item, count: count({ [key]: item.id }) }))
  return [
    {
      id: 'workflow',
      label: 'Workflow',
      selectedId: filter.workflow,
      items: withCounts(workflows, 'workflow'),
    },
    {
      id: 'mailbox',
      label: 'Mailboxes',
      selectedId: filter.mailbox,
      items: withCounts([allAccounts, ...mailboxes], 'mailbox'),
    },
  ]
}

/**
 * The id `step` rows from `id`: 1 is the next row, -1 the previous. Without
 * a current row it starts at the first. Stays put at either end.
 */
export function neighbour(
  messages: readonly WorkbenchMessage[],
  id: string | undefined,
  step: 1 | -1,
) {
  const index = messages.findIndex((message) => message.id === id)
  if (index === -1) return messages[0]?.id
  return messages[Math.min(Math.max(index + step, 0), messages.length - 1)]?.id
}

/** The open message: the chosen one while it is in the list, else the first row. */
export function openedMessage(messages: readonly WorkbenchMessage[], id: string | undefined) {
  return messages.find((message) => message.id === id) ?? messages[0]
}

/** What to open once `id` leaves the list: the next row, else the previous one. */
export function afterRemoval(messages: readonly WorkbenchMessage[], id: string) {
  const index = messages.findIndex((message) => message.id === id)
  return (messages[index + 1] ?? messages[index - 1])?.id
}
