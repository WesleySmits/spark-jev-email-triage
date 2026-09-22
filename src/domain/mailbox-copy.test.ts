import { describe, expect, expectTypeOf, it } from 'vitest'
import { mailboxCopyId, type MailboxCopyRef } from './mailbox-copy'

describe('MailboxCopyRef', () => {
  it('is an immutable mailbox and message id pair', () => {
    expectTypeOf<MailboxCopyRef>().toEqualTypeOf<
      Readonly<{ mailboxId: string; messageId: string }>
    >()
  })
})

describe('mailboxCopyId', () => {
  it('tells apart copies of one message id in two mailboxes', () => {
    const one = mailboxCopyId({ mailboxId: 'one@mail.example', messageId: '11' })
    const two = mailboxCopyId({ mailboxId: 'two@mail.example', messageId: '11' })

    expect(one).not.toBe(two)
  })

  it('is the same for the same copy', () => {
    expect(mailboxCopyId({ mailboxId: 'one@mail.example', messageId: '11' })).toBe(
      mailboxCopyId({ mailboxId: 'one@mail.example', messageId: '11' }),
    )
  })

  it.each([
    [
      { mailboxId: 'a b', messageId: 'c' },
      { mailboxId: 'a', messageId: 'b c' },
    ],
    [
      { mailboxId: 'a"', messageId: 'b' },
      { mailboxId: 'a', messageId: '"b' },
    ],
    [
      { mailboxId: 'a,b', messageId: 'c' },
      { mailboxId: 'a', messageId: 'b,c' },
    ],
  ])('never lets a separator in one part collide: %j and %j', (a, b) => {
    expect(mailboxCopyId(a)).not.toBe(mailboxCopyId(b))
  })
})
