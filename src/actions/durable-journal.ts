import type { DatabaseSync } from 'node:sqlite'

/** Action state must survive a process crash before Spark can be called. */
export function requireDurableJournal(db: DatabaseSync): void {
  const main = db
    .prepare('PRAGMA database_list')
    .all()
    .find((row) => row['name'] === 'main')
  if (typeof main?.['file'] !== 'string' || main['file'].length === 0) {
    throw new Error('action_storage_not_durable')
  }
  db.exec('PRAGMA synchronous = FULL')
}
