import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InboxSummary } from './inbox'
import { ReviewDesk, type DeskView } from './review-desk'

const server = vi.hoisted(() => ({
  getLiveInbox: vi.fn(),
  getLiveBody: vi.fn(),
  getSparkReadiness: vi.fn(),
}))

vi.mock('./live-inbox.functions', () => ({
  getLiveInbox: server.getLiveInbox,
  getLiveBody: server.getLiveBody,
}))

vi.mock('./spark-readiness.functions', () => ({
  getSparkReadiness: server.getSparkReadiness,
}))

const row = (messageId: string, mailbox: string): InboxSummary => ({
  id: `${mailbox} copy of ${messageId}`,
  messageId,
  workflow: 'inbox',
  mailbox,
  sender: 'Sample Sender',
  time: '09:00',
  subject: `Subject ${messageId}`,
  snippet: '',
  account: { marker: 'studio', label: mailbox },
  status: { label: 'Not triaged', tone: 'neutral' },
})

const listed: DeskView = {
  status: 'ready',
  readAt: '09:42',
  mailboxes: [{ id: 'one@mail.example', icon: 'inbox', label: 'one@mail.example' }],
  messages: [row('11', 'one@mail.example'), row('11', 'two@mail.example')],
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('ReviewDesk.open', () => {
  it('hands the page the reading the server made, rows without bodies', async () => {
    server.getLiveInbox.mockResolvedValueOnce(listed)

    await expect(ReviewDesk.open()).resolves.toEqual(listed)
    expect(server.getLiveInbox).toHaveBeenCalledOnce()
  })

  it('passes on why there is no mail, without inventing any', async () => {
    server.getLiveInbox.mockResolvedValueOnce({ status: 'unavailable', reason: 'missing' })

    await expect(ReviewDesk.open()).resolves.toEqual({ status: 'unavailable', reason: 'missing' })
  })

  it('reports an app server that did not answer as unreachable instead of failing', async () => {
    server.getLiveInbox.mockRejectedValueOnce(new Error('fetch failed'))

    await expect(ReviewDesk.open()).resolves.toEqual({
      status: 'unavailable',
      reason: 'unreachable',
    })
  })

  it('reads again on every open, so refreshing shows what Spark has now', async () => {
    server.getLiveInbox.mockResolvedValueOnce(listed).mockResolvedValueOnce({
      ...listed,
      readAt: '09:44',
    })

    await ReviewDesk.open()

    await expect(ReviewDesk.open()).resolves.toMatchObject({ readAt: '09:44' })
    expect(server.getLiveInbox).toHaveBeenCalledTimes(2)
  })
})

describe('ReviewDesk.focus', () => {
  it('reads the opened row through the mailbox its own summary names', async () => {
    const id = 'two@mail.example copy of 11'
    server.getLiveBody.mockResolvedValueOnce({ id, text: 'Hello' })
    const { signal } = new AbortController()

    await expect(ReviewDesk.focus(listed)(id, { signal })).resolves.toEqual({ id, text: 'Hello' })
    expect(server.getLiveBody).toHaveBeenCalledExactlyOnceWith({
      data: { mailbox: 'two@mail.example', id: '11' },
      signal,
    })
  })

  it('resolves to null for a row the reading did not list, without asking', async () => {
    const { signal } = new AbortController()

    await expect(
      ReviewDesk.focus(listed)('other@mail.example copy of 11', { signal }),
    ).resolves.toBeNull()
    expect(server.getLiveBody).not.toHaveBeenCalled()
  })

  it('asks for nothing while there is no reading to focus in', async () => {
    const { signal } = new AbortController()
    const focus = ReviewDesk.focus({ status: 'unavailable', reason: 'unreachable' })

    await expect(focus('one@mail.example copy of 11', { signal })).resolves.toBeNull()
    expect(server.getLiveBody).not.toHaveBeenCalled()
  })

  it('lets a failed body read reach the page, so it can offer a retry', async () => {
    server.getLiveBody.mockRejectedValueOnce(new Error('The message could not be read'))
    const { signal } = new AbortController()

    await expect(
      ReviewDesk.focus(listed)('one@mail.example copy of 11', { signal }),
    ).rejects.toThrow()
  })
})

describe('ReviewDesk.probe', () => {
  it("asks only whether Spark answers, with the caller's signal", async () => {
    server.getSparkReadiness.mockResolvedValueOnce({ status: 'ready' })
    const { signal } = new AbortController()

    await expect(ReviewDesk.probe(signal)).resolves.toEqual({ status: 'ready' })
    expect(server.getSparkReadiness).toHaveBeenCalledExactlyOnceWith({ signal })
  })
})

describe('ReviewDesk.workflows', () => {
  it('offers the one workflow live mail has while it is not triaged', () => {
    expect(ReviewDesk.workflows).toEqual([{ id: 'inbox', icon: 'inbox', label: 'Recent mail' }])
  })
})
