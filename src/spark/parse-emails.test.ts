import { describe, expect, it } from 'vitest'
import { emailsTable } from './fixtures'
import { localTimeZone } from './local-time'
import { parseEmailList } from './parse-emails'

// Synthetic mail only: every address uses a reserved domain.
const context = { mailboxId: 'support@example.com', limit: 10, localTime: localTimeZone('UTC') }

/** Parses one row with this From and Subject cell, as Spark would print them. */
function listOne(from: string, subject: string) {
  const [listing] = parseEmailList(
    emailsTable([['1001', 'support@example.com', from, '2026-01-10 12:05', subject, '']]),
    context,
  )
  if (listing === undefined) throw new Error('Expected one listing')
  return listing
}

// Spark shows at most 30 characters of From and 50 of Subject.
const longSubject = 'Your monthly statement for account EX-1002 is ready to view online'

describe('parseEmailList sender and subject', () => {
  it('keeps a sender and subject that fit whole', () => {
    expect(listOne('Sam Customer <sam@example.org>', 'Order EX-1002')).toMatchObject({
      from: { address: 'sam@example.org', name: 'Sam Customer' },
      sender: { text: 'Sam Customer', cut: false },
      subject: { text: 'Order EX-1002', cut: false },
    })
  })

  // The shape of most real rows: a name and address longer than the column.
  it('keeps the whole name of a sender whose address Spark cut', () => {
    expect(listOne('Jordan Example <jordan.example@company.example>', longSubject)).toMatchObject({
      from: null,
      sender: { text: 'Jordan Example', cut: false },
      subject: { text: longSubject.slice(0, 49), cut: true },
    })
  })

  it('reads a quoted name with a comma before a cut address', () => {
    expect(listOne('"Customer, Sample" <customer@example.org>', 'Hi')).toMatchObject({
      from: null,
      sender: { text: 'Customer, Sample', cut: false },
    })
  })

  it.each([
    [
      'a name cut before its address',
      'Example Weekly Newsletter Team <news@newsletter.example>',
      'Example Weekly Newsletter Tea',
    ],
    [
      'a name cut inside its quotes',
      '"Customer-Relations, Department" <crd@example.org>',
      'Customer-Relations, Departme',
    ],
    ['a bare address', 'notifications-noreply@monitoring.example', 'notifications-noreply@monitor'],
    [
      'an address with no name',
      '<notifications-noreply@monitoring.example>',
      'notifications-noreply@monito',
    ],
    [
      'an address after an empty name',
      '"" <someone.with.a.long.address@example.org>',
      'someone.with.a.long.addre',
    ],
  ])('keeps the visible start of %s, marked cut', (_, from, text) => {
    expect(listOne(from, 'Hi')).toMatchObject({ from: null, sender: { text, cut: true } })
  })

  it('shows a sender without an address as Spark printed it', () => {
    expect(listOne('Sam Customer', 'Hi')).toMatchObject({
      from: null,
      sender: { text: 'Sam Customer', cut: false },
    })
    expect(listOne('Sam <not an address>', 'Hi')).toMatchObject({
      from: null,
      sender: { text: 'Sam <not an address>', cut: false },
    })
  })

  it('keeps Unicode senders and subjects whole', () => {
    const subject = 'Bestelling ontvangen ✓ 注文 — شكرا 🇳🇱'
    expect(listOne('Zoë Ünal <zoe@example.org>', subject)).toMatchObject({
      from: { address: 'zoe@example.org', name: 'Zoë Ünal' },
      sender: { text: 'Zoë Ünal', cut: false },
      subject: { text: subject, cut: false },
    })
  })

  it('never ends a cut value in half a character', () => {
    // 48 characters and an emoji: the cut after 49 code units splits it.
    const subject = `${'x'.repeat(48)}📦 and more`
    expect(listOne('sam@example.org', subject).subject).toEqual({ text: 'x'.repeat(48), cut: true })
  })

  it('keeps a value exactly as wide as the column whole', () => {
    const from = `${'a'.repeat(18)}@example.org`
    const subject = 's'.repeat(50)
    expect(listOne(from, subject)).toMatchObject({
      from: { address: from, name: null },
      sender: { text: from, cut: false },
      subject: { text: subject, cut: false },
    })
  })

  it.each([
    ['blank', '', ''],
    ['only a cut mark', '…', '…'],
    ['only an open quote and a cut mark', '"…', '…'],
  ])('treats %s cells as missing', (_, from, subject) => {
    expect(listOne(from, subject)).toMatchObject({ from: null, sender: null, subject: null })
  })
})
