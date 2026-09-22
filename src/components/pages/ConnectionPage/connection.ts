/**
 * What the connection page shows for a reconnect state: the panel copy, the
 * top-bar status and the empty rail and reader. A plain function of the
 * state, so each state's copy is tested without rendering.
 */
import type { ComponentProps } from 'react'
import {
  checksOnRequest,
  persistentAfter,
  pollsFor,
  type ConnectionReason,
  type ReconnectSnapshot,
} from '../../../app/reconnect'
import type { StatusDot } from '../../atoms/StatusDot/StatusDot'
import type { SyncStatus } from '../../molecules/SyncStatusButton/SyncStatusButton'

export type ConnectionView = Readonly<{
  tone: NonNullable<ComponentProps<typeof StatusDot>['tone']>
  title: string
  steps?: readonly string[] | undefined
  description?: readonly string[] | undefined
  meta?: string | undefined
  hint?: string | undefined
  /** Check now, when offered. `busy` while a check or the inbox read runs. */
  action?: Readonly<{ label: string; busy: boolean }> | undefined
  /** The queue header's scope line. */
  context: string
  /** The top-bar status. `checks`: clicking it runs Check now. */
  sync: Readonly<{ status: SyncStatus; label: string; checks: boolean }>
  /** The rail's mailbox group, which is empty until mail is read. */
  mailboxes: string
  /** The reader pane, which has no message to show. */
  reader: Readonly<{ title: string; description: string }>
}>

type Formats = Readonly<{
  /** "09:41:08", for the panel's last check. */
  seconds: (at: Date) => string
  /** "09:41", for the top bar. */
  minutes: (at: Date) => string
}>

/** Local 24-hour times, like the inbox's "Updated at 09:42". */
const localFormats: Formats = {
  seconds: (at) =>
    at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  minutes: (at) => at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
}

const done = "That's it. This list fills in on its own."
const cadence = 'Checks every 10 seconds'

/** What waiting looks like per reason. `checking` and `loading` keep the title. */
const waiting: Readonly<
  Record<
    ConnectionReason,
    Readonly<{
      title: string
      steps?: readonly string[]
      description?: readonly string[]
      /** Advice once the wait has lasted about 5 visible minutes. */
      persistent?: string
      context: string
      sync: string
    }>
  >
> = {
  failed: {
    title: 'Waiting for Spark',
    steps: ['Open Spark on this Mac.', 'Check that you are signed in.', done],
    persistent: 'If Spark is open, quit it and open it again.',
    context: 'Waiting for Spark',
    sync: 'Waiting for Spark',
  },
  missing: {
    title: "Spark isn't set up on this Mac",
    steps: ['Install Spark on this Mac.', 'Open it and sign in.', done],
    persistent: 'Spark must be installed for the user that runs this app.',
    context: 'Waiting for Spark',
    sync: 'Waiting for Spark',
  },
  unreachable: {
    title: 'Waiting for the app',
    steps: ['Start the app again on this Mac.', "That's it. This page reconnects on its own."],
    persistent: 'Check that the app is still running on this Mac.',
    context: 'Waiting for the app',
    sync: 'Waiting for the app',
  },
  malformed: {
    title: 'Spark sent something unexpected',
    description: [
      'The mail list could not be read safely, so none is shown. Updating Spark may help.',
    ],
    context: 'No mail shown',
    sync: 'Unexpected answer from Spark',
  },
  'local-only': {
    title: 'Open this on the Mac that runs Spark',
    description: [
      'Live mail is only read on the computer where Spark is signed in, so this browser gets none. Nothing is checked from here.',
      'On that Mac, open this app from localhost.',
    ],
    context: 'No mail on this computer',
    sync: 'Not on the Spark Mac',
  },
}

const idleReader = {
  title: 'Your mail opens here',
  description: 'Choose a message once the list has loaded.',
} as const

/** The meta line and hint while nothing runs. */
function waitingMeta(state: ReconnectSnapshot, format: Formats) {
  const { reason, lastChecked, failedChecks, failingSince, offline } = state
  const last = lastChecked ? `Last checked ${format.seconds(lastChecked)}` : undefined
  if (!pollsFor(reason)) {
    return { meta: [last, 'Checks only when you ask'].filter(Boolean).join(' · ') }
  }
  if (offline) return { meta: "Offline. Checks start again when you're back online." }
  if (failedChecks >= persistentAfter && failingSince) {
    return {
      meta: `Still waiting. No answer since ${format.minutes(failingSince)} · ${cadence}`,
      hint: waiting[reason].persistent,
    }
  }
  return { meta: [last, cadence].filter(Boolean).join(' · ') }
}

export function connectionView(
  state: ReconnectSnapshot,
  format: Formats = localFormats,
): ConnectionView {
  const copy = waiting[state.reason]
  const base = {
    title: copy.title,
    steps: copy.steps,
    description: copy.description,
    context: copy.context,
    mailboxes:
      state.reason === 'local-only'
        ? 'Mailboxes are only read on the Mac that runs Spark.'
        : 'Mailboxes appear when Spark answers.',
    reader:
      state.reason === 'local-only'
        ? {
            title: 'Nothing to read here',
            description: 'Mail is only shown on the Mac that runs Spark.',
          }
        : idleReader,
  } as const
  if (state.activity === 'loading') {
    return {
      ...base,
      tone: 'success',
      title: 'Spark answered',
      steps: undefined,
      description: ['Reading your recent mail. The list opens here in a moment.'],
      action: { label: 'Reading mail…', busy: true },
      context: 'Reading recent mail',
      sync: { status: 'connected', label: 'Spark answered · reading mail', checks: false },
    }
  }
  if (state.activity === 'checking') {
    return {
      ...base,
      tone: 'checking',
      meta: 'Checking now…',
      action: { label: 'Checking…', busy: true },
      sync: { status: 'checking', label: 'Checking for Spark…', checks: false },
    }
  }
  if (!checksOnRequest(state.reason)) {
    return { ...base, tone: 'neutral', sync: { status: 'idle', label: copy.sync, checks: false } }
  }
  const at =
    state.lastChecked && pollsFor(state.reason) ? ` · ${format.minutes(state.lastChecked)}` : ''
  return {
    ...base,
    ...waitingMeta(state, format),
    tone: pollsFor(state.reason) ? 'waiting' : 'neutral',
    action: { label: 'Check now', busy: false },
    sync: {
      status: pollsFor(state.reason) ? 'waiting' : 'idle',
      label: `${copy.sync}${at}`,
      checks: true,
    },
  }
}
