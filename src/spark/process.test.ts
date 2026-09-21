import { spawn as nodeSpawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { accountsCommand, threadCommand } from './commands'
import { SparkError } from './errors'
import { createProcessTransport, type SparkChildProcess, type SpawnSpark } from './process'

// Tests must never start a real process.
vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => {
    throw new Error('Tests must not spawn real processes')
  }),
}))

class FakeChild extends EventEmitter implements SparkChildProcess {
  readonly stdout = new PassThrough()
  readonly killedWith: NodeJS.Signals[] = []

  kill(signal: NodeJS.Signals) {
    this.killedWith.push(signal)
    queueMicrotask(() => this.emit('close', null))
    return true
  }

  /** Like Node, emits 'close' only after stdout has been read to the end. */
  finish(stdout: string | Buffer, code = 0) {
    this.stdout.once('end', () => this.emit('close', code))
    this.stdout.end(stdout)
  }
}

function setup(limits = { timeoutMs: 1_000, maxOutputBytes: 64 }) {
  const child = new FakeChild()
  const spawn = vi.fn<SpawnSpark>(() => child)
  return { child, spawn, transport: createProcessTransport({ spawn, limits }) }
}

async function failure(promise: Promise<unknown>) {
  const error: unknown = await promise.then(
    () => null,
    (reason: unknown) => reason,
  )
  if (!(error instanceof SparkError)) throw new Error('Expected a SparkError')
  return error
}

afterEach(() => {
  vi.useRealTimers()
})

afterAll(() => {
  expect(nodeSpawn).not.toHaveBeenCalled()
})

describe('createProcessTransport', () => {
  it('runs spark with an argument array and no shell', async () => {
    const { child, spawn, transport } = setup()
    const result = transport(threadCommand('1001'))
    child.finish('Thread: ok\n')

    await expect(result).resolves.toBe('Thread: ok\n')
    expect(spawn).toHaveBeenCalledWith('spark', ['thread', '--', '1001'], {
      shell: false,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    })
  })

  it('reports a non-zero exit without its output', async () => {
    const { child, transport } = setup()
    const result = transport(accountsCommand())
    child.finish('Error: "person@example.org" is not an account', 1)

    const error = await failure(result)
    expect(error).toMatchObject({ code: 'exit_failure', exitCode: 1 })
    expect(error.message).not.toContain('example.org')
  })

  it('kills the process when it times out', async () => {
    vi.useFakeTimers()
    const { child, transport } = setup()
    const result = failure(transport(accountsCommand()))
    await vi.advanceTimersByTimeAsync(1_000)

    expect(await result).toMatchObject({ code: 'timeout' })
    expect(child.killedWith).toEqual(['SIGKILL'])
  })

  it('kills the process when output exceeds the limit', async () => {
    const { child, transport } = setup()
    const result = failure(transport(accountsCommand()))
    child.stdout.write('x'.repeat(65))

    expect(await result).toMatchObject({ code: 'output_too_large' })
    expect(child.killedWith).toEqual(['SIGKILL'])
  })

  it('accepts output exactly at the limit', async () => {
    const { child, transport } = setup()
    const result = transport(accountsCommand())
    child.finish('x'.repeat(64))

    await expect(result).resolves.toHaveLength(64)
  })

  it('kills the process when the call is cancelled', async () => {
    const { child, transport } = setup()
    const controller = new AbortController()
    const result = failure(transport(accountsCommand(), controller.signal))
    controller.abort()

    expect(await result).toMatchObject({ code: 'aborted' })
    expect(child.killedWith).toEqual(['SIGKILL'])
  })

  it('does not start a process for an already cancelled call', async () => {
    const { spawn, transport } = setup()

    expect(await failure(transport(accountsCommand(), AbortSignal.abort()))).toMatchObject({
      code: 'aborted',
    })
    expect(spawn).not.toHaveBeenCalled()
  })

  it.each([
    ['ENOENT', 'not_installed'],
    ['EACCES', 'spawn_failed'],
  ])('maps a %s start failure', async (code, expected) => {
    const { child, transport } = setup()
    const result = failure(transport(accountsCommand()))
    child.emit('error', Object.assign(new Error('spawn spark'), { code }))

    expect(await result).toMatchObject({ code: expected })
  })

  it('maps a synchronous start failure', async () => {
    const spawn = vi.fn<SpawnSpark>(() => {
      throw new TypeError('invalid spawn arguments')
    })
    const transport = createProcessTransport({ spawn })

    expect(await failure(transport(accountsCommand()))).toMatchObject({ code: 'spawn_failed' })
  })

  it('rejects output that is not UTF-8', async () => {
    const { child, transport } = setup()
    const result = failure(transport(accountsCommand()))
    child.finish(Buffer.from([0xff, 0xfe]))

    expect(await result).toMatchObject({ code: 'malformed_output' })
  })
})
