/**
 * The complete set of Spark CLI calls this app can make. Every command is
 * read-only. Drafts, comments, actions, contact actions, attachment
 * downloads, and other subcommands cannot be expressed.
 *
 * Arguments are validated and branded before a command can be built, and
 * positional values follow `--`, so no value can become a flag.
 */
import { z } from 'zod'
import { SparkError } from './errors'

export const maxListLimit = 100

const messageIdSchema = z
  .string()
  .regex(/^[1-9][0-9]{0,18}$/)
  .brand<'SparkMessageId'>()

// Spark addresses accounts and shared inboxes by their email address.
const mailboxIdSchema = z
  .email()
  .refine((value) => !value.startsWith('-'))
  .brand<'SparkMailboxId'>()

const listLimitSchema = z.int().min(1).max(maxListLimit).brand<'SparkListLimit'>()
const pageSchema = z.int().min(1).max(20).brand<'SparkPage'>()

type SparkMessageId = z.infer<typeof messageIdSchema>
type SparkMailboxId = z.infer<typeof mailboxIdSchema>
type SparkListLimit = z.infer<typeof listLimitSchema>
type SparkPage = z.infer<typeof pageSchema>

export type SparkCommand =
  | { readonly name: 'accounts' }
  | {
      readonly name: 'emails'
      readonly mailboxId: SparkMailboxId
      readonly limit: SparkListLimit
      readonly page: SparkPage
    }
  | { readonly name: 'thread'; readonly messageId: SparkMessageId }

function validate<S extends z.ZodType>(schema: S, value: unknown, field: string): z.output<S> {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new SparkError('invalid_input', field)
  }
  return result.data
}

export const accountsCommand = (): SparkCommand => ({ name: 'accounts' })

export const validateMailboxId = (mailboxId: string): SparkMailboxId =>
  validate(mailboxIdSchema, mailboxId, 'mailboxId')

export const emailsCommand = (mailboxId: string, limit: number, page = 1): SparkCommand => ({
  name: 'emails',
  mailboxId: validateMailboxId(mailboxId),
  limit: validate(listLimitSchema, limit, 'limit'),
  page: validate(pageSchema, page, 'page'),
})

export const threadCommand = (messageId: string): SparkCommand => ({
  name: 'thread',
  messageId: validate(messageIdSchema, messageId, 'messageId'),
})

/** The argument vector for `spark`, never joined into a shell string. */
export function sparkArguments(command: SparkCommand): readonly string[] {
  switch (command.name) {
    case 'accounts':
      return ['accounts']
    case 'emails':
      return [
        'emails',
        '--page-size',
        String(command.limit),
        ...(command.page === 1 ? [] : ['--page', String(command.page)]),
        '--order',
        'descending',
        '--',
        `${command.mailboxId}:Inbox`,
      ]
    case 'thread':
      return ['thread', '--', command.messageId]
  }
}
