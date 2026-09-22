import { describe, expect, expectTypeOf, it } from 'vitest'
import type { WorkbenchMessage } from '../components/pages/WorkbenchPage/workbench'
import {
  fixtureBodyLoader,
  inboxSummarySchema,
  splitFixtures,
  type BodyLoader,
  type InboxFixture,
  type InboxSummary,
} from './inbox'

const summary: InboxSummary = {
  id: 'a',
  workflow: 'review',
  sender: 'Sender A',
  time: '09:00',
  subject: 'Subject A',
  snippet: 'Snippet A',
  account: { marker: 'studio', label: 'Studio' },
  status: { label: 'Needs review', tone: 'review' },
}

const fixtures: readonly InboxFixture[] = [
  { ...summary, body: 'Body A' },
  { ...summary, id: 'b', body: null },
]

const signal = () => new AbortController().signal

describe('inboxSummarySchema', () => {
  it('fits the rows the workbench lists', () => {
    expectTypeOf<InboxSummary>().toExtend<WorkbenchMessage>()
  })

  it('rejects a summary that carries a body', () => {
    expect(inboxSummarySchema.safeParse({ ...summary, body: 'Secret' }).success).toBe(false)
  })

  it('rejects an unknown account marker or tone', () => {
    const account = { ...summary, account: { marker: 'other', label: 'Other' } }
    const status = { ...summary, status: { label: 'Odd', tone: 'danger' } }
    expect(inboxSummarySchema.safeParse(account).success).toBe(false)
    expect(inboxSummarySchema.safeParse(status).success).toBe(false)
  })
})

describe('splitFixtures', () => {
  it('keeps bodies out of the summaries', () => {
    const { summaries, bodies } = splitFixtures(fixtures)

    expect(summaries).toEqual([summary, { ...summary, id: 'b' }])
    for (const item of summaries) expect(item).not.toHaveProperty('body')
    expect([...bodies]).toEqual([
      ['a', 'Body A'],
      ['b', null],
    ])
  })
})

describe('fixtureBodyLoader', () => {
  const { bodies } = splitFixtures(fixtures)

  it('loads one body, naming its message', async () => {
    await expect(fixtureBodyLoader(bodies)('a', { signal: signal() })).resolves.toEqual({
      id: 'a',
      text: 'Body A',
    })
  })

  it('resolves to null for a message without a body or an unknown id', async () => {
    const load: BodyLoader = fixtureBodyLoader(bodies)
    await expect(load('b', { signal: signal() })).resolves.toBeNull()
    await expect(load('zz', { signal: signal() })).resolves.toBeNull()
  })

  it('rejects for a failing id, as a provider failure', async () => {
    const load = fixtureBodyLoader(bodies, { failing: new Set(['a']) })
    await expect(load('a', { signal: signal() })).rejects.toThrow('unavailable')
  })

  it('stops when aborted', async () => {
    const controller = new AbortController()
    const loading = fixtureBodyLoader(bodies, { delay: () => 1000 })('a', {
      signal: controller.signal,
    })
    controller.abort()
    await expect(loading).rejects.toThrow()
  })
})
