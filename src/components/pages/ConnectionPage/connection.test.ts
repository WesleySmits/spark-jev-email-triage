import { describe, expect, it } from 'vitest'
import { persistentAfter, type ReconnectSnapshot } from '../../../app/reconnect'
import { connectionView } from './connection'

const format = {
  seconds: (at: Date) => at.toISOString().slice(11, 19),
  minutes: (at: Date) => at.toISOString().slice(11, 16),
}

const checked = new Date('2026-09-22T09:41:08Z')

const state = (change: Partial<ReconnectSnapshot> = {}): ReconnectSnapshot => ({
  reason: 'failed',
  activity: 'waiting',
  lastChecked: checked,
  failedChecks: 1,
  failingSince: checked,
  offline: false,
  ...change,
})

const view = (change?: Partial<ReconnectSnapshot>) => connectionView(state(change), format)

describe('connectionView', () => {
  it('waits for Spark with steps, the last check and Check now', () => {
    expect(view()).toMatchObject({
      tone: 'waiting',
      title: 'Waiting for Spark',
      steps: [
        'Open Spark on this Mac.',
        'Check that you are signed in.',
        "That's it. This list fills in on its own.",
      ],
      meta: 'Last checked 09:41:08 · Checks every 10 seconds',
      action: { label: 'Check now', busy: false },
      context: 'Waiting for Spark',
      sync: { status: 'waiting', label: 'Waiting for Spark · 09:41', checks: true },
      mailboxes: 'Mailboxes appear when Spark answers.',
      reader: { title: 'Your mail opens here' },
    })
  })

  it('says it checks every 10 seconds before the first check settles', () => {
    expect(view({ lastChecked: null, failedChecks: 0, failingSince: null })).toMatchObject({
      meta: 'Checks every 10 seconds',
      sync: { label: 'Waiting for Spark' },
    })
  })

  it('keeps the title while checking, so nothing new is announced', () => {
    const checking = view({ activity: 'checking' })
    expect(checking).toMatchObject({
      tone: 'checking',
      title: view().title,
      meta: 'Checking now…',
      action: { label: 'Checking…', busy: true },
      sync: { status: 'checking', checks: false },
    })
  })

  it('says Spark answered while the inbox is read, keeping the busy action in place', () => {
    expect(view({ activity: 'loading' })).toMatchObject({
      tone: 'success',
      title: 'Spark answered',
      steps: undefined,
      action: { label: 'Reading mail…', busy: true },
      context: 'Reading recent mail',
      sync: { status: 'connected', checks: false },
    })
  })

  it('names a missing Spark', () => {
    expect(view({ reason: 'missing' })).toMatchObject({
      title: "Spark isn't set up on this Mac",
      steps: expect.arrayContaining(['Install Spark on this Mac.']) as unknown,
      action: { label: 'Check now' },
    })
  })

  it('names an app server that stopped answering', () => {
    expect(view({ reason: 'unreachable' })).toMatchObject({
      title: 'Waiting for the app',
      sync: { label: 'Waiting for the app · 09:41' },
    })
  })

  it('offers only a manual check for malformed output', () => {
    expect(view({ reason: 'malformed' })).toMatchObject({
      tone: 'neutral',
      title: 'Spark sent something unexpected',
      meta: 'Last checked 09:41:08 · Checks only when you ask',
      action: { label: 'Check now', busy: false },
      sync: { status: 'idle', label: 'Unexpected answer from Spark', checks: true },
    })
  })

  it('sends local-only to the Spark Mac without any check', () => {
    const local = view({ reason: 'local-only', lastChecked: null })
    expect(local).toMatchObject({
      tone: 'neutral',
      title: 'Open this on the Mac that runs Spark',
      context: 'No mail on this computer',
      sync: { status: 'idle', label: 'Not on the Spark Mac', checks: false },
      mailboxes: 'Mailboxes are only read on the Mac that runs Spark.',
      reader: { title: 'Nothing to read here' },
    })
    expect(local.action).toBeUndefined()
    expect(local.meta).toBeUndefined()
    expect(local.description?.join(' ')).toContain('Nothing is checked from here.')
  })

  it('says since when after a long wait, with advice, at the same cadence', () => {
    const failingSince = new Date('2026-09-22T09:36:00Z')
    expect(view({ failedChecks: persistentAfter, failingSince })).toMatchObject({
      title: 'Waiting for Spark',
      meta: 'Still waiting. No answer since 09:36 · Checks every 10 seconds',
      hint: 'If Spark is open, quit it and open it again.',
    })
    expect(view({ failedChecks: persistentAfter - 1, failingSince }).hint).toBeUndefined()
  })

  it('says checks wait while offline', () => {
    expect(view({ offline: true }).meta).toBe(
      "Offline. Checks start again when you're back online.",
    )
  })

  it('never counts down', () => {
    const views = [
      view(),
      view({ activity: 'checking' }),
      view({ reason: 'malformed' }),
      view({ failedChecks: persistentAfter }),
    ]
    for (const { meta } of views) expect(meta).not.toMatch(/next|in \d+ s/i)
  })
})
