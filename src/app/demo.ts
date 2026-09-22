import type { ComponentProps } from 'react'
import type { SidebarItem } from '../components/organisms/Sidebar/Sidebar'
import type { WorkbenchMessage } from '../components/pages/WorkbenchPage/workbench'
import type { WorkbenchPage } from '../components/pages/WorkbenchPage/WorkbenchPage'

// Fictional sample data for the demo workbench. No name, address or mail
// here belongs to anyone; every address uses a reserved `.example` domain.

export const demoWorkflows: readonly SidebarItem[] = [
  { id: 'review', icon: 'clock', label: 'Needs review' },
  { id: 'action', icon: 'alert', label: 'Needs action' },
  { id: 'done', icon: 'check', label: 'Done' },
]

export const demoMailboxes: readonly SidebarItem[] = [
  { id: 'studio', account: 'studio', label: 'Studio Noord' },
  { id: 'atelier', account: 'atelier', label: 'Atelier Linden' },
  { id: 'personal', account: 'personal', label: 'Personal' },
]

const studio = { marker: 'studio', label: 'Studio Noord' } as const
const atelier = { marker: 'atelier', label: 'Atelier Linden' } as const
const personal = { marker: 'personal', label: 'Personal' } as const
const review = { label: 'Needs review', tone: 'review' } as const
const action = { label: 'Action needed', tone: 'neutral' } as const
const completed = { label: 'Completed', tone: 'done' } as const

export const demoMessages: readonly WorkbenchMessage[] = [
  {
    id: 'demo-1',
    workflow: 'review',
    sender: 'Sanne Bakker',
    address: 'sanne@harbourlight.example',
    time: '10:05',
    dateTime: '2026-09-22T10:05',
    subject: 'Sample: can we review the draft on Thursday?',
    snippet: 'I have gone through the draft and marked a few open questions…',
    body: 'Hi,\n\nI have gone through the draft and marked a few open questions in the margin. Would Thursday afternoon work to go through them together?\n\nBest,\nSanne',
    account: studio,
    status: review,
    category: 'Customer question',
    unread: true,
  },
  {
    id: 'demo-2',
    workflow: 'action',
    sender: 'Joris Visser',
    address: 'billing@lindenleaf.example',
    time: '09:20',
    dateTime: '2026-09-22T09:20',
    subject: 'Sample: invoice LL-0317 needs a purchase order number',
    snippet: 'Our finance team asks for the purchase order number before…',
    body: 'Hello,\n\nOur finance team asks for the purchase order number before they can process invoice LL-0317. Could you add it and send the invoice again?\n\nKind regards,\nJoris',
    account: atelier,
    status: action,
    category: 'Invoice',
    unread: true,
  },
  {
    id: 'demo-3',
    workflow: 'review',
    sender: 'Noor Hendriks',
    address: 'noor@postbox.example',
    time: 'Mon',
    subject: 'Sample: picnic on Sunday?',
    snippet: 'The forecast looks dry, so shall we meet by the lake at noon…',
    body: 'The forecast looks dry, so shall we meet by the lake at noon? I will bring the blanket.\n\nNoor',
    account: personal,
    status: review,
    category: 'Personal',
  },
  {
    id: 'demo-4',
    workflow: 'action',
    sender: 'Parcel Point',
    address: 'no-reply@parcelpoint.example',
    time: 'Mon',
    subject: 'Sample: confirm a delivery time slot',
    snippet: 'Choose a time slot for your delivery of three boxes of paper…',
    body: 'Choose a time slot for your delivery of three boxes of paper. Slots are open from Wednesday to Friday.\n\nThis is a fictional sample message.',
    account: studio,
    status: action,
    category: 'Notification',
  },
  {
    id: 'demo-5',
    workflow: 'done',
    sender: 'Tidewater Journal',
    address: 'letters@tidewater.example',
    time: 'Sun',
    subject: 'Sample: this week in small workshops',
    snippet: 'Three makers show how they fit a workshop into one room…',
    body: 'Three makers show how they fit a workshop into one room, and what they chose to leave out.',
    account: atelier,
    status: completed,
    category: 'Newsletter',
  },
]

/** The top bar's sync status says the data is a sample and no mailbox changes. */
export const demoTopBar: Omit<ComponentProps<typeof WorkbenchPage>['topBar'], 'onSyncClick'> = {
  syncStatus: 'disconnected',
  syncLabel: 'Sample data · mailbox unchanged',
  profileLabel: 'Profile Demo user',
  profileInitials: 'DU',
}

/** The messages with `id` moved to Done. The demo keeps this in memory only. */
export function completeDemoMessage(messages: readonly WorkbenchMessage[], id: string) {
  return messages.map((message) =>
    message.id === id ? { ...message, workflow: 'done', status: completed } : message,
  )
}
