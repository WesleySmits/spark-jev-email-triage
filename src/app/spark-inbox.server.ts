/**
 * The one Spark reader this server uses, over the local Spark CLI, and the
 * live inbox and readiness probe on top of it. Sharing the reader keeps
 * Spark calls one at a time across requests.
 *
 * The inbox is given the stored-row lookup, so the thread a body read
 * returns decides whether what was judged still holds, and the row comes back
 * with whatever a person decided about it. Reading mail stays read-only: the
 * lookup opens the local database read-only and classifies nothing.
 */
import { createProcessTransport } from '../spark/process'
import { createSparkMailReader } from '../spark/reader'
import { createLiveInbox } from './live-inbox.server'
import { createSparkReadiness } from './spark-readiness.server'
import { verifiedRowFor } from './stored-classifications.server'

// Spark Desktop prints times in the zone of the Mac it runs on.
const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone

let reader: ReturnType<typeof createSparkMailReader> | undefined
let inbox: ReturnType<typeof createLiveInbox> | undefined
let readiness: ReturnType<typeof createSparkReadiness> | undefined

/** Created on first use, so nothing runs until a request asks for mail. */
function sparkReader() {
  reader ??= createSparkMailReader({
    transport: createProcessTransport(),
    timeZone: timeZone(),
    log: () => undefined,
  })
  return reader
}

export function sparkInbox() {
  inbox ??= createLiveInbox({
    reader: sparkReader(),
    timeZone: timeZone(),
    verify: (observed) => verifiedRowFor(observed),
  })
  return inbox
}

export function sparkReadiness() {
  readiness ??= createSparkReadiness({ reader: sparkReader() })
  return readiness
}
