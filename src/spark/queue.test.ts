import { describe, expect, it } from 'vitest'
import { runSparkSerial } from './queue'

describe('Spark process queue', () => {
  it('starts the next call only after the first settles', async () => {
    const events: string[] = []
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const first = runSparkSerial(async () => {
      events.push('first-start')
      await held
      events.push('first-end')
    })
    const second = runSparkSerial(() => {
      events.push('second-start')
      return Promise.resolve()
    })
    await Promise.resolve()
    expect(events).toEqual(['first-start'])
    release()
    await Promise.all([first, second])
    expect(events).toEqual(['first-start', 'first-end', 'second-start'])
  })

  it('continues after a rejected call without hiding that rejection', async () => {
    const first = runSparkSerial(() => Promise.reject(new Error('failed')))
    const second = runSparkSerial(() => Promise.resolve('next'))
    await expect(first).rejects.toThrow('failed')
    await expect(second).resolves.toBe('next')
  })
})
