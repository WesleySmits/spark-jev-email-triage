import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { MailReader } from '../domain/mail-reader'
import type { createJevClassifier } from '../jev/classifier'
import { jevFailure, jevJudgment } from '../jev/fixtures'
import { openDatabase } from '../shadow/database'
import { claimManualRun, type ManualRunSelection } from '../shadow/manual-runs'
import { createTriageRunService } from './triage-runs.server'

const mailbox = { id: 'support@example.com', address: 'support@example.com' }
const reading = '00000000-0000-4000-8000-000000000010'
const requestId = '00000000-0000-4000-8000-000000000020'
const nextRequestId = '00000000-0000-4000-8000-000000000021'
const runIds = ['00000000-0000-4000-8000-000000000030', '00000000-0000-4000-8000-000000000031']

const selected: readonly ManualRunSelection[] = ['4001', '4002', '4003'].map((messageId) => ({
  mailboxId: mailbox.id,
  mailboxAddress: mailbox.address,
  messageId,
}))

const thread = (messageId: string) => ({
  id: `thread-${messageId}`,
  mailboxId: mailbox.id,
  subject: `Synthetic subject ${messageId}`,
  messages: [
    {
      id: messageId,
      from: { address: 'sender@example.org', name: 'Synthetic Sender' },
      to: [{ address: mailbox.address, name: 'Support' }],
      cc: [],
      sentAt: '2026-09-24T08:00:00.000Z',
      bodyText: `Synthetic body ${messageId}`,
      attachments: [],
    },
  ],
})

function reader(): MailReader {
  return {
    listMailboxes: () =>
      Promise.resolve([{ mailbox, kind: 'shared_inbox' as const, canRead: true }]),
    listRecentEmails: ({ limit }) =>
      Promise.resolve(
        selected.slice(0, limit).map(({ messageId }) => ({
          messageId,
          mailboxId: mailbox.id,
          from: { address: 'sender@example.org', name: 'Synthetic Sender' },
          sender: { text: 'Synthetic Sender', cut: false },
          subject: { text: `Synthetic subject ${messageId}`, cut: false },
          date: '2026-09-24T08:00:00.000Z',
        })),
      ),
    readThread: ({ messageId }) => Promise.resolve(thread(messageId)),
  }
}

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function harness(
  classify: ReturnType<typeof createJevClassifier> = ({ thread }) =>
    Promise.resolve(jevJudgment(thread.id)),
) {
  const directory = mkdtempSync(join(tmpdir(), 'manual-triage-'))
  directories.push(directory)
  const path = join(directory, 'triage.sqlite')
  let id = 0
  let clock = 0
  let enabled = true
  let configured = true
  const calls: string[] = []
  const counted: ReturnType<typeof createJevClassifier> = async (request, signal) => {
    calls.push(request.thread.id)
    return classify(request, signal)
  }
  const service = createTriageRunService({
    reader: reader(),
    classifier: () => (configured ? counted : null),
    open: () => openDatabase(path),
    worklist: (candidate) => (candidate === reading ? selected : null),
    enabled: () => enabled,
    now: () => new Date(Date.UTC(2026, 8, 24, 9, 0, clock++)),
    newId: () => runIds[id++] ?? crypto.randomUUID(),
    processId: 4242,
    isProcessAlive: (pid) => pid === 4242,
  })
  return {
    service,
    calls,
    path,
    configure: (next: { enabled?: boolean; configured?: boolean }) => {
      enabled = next.enabled ?? enabled
      configured = next.configured ?? configured
    },
  }
}

const worklistStart = {
  requestId,
  scope: { kind: 'worklist' as const, reading },
  limits: { maxMessages: 2, maxJevCalls: 1 },
}

describe('manual Jev run server', () => {
  it('does nothing until an explicit bounded start and reports price as unavailable', async () => {
    const { service, calls } = harness()

    expect(service.read(runIds[0] ?? '')).toEqual({ status: 'absent' })
    expect(calls).toEqual([])

    const started = await service.start(worklistStart)
    expect(started.status).toBe('accepted')
    if (started.status !== 'accepted') return
    expect(started.run.counts.selected).toBe(2)
    await service.settled(started.run.runId)

    const readback = service.read(started.run.runId)
    expect(readback.status).toBe('found')
    if (readback.status !== 'found') return
    expect(readback.run.status).toBe('partial')
    expect(readback.run.counts).toMatchObject({
      selected: 2,
      processed: 2,
      classified: 1,
      deferred: 1,
    })
    expect(readback.run.cost).toEqual({
      status: 'price_unavailable',
      jevCalls: 1,
      inputTokens: 812,
      outputTokens: 64,
    })
    expect(calls).toHaveLength(1)
  })

  it('replays one Start id and restarts safely over the durable selection', async () => {
    const { service, calls } = harness()
    const first = await service.start(worklistStart)
    expect(first.status).toBe('accepted')
    if (first.status !== 'accepted') return
    await service.settled(first.run.runId)

    const replay = await service.start(worklistStart)
    expect(replay).toMatchObject({ status: 'accepted', run: { runId: first.run.runId } })
    expect(calls).toHaveLength(1)

    const restarted = service.restart({ requestId: nextRequestId, runId: first.run.runId })
    expect(restarted.status).toBe('accepted')
    if (restarted.status !== 'accepted') return
    expect(restarted.run.sourceRunId).toBe(first.run.runId)
    await service.settled(restarted.run.runId)

    const readback = service.read(restarted.run.runId)
    expect(readback).toMatchObject({
      status: 'found',
      run: {
        status: 'completed',
        counts: { selected: 2, processed: 2, classified: 1, alreadyCurrent: 1 },
      },
    })
    expect(calls).toHaveLength(2)
  })

  it('replays accepted Start and Restart ids before changed configuration gates', async () => {
    const { service, calls, configure } = harness()
    const first = await service.start(worklistStart)
    expect(first.status).toBe('accepted')
    if (first.status !== 'accepted') return
    await service.settled(first.run.runId)
    const callsAfterFirst = calls.length

    configure({ enabled: false, configured: false })
    expect(await service.start(worklistStart)).toMatchObject({
      status: 'accepted',
      run: { runId: first.run.runId },
    })
    expect(calls).toHaveLength(callsAfterFirst)

    configure({ enabled: true, configured: true })
    const restartRequest = { requestId: nextRequestId, runId: first.run.runId }
    const restarted = service.restart(restartRequest)
    expect(restarted.status).toBe('accepted')
    if (restarted.status !== 'accepted') return
    await service.settled(restarted.run.runId)
    const callsAfterRestart = calls.length

    configure({ enabled: false, configured: false })
    expect(service.restart(restartRequest)).toMatchObject({
      status: 'accepted',
      run: { runId: restarted.run.runId },
    })
    expect(calls).toHaveLength(callsAfterRestart)
  })

  it('keeps provider failure details content-free and retryable', async () => {
    const { service } = harness(({ thread }) => Promise.resolve(jevFailure(thread.id)))
    const started = await service.start({
      ...worklistStart,
      limits: { maxMessages: 1, maxJevCalls: 1 },
    })
    expect(started.status).toBe('accepted')
    if (started.status !== 'accepted') return
    await service.settled(started.run.runId)

    expect(service.read(started.run.runId)).toMatchObject({
      status: 'found',
      run: {
        status: 'partial',
        counts: { providerFailures: 1, errors: 1 },
        errorCodes: ['timeout'],
        items: [{ mailbox: mailbox.id, messageId: '4001', status: 'provider_failure' }],
      },
    })
  })

  it('never lends a later successful judgment to an older failed run item', async () => {
    let failing = true
    const { service } = harness(({ thread }) =>
      Promise.resolve(
        failing
          ? jevFailure(thread.id)
          : jevJudgment(thread.id, { category: 'purchase', priority: 'normal' }),
      ),
    )
    const first = await service.start({
      ...worklistStart,
      limits: { maxMessages: 1, maxJevCalls: 1 },
    })
    expect(first.status).toBe('accepted')
    if (first.status !== 'accepted') return
    await service.settled(first.run.runId)
    expect(service.read(first.run.runId)).toMatchObject({
      status: 'found',
      run: { items: [{ status: 'provider_failure', errorCode: 'timeout' }] },
    })

    failing = false
    const later = await service.start({
      ...worklistStart,
      requestId: nextRequestId,
      limits: { maxMessages: 1, maxJevCalls: 1 },
    })
    expect(later.status).toBe('accepted')
    if (later.status !== 'accepted') return
    await service.settled(later.run.runId)
    expect(service.read(later.run.runId)).toMatchObject({
      status: 'found',
      run: { items: [{ status: 'classified', category: 'purchase', priority: 'normal' }] },
    })

    const historical = service.read(first.run.runId)
    expect(historical.status).toBe('found')
    if (historical.status !== 'found') return
    expect(historical.run.items).toEqual([
      { mailbox: mailbox.id, messageId: '4001', status: 'provider_failure' },
    ])
  })

  it('stops cooperatively and never starts the remaining Jev calls', async () => {
    let entered: (() => void) | undefined
    const inFlight = new Promise<void>((resolve) => {
      entered = resolve
    })
    const { service, calls } = harness(async ({ thread }, signal) => {
      entered?.()
      await new Promise<void>((resolve) => {
        signal?.addEventListener(
          'abort',
          () => {
            resolve()
          },
          { once: true },
        )
      })
      return jevFailure(thread.id)
    })
    const started = await service.start({
      ...worklistStart,
      limits: { maxMessages: 3, maxJevCalls: 3 },
    })
    expect(started.status).toBe('accepted')
    if (started.status !== 'accepted') return
    await inFlight
    expect(service.stop(started.run.runId).status).toBe('stopping')
    await service.settled(started.run.runId)

    expect(service.read(started.run.runId)).toMatchObject({
      status: 'found',
      run: { status: 'stopped', counts: { selected: 3, processed: 3, deferred: 2 } },
    })
    expect(calls).toHaveLength(1)
  })

  it('observes a durable stop from another service before the next dispatch', async () => {
    let release: (() => void) | undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let secondEntered: (() => void) | undefined
    const twoInFlight = new Promise<void>((resolve) => {
      secondEntered = resolve
    })
    let entered = 0
    const {
      service: owner,
      calls,
      path,
    } = harness(async ({ thread }) => {
      entered += 1
      if (entered === 2) secondEntered?.()
      await held
      return jevFailure(thread.id)
    })
    const started = await owner.start({
      ...worklistStart,
      limits: { maxMessages: 3, maxJevCalls: 3 },
    })
    expect(started.status).toBe('accepted')
    if (started.status !== 'accepted') return
    await twoInFlight

    const stopper = createTriageRunService({
      reader: reader(),
      classifier:
        () =>
        ({ thread }) =>
          Promise.resolve(jevJudgment(thread.id)),
      open: () => openDatabase(path),
      worklist: () => selected,
      enabled: () => true,
      now: () => new Date('2026-09-24T09:10:00.000Z'),
      newId: () => crypto.randomUUID(),
      processId: 4343,
      isProcessAlive: (pid) => pid === 4242 || pid === 4343,
    })
    expect(stopper.stop(started.run.runId).status).toBe('stopping')
    release?.()
    await owner.settled(started.run.runId)

    expect(calls).toHaveLength(2)
    expect(owner.read(started.run.runId)).toMatchObject({
      status: 'found',
      run: { status: 'stopped', counts: { selected: 3, processed: 3, deferred: 1 } },
    })
  })

  it('finishes a locally owned run when its in-memory job is gone', () => {
    const { service, path, calls } = harness()
    const runId = crypto.randomUUID()
    const db = openDatabase(path)
    try {
      expect(
        claimManualRun(
          db,
          {
            id: runId,
            requestId: crypto.randomUUID(),
            requestPayload: JSON.stringify(worklistStart),
            scopeKind: 'worklist',
            scopeLabel: 'Current worklist',
            maxMessages: 3,
            maxJevCalls: 3,
            pid: 4242,
            startedAt: '2026-09-24T09:00:00.000Z',
            items: selected,
          },
          () => true,
        ),
      ).toEqual({ status: 'created', runId })
    } finally {
      db.close()
    }

    expect(service.stop(runId)).toMatchObject({
      status: 'already_finished',
      run: { status: 'stopped', counts: { selected: 3, processed: 3, deferred: 3 } },
    })
    expect(calls).toEqual([])
  })

  it('selects a mailbox with the requested hard message bound', async () => {
    const { service, calls } = harness()
    const started = await service.start({
      requestId,
      scope: { kind: 'mailbox', mailbox: mailbox.address },
      limits: { maxMessages: 2, maxJevCalls: 2 },
    })
    expect(started.status).toBe('accepted')
    if (started.status !== 'accepted') return
    await service.settled(started.run.runId)
    expect(service.read(started.run.runId)).toMatchObject({
      status: 'found',
      run: { status: 'completed', scope: { kind: 'mailbox', label: mailbox.address } },
    })
    expect(calls).toHaveLength(2)
  })

  it('fails closed for stale worklists, missing credentials, and a disabled server', async () => {
    const base = harness().service
    expect(
      await base.start({
        ...worklistStart,
        scope: { kind: 'worklist', reading: '00000000-0000-4000-8000-000000000099' },
      }),
    ).toEqual({ status: 'blocked', reason: 'stale_worklist' })

    const directory = mkdtempSync(join(tmpdir(), 'manual-triage-disabled-'))
    directories.push(directory)
    const make = (enabled: boolean, configured: boolean) =>
      createTriageRunService({
        reader: reader(),
        classifier: () =>
          configured ? ({ thread }) => Promise.resolve(jevJudgment(thread.id)) : null,
        open: () =>
          openDatabase(join(directory, `${String(enabled)}-${String(configured)}.sqlite`)),
        worklist: () => selected,
        enabled: () => enabled,
        now: () => new Date('2026-09-24T09:00:00.000Z'),
        newId: () => runIds[0] ?? '',
        processId: 4242,
        isProcessAlive: () => true,
      })
    expect(await make(false, true).start(worklistStart)).toEqual({
      status: 'blocked',
      reason: 'disabled',
    })
    expect(await make(true, false).start(worklistStart)).toEqual({
      status: 'blocked',
      reason: 'missing_credentials',
    })
  })
})
