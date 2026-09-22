/**
 * The one live inbox this server reads, over the local Spark CLI. There is
 * a single reader, so Spark calls stay one at a time across requests.
 */
import { createProcessTransport } from '../spark/process'
import { createSparkMailReader } from '../spark/reader'
import { createLiveInbox } from './live-inbox.server'

let inbox: ReturnType<typeof createLiveInbox> | undefined

/** Created on first use, so nothing runs until a request asks for mail. */
export function sparkInbox() {
  inbox ??= createLiveInbox({
    reader: createSparkMailReader({
      transport: createProcessTransport(),
      // Spark Desktop prints times in the zone of the Mac it runs on.
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      log: () => undefined,
    }),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  })
  return inbox
}
