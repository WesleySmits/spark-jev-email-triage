import { describe, expect, it } from 'vitest'
import { threadSchema } from './email'
import { independentlyObservedCopies, syntheticThreads } from './fixtures'

const threads = Object.values(syntheticThreads).map((thread) => threadSchema.parse(thread))
const observedThreads = Object.values(independentlyObservedCopies).map(({ thread }) =>
  threadSchema.parse(thread),
)

// Second-level domains reserved for documentation (RFC 2606) and reserved
// top-level domains (RFC 2606, RFC 6761).
const reservedDomain = /(^|\.)(example\.(com|org|net)|example|test|invalid)$/

describe('syntheticThreads', () => {
  it('parse as valid threads with unique ids', () => {
    const messageIds = threads.flatMap((thread) => thread.messages.map((message) => message.id))

    expect(new Set(threads.map((thread) => thread.id)).size).toBe(threads.length)
    expect(new Set(messageIds).size).toBe(messageIds.length)
  })

  it('use only reserved domains for addresses and links', () => {
    const domains = [...threads, ...observedThreads].flatMap((thread) =>
      thread.messages.flatMap((message) => [
        ...[message.from, ...message.to, ...message.cc].map(({ address }) => address.split('@')[1]),
        ...[...(message.bodyText ?? '').matchAll(/https?:\/\/([^/\s]+)/g)].map((match) => match[1]),
      ]),
    )

    expect(domains).toContain('verify.examp1e-account.test')
    for (const domain of domains) {
      expect(domain).toMatch(reservedDomain)
    }
  })

  it('include a thread with several messages', () => {
    expect(threadSchema.parse(syntheticThreads.multiMessage).messages).toHaveLength(3)
  })
})

describe('independentlyObservedCopies', () => {
  it('put the same provider message id in two mailboxes', () => {
    const [first, second] = Object.values(independentlyObservedCopies)

    expect(first?.copy.messageId).toBe(second?.copy.messageId)
    expect(first?.copy.mailboxId).not.toBe(second?.copy.mailboxId)
  })
})
