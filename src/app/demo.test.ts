import { describe, expect, it } from 'vitest'
import {
  completeDemoMessage,
  demoMailboxes,
  demoMessages,
  demoWorkflows,
  loadDemoBody,
} from './demo'

const ids = (items: readonly { id: string }[]) => items.map((item) => item.id)

describe('demo data', () => {
  it('gives every message a unique id', () => {
    expect(new Set(ids(demoMessages)).size).toBe(demoMessages.length)
  })

  it('puts every message in a known workflow and mailbox', () => {
    for (const message of demoMessages) {
      expect(ids(demoWorkflows)).toContain(message.workflow)
      expect(ids(demoMailboxes)).toContain(message.mailbox)
    }
  })

  it('uses only reserved example addresses and marks every subject as a sample', () => {
    for (const message of demoMessages) {
      expect(message.address).toMatch(/@[\w-]+\.example$/)
      expect(message.subject).toMatch(/^Sample: /)
    }
  })
})

describe('loadDemoBody', () => {
  it('keeps bodies out of the rows and loads one when asked', async () => {
    for (const message of demoMessages) expect(message).not.toHaveProperty('body')
    const body = await loadDemoBody('demo-3', { signal: new AbortController().signal })

    expect(body?.id).toBe('demo-3')
    expect(body?.text).toContain('meet by the lake')
  })
})

describe('completeDemoMessage', () => {
  it('moves only the completed message to Done', () => {
    const [first, ...rest] = demoMessages
    if (!first) throw new Error('No demo messages')
    const result = completeDemoMessage(demoMessages, first.id)

    expect(result[0]).toMatchObject({
      id: first.id,
      workflow: 'done',
      status: { label: 'Completed', tone: 'done' },
    })
    expect(result.slice(1)).toEqual(rest)
  })

  it('leaves the original list unchanged', () => {
    const before = structuredClone(demoMessages)
    completeDemoMessage(demoMessages, 'demo-1')

    expect(demoMessages).toEqual(before)
  })
})
