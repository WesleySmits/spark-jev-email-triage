/**
 * The server owns Done approval, the durable action journal, and the order
 * of Spark CLI calls. Request data cannot create an approval or receipt.
 */
import { chmodSync, mkdirSync } from 'node:fs'
import { userInfo } from 'node:os'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createActionApprovalStore } from '../actions/approval-store'
import { runGuardedMarkAsDone } from '../actions/mark-as-done'
import { createActionReceiptStore } from '../actions/receipt-store'
import {
  parseMailboxActionProposal,
  type ActionTarget,
  type MailboxActionProposal,
} from '../domain/mailbox-action'
import {
  createSparkDoneProcessTransport,
  createSparkDoneProvider,
  type SparkDoneProviderPort,
} from '../spark/done-provider'
import { readDatabasePath } from '../shadow/config'
import { isLoopback } from './live-inbox.server'
import type {
  DoneApprovalRequest,
  DoneApprovalResult,
  DoneExecutionRequest,
  DoneExecutionResult,
} from './done-action'

type Env = Readonly<Record<string, string | undefined>>
type Journal = ReturnType<typeof createJournal>
const defaultJournalPath = '.data/done-actions.sqlite'
const localHosts = new Set(['localhost', '127.0.0.1', '[::1]'])

/** Origin and loopback are both required before an action on this Mac. */
export function doneRequestAllowed(
  ip: string | undefined,
  request: Request,
): 'allowed' | 'local_only' | 'origin' {
  if (!isLoopback(ip)) return 'local_only'
  const origin = request.headers.get('origin')
  const site = request.headers.get('sec-fetch-site')
  try {
    const url = new URL(request.url)
    if (!localHosts.has(url.hostname) || url.protocol !== 'http:') return 'origin'
    if (origin !== url.origin || (site !== null && site !== 'same-origin')) {
      return 'origin'
    }
  } catch {
    return 'origin'
  }
  return 'allowed'
}

function localReviewer(): string {
  try {
    const name = userInfo().username.trim()
    return name === '' ? 'local' : name
  } catch {
    return 'local'
  }
}

/** Kept apart from the classifier and review database, even when overridden. */
function openJournal(env: Env): DatabaseSync {
  const configured = env['SPARK_DONE_ACTION_DB_PATH']?.trim()
  const path = resolve(configured && configured.length > 0 ? configured : defaultJournalPath)
  if (path === resolve(readDatabasePath(env))) throw new Error('journal_path_conflict')
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const db = new DatabaseSync(path)
  try {
    chmodSync(path, 0o600)
  } catch {
    db.close()
    throw new Error('journal_permissions_unavailable')
  }
  return db
}

function createJournal(db: DatabaseSync) {
  return {
    approvals: createActionApprovalStore(db),
    receipts: createActionReceiptStore(db),
  }
}

function oneTarget(
  value: unknown,
): { proposal: MailboxActionProposal; target: ActionTarget } | null {
  const proposal = parseMailboxActionProposal(value)
  if (proposal?.kind !== 'markAsDone' || proposal.targets.length !== 1) return null
  const target = proposal.targets[0]
  return target === undefined ? null : { proposal, target }
}

export interface DoneActionDependencies {
  provider: SparkDoneProviderPort
  /** Must return a file-backed SQLite connection. Memory-only is refused. */
  open: () => DatabaseSync
  enabled: () => boolean
  now: () => Date
  reviewer: () => string
}

/** Serializes all Done calls in this process; SQLite guards other processes. */
export function createDoneActionService(dependencies: DoneActionDependencies) {
  let queue: Promise<unknown> = Promise.resolve()
  const serial = <T>(run: () => Promise<T>): Promise<T> => {
    const result = queue.then(run)
    queue = result.catch(() => undefined)
    return result
  }

  const active = () => {
    try {
      return dependencies.enabled()
    } catch {
      return false
    }
  }

  const journal = (): { db: DatabaseSync; store: Journal } | null => {
    let db: DatabaseSync | undefined
    try {
      db = dependencies.open()
      return { db, store: createJournal(db) }
    } catch {
      try {
        db?.close()
      } catch {
        // Opening failed, so no journal can be used.
      }
      return null
    }
  }

  const operations = {
    async approve(request: DoneApprovalRequest, signal?: AbortSignal): Promise<DoneApprovalResult> {
      if (!active()) return { status: 'blocked', reason: 'disabled' }
      const scoped = oneTarget(request.proposal)
      if (scoped === null) return { status: 'blocked', reason: 'invalid_scope' }
      try {
        if ((await dependencies.provider.preflight(scoped.target, signal)) !== 'ready') {
          return { status: 'blocked', reason: 'preflight' }
        }
      } catch {
        return { status: 'blocked', reason: 'preflight' }
      }
      if (!active()) return { status: 'blocked', reason: 'disabled' }
      const opened = journal()
      if (opened === null) return { status: 'blocked', reason: 'journal_unavailable' }
      try {
        const approval = opened.store.approvals.record(
          scoped.proposal,
          dependencies.reviewer(),
          dependencies.now().toISOString(),
        )
        return { status: 'approved', approval }
      } catch {
        return { status: 'blocked', reason: 'journal_unavailable' }
      } finally {
        opened.db.close()
      }
    },

    async execute(request: DoneExecutionRequest): Promise<DoneExecutionResult> {
      if (!active()) return { status: 'blocked', reason: 'disabled' }
      const opened = journal()
      if (opened === null) return { status: 'blocked', reason: 'journal_unavailable' }
      try {
        const result = await runGuardedMarkAsDone(request, {
          provider: dependencies.provider,
          receipts: opened.store.receipts,
          verifyApproval: (proposal, approval) =>
            Promise.resolve(opened.store.approvals.verify(proposal, approval)),
          enabled: dependencies.enabled,
          now: dependencies.now,
        })
        if (result.status !== 'blocked') return result
        return result.reason === 'receipt_unavailable'
          ? { status: 'blocked', reason: 'journal_unavailable' }
          : { status: 'blocked', reason: result.reason }
      } catch {
        // The executor may have claimed a receipt before failing. The UI must
        // treat a lost response as uncertain and must never retry this write.
        return { status: 'uncertain' }
      } finally {
        opened.db.close()
      }
    },
  }

  return {
    approve: (request: DoneApprovalRequest, signal?: AbortSignal) =>
      serial(() => operations.approve(request, signal)),
    execute: (request: DoneExecutionRequest) => serial(() => operations.execute(request)),
  }
}

let service: ReturnType<typeof createDoneActionService> | undefined

function productionService() {
  service ??= createDoneActionService({
    provider: createSparkDoneProvider({
      transport: createSparkDoneProcessTransport(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
    open: () => openJournal(process.env),
    enabled: () => process.env['SPARK_DONE_ACTIONS_ENABLED'] === '1',
    now: () => new Date(),
    reviewer: localReviewer,
  })
  return service
}

export const approveDoneOnServer = (request: DoneApprovalRequest, signal?: AbortSignal) =>
  productionService().approve(request, signal)

export const executeDoneOnServer = (request: DoneExecutionRequest) =>
  productionService().execute(request)
