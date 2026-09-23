/**
 * The `pnpm eval:report` command: the quality report for a run somebody
 * already made, counted again from that run's snapshot.
 *
 * It reads one file and prints one report. It calls no provider, reads no
 * mailbox, opens no database and writes nothing at all, so anyone holding a
 * snapshot can check the figures a run reported without a key, a network or
 * this computer. That is the whole point of writing snapshots down.
 *
 * Output is the report and, where a snapshot cannot be counted, a
 * content-free reason. Neither carries mail: a snapshot holds none, and the
 * report names fixtures, categories and counts. A file that cannot be read
 * or parsed is reported as such without echoing what was in it; only the
 * field paths of a schema failure are printed, as elsewhere in this
 * repository.
 */
import { readFileSync } from 'node:fs'
import { formatQualityReport } from './quality-report-text'
import { summarizeQuality } from './quality-report'
import { replayRunSnapshot, runSnapshotSchema } from './run-snapshot'

export const exitCodes = { ok: 0, failed: 1, usage: 64 } as const

const usage = 'usage: pnpm eval:report <snapshot.json>'

export function main(args: readonly string[], print: (line: string) => void): number {
  const [path, ...rest] = args
  if (path === undefined || rest.length > 0) {
    print(usage)
    return exitCodes.usage
  }
  const file = read(path)
  if (file === null) {
    print('could not read that snapshot')
    return exitCodes.failed
  }
  const snapshot = runSnapshotSchema.safeParse(file)
  if (!snapshot.success) {
    const fields = snapshot.error.issues.map((issue) => issue.path.join('.'))
    print(`not a run snapshot: ${fields.join(', ')}`)
    return exitCodes.failed
  }
  const replay = replayRunSnapshot(snapshot.data)
  if (replay.status === 'refused') {
    print(`refused ${replay.reason}`)
    return exitCodes.failed
  }
  print(formatQualityReport(summarizeQuality(replay.observations)))
  return exitCodes.ok
}

/** The file as JSON, or `null` when it is missing, unreadable or not JSON. */
function read(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}
