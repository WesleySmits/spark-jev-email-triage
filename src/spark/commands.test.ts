import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  accountsCommand,
  emailsCommand,
  maxListLimit,
  sparkArguments,
  threadCommand,
  type SparkCommand,
} from './commands'

describe('Spark commands', () => {
  it('can only express read-only subcommands', () => {
    expectTypeOf<SparkCommand['name']>().toEqualTypeOf<'accounts' | 'emails' | 'thread'>()
  })

  it.each([
    [accountsCommand(), ['accounts']],
    [
      emailsCommand('Support@Example.com', 25),
      ['emails', '--page-size', '25', '--order', 'descending', '--', 'Support@Example.com:Inbox'],
    ],
    [
      emailsCommand('Support@Example.com', 25, 2),
      [
        'emails',
        '--page-size',
        '25',
        '--page',
        '2',
        '--order',
        'descending',
        '--',
        'Support@Example.com:Inbox',
      ],
    ],
    [threadCommand('1001'), ['thread', '--', '1001']],
  ])('builds the argument vector for %o', (command, expected) => {
    expect(sparkArguments(command)).toEqual(expected)
  })

  it.each([
    ['a flag', '--download-attachments'],
    ['a negative number', '-1'],
    ['a deep link', 'https://sparkmailapp.com/dpl/bl?token=abc'],
    ['shell syntax', '1001; spark action archive 1001'],
    ['a leading zero', '0'],
    ['an empty string', ''],
  ])('rejects %s as a message id', (_, messageId) => {
    expect(() => threadCommand(messageId)).toThrow(
      expect.objectContaining({ code: 'invalid_input', detail: 'messageId' }),
    )
  })

  it.each([
    ['a flag', '--new-senders'],
    ['a folder suffix', 'support@example.com:Archive'],
    ['a team name', 'Support Team'],
    ['a leading dash', '-support@example.com'],
  ])('rejects %s as a mailbox id', (_, mailboxId) => {
    expect(() => emailsCommand(mailboxId, 10)).toThrow(
      expect.objectContaining({ code: 'invalid_input', detail: 'mailboxId' }),
    )
  })

  it.each([0, -1, 1.5, maxListLimit + 1])('rejects %d as a list limit', (limit) => {
    expect(() => emailsCommand('support@example.com', limit)).toThrow(
      expect.objectContaining({ code: 'invalid_input', detail: 'limit' }),
    )
  })

  it.each([0, -1, 1.5, 21])('rejects %d as a page', (page) => {
    expect(() => emailsCommand('support@example.com', 10, page)).toThrow(
      expect.objectContaining({ code: 'invalid_input', detail: 'page' }),
    )
  })
})
