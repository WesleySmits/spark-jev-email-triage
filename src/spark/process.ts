/**
 * Runs Spark commands as a subprocess. This is the only module that starts
 * processes. It never uses a shell and never reads stderr, whose messages
 * can name accounts.
 */
import { spawn as nodeSpawn } from 'node:child_process'
import type { Readable } from 'node:stream'
import { sparkArguments, type SparkCommand } from './commands'
import { SparkError } from './errors'
import { runSparkSerial } from './queue'

/** Runs one Spark command and resolves with its stdout. */
export type SparkTransport = (command: SparkCommand, signal?: AbortSignal) => Promise<string>

export interface SparkChildProcess {
  readonly stdout: Readable | null
  kill(signal: NodeJS.Signals): boolean
  once(event: 'error', listener: (error: Error) => void): this
  once(event: 'close', listener: (code: number | null) => void): this
}

export type SpawnSpark = (
  file: 'spark',
  args: readonly string[],
  options: { shell: false; stdio: ['ignore', 'pipe', 'ignore']; windowsHide: true },
) => SparkChildProcess

export interface ProcessLimits {
  timeoutMs: number
  maxOutputBytes: number
}

export const defaultLimits: ProcessLimits = { timeoutMs: 15_000, maxOutputBytes: 4 * 1024 * 1024 }

export function createProcessTransport({
  spawn = nodeSpawn,
  limits = defaultLimits,
}: { spawn?: SpawnSpark; limits?: ProcessLimits } = {}): SparkTransport {
  return (command, signal) =>
    runSparkSerial(() => run(spawn, sparkArguments(command), limits, signal))
}

function run(
  spawn: SpawnSpark,
  args: readonly string[],
  limits: ProcessLimits,
  signal: AbortSignal | undefined,
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new SparkError('aborted'))
      return
    }
    let child: SparkChildProcess
    try {
      child = spawn('spark', args, {
        shell: false,
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      })
    } catch {
      reject(new SparkError('spawn_failed'))
      return
    }
    // The first failure wins. Killing the child still ends in 'close', so
    // the promise settles only once the process is gone.
    let failure: SparkError | null = null
    const stop = (error: SparkError) => {
      failure ??= error
      child.kill('SIGKILL')
    }
    const output = collectOutput(child, limits.maxOutputBytes, stop)
    const release = watchLimits(limits.timeoutMs, signal, stop)
    let settled = false
    const settle = (result: string | SparkError) => {
      if (settled) return
      settled = true
      release()
      if (typeof result === 'string') resolve(result)
      else reject(result)
    }

    child.once('error', (error) => {
      settle(failure ?? spawnError(error))
    })
    child.once('close', (code) => {
      if (failure) settle(failure)
      else if (code === 0) settle(decode(output()))
      else settle(new SparkError('exit_failure', null, code))
    })
  })
}

/** Stops the call on timeout or abort. Returns a function that disarms both. */
function watchLimits(
  timeoutMs: number,
  signal: AbortSignal | undefined,
  stop: (error: SparkError) => void,
): () => void {
  const onAbort = () => {
    stop(new SparkError('aborted'))
  }
  const timer = setTimeout(() => {
    stop(new SparkError('timeout'))
  }, timeoutMs)
  signal?.addEventListener('abort', onAbort, { once: true })
  return () => {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

/** Buffers stdout up to `maxBytes`; calls `onOverflow` once past it. */
function collectOutput(
  child: SparkChildProcess,
  maxBytes: number,
  onOverflow: (error: SparkError) => void,
): () => Buffer {
  const chunks: Buffer[] = []
  let size = 0
  const onData = (chunk: Buffer) => {
    size += chunk.length
    if (size <= maxBytes) {
      chunks.push(chunk)
      return
    }
    chunks.length = 0
    child.stdout?.off('data', onData)
    child.stdout?.resume()
    onOverflow(new SparkError('output_too_large'))
  }
  child.stdout?.on('data', onData)
  return () => Buffer.concat(chunks)
}

function spawnError(error: Error): SparkError {
  return 'code' in error && error.code === 'ENOENT'
    ? new SparkError('not_installed')
    : new SparkError('spawn_failed')
}

function decode(output: Buffer): string | SparkError {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(output)
  } catch {
    return new SparkError('malformed_output', 'output is not valid UTF-8')
  }
}
