/** Spark Desktop's local IPC accepts one CLI command at a time per process. */
let tail: Promise<unknown> = Promise.resolve()

export function runSparkSerial<T>(work: () => Promise<T>): Promise<T> {
  const result = tail.then(work)
  tail = result.catch(() => undefined)
  return result
}
