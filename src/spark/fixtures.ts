/**
 * Synthetic `spark` stdout for tests, shaped like Spark 1.3.1 output. All
 * people, addresses, and content are invented, and every domain is reserved
 * by RFC 2606 or RFC 6761.
 */

// Team and shared inbox lines follow the documented layout; no shared inbox
// was available to observe.
export const accountsOutput = `
Email Account: Ops@Example.com "Operations" (Access: triage)
├── Calendar: ops@example.com - Default (ops@example.com:ops@example.com)
└── Team: Support Team
    └── Shared Inbox: support@example.com "Support (Shared)" (Access: read-only)

Email Account: person@example.org "Person" (Access: send)

Email Account: archive@example.net (Access: disabled)
└── Calendar: Holidays - Subscribed (archive@example.net:Holidays)

Email Account: other@example.net "Other" (Access: triage)
└── Team: Support Team
    └── Shared Inbox: support@example.com "Support (Shared)" (Access: read-only)
`

// Column widths match Spark: values longer than the column lose their end
// to `…`, and every cell is padded to the column width.
const widths = [7, 27, 32, 18, 52] as const

const cell = (value: string, width: number) =>
  (value.length > width - 2 ? `${value.slice(0, width - 3)}…` : value).padEnd(width)

const tableRow = (values: readonly [string, string, string, string, string, string]) =>
  `  ${widths.map((width, index) => cell(values[index] ?? '', width)).join('')}${values[5]}`

export const emailsTable = (
  rows: readonly (readonly [string, string, string, string, string, string])[],
) =>
  [
    '',
    'Emails in support@example.com:Inbox',
    'New Senders: 2 (use --new-senders to view them)',
    '',
    tableRow(['ID', 'Account', 'From', 'Date', 'Subject', 'Flags']).trimEnd(),
    ...rows.map((row) => tableRow(row).trimEnd()),
    '',
    `Page 1 of 4 (${String(rows.length * 4)} total emails)`,
    '',
  ].join('\n')

export const emailsOutput = emailsTable([
  [
    '1003',
    'support@example.com',
    'Sam Customer <sam@example.org>',
    '2026-01-10 12:05',
    'Damaged item in order EX-1002 🇳🇱',
    'unread',
  ],
  [
    '1002',
    'support@example.com',
    'alerts@monitoring.example',
    '2026-07-01 09:30',
    'A subject that is far too long to fit in the subject column of the list',
    'unread, attachment',
  ],
  [
    '1001',
    'a-very-long-shared-inbox-address@example.com',
    'Example Weekly Newsletter Team <news@newsletter.example>',
    // Skipped by the Europe/Amsterdam daylight saving change.
    '2026-03-29 02:30',
    '',
    '',
  ],
])

export const emptyEmailsOutput = `
Emails in support@example.com:Inbox (filter: newer_than:1d)

No emails found.
`

const rule = '─'.repeat(72)

interface SyntheticMessage {
  id: string
  from: string
  date: string
  body: string
}

/** A `spark thread` output with one email block per message. */
export const threadText = (subject: string, messages: readonly SyntheticMessage[]) =>
  [
    `Thread: ${subject}`,
    `Messages: ${String(messages.length)}`,
    ...messages.flatMap((message) => [
      rule,
      '',
      `  ID: ${message.id}`,
      `  Subject: ${subject}`,
      `  From: ${message.from}`,
      '  To: support@example.com',
      `  Date: ${message.date}`,
      '  Type: Email',
      '',
      `  ${message.body}`,
      '',
    ]),
  ].join('\n')

// Only `Type: Email` has been observed; the `Comment` block models a team
// comment. The second message's body contains a line that looks like an
// attachment heading but is not followed by a table.
export const threadOutput = `Thread: Damaged item in order EX-1002
Messages: 3
Labels: support@example.com:Orders
Link: https://sparkmailapp.com/dpl/bl?token=c3ludGhldGljLXRva2Vu
${rule}

  ID: 1001
  Subject: Damaged item in order EX-1002
  From: "Customer, Sample" <Customer@Example.org>
  Reply-To: Sample Customer <customer@example.org>
  To: Example Support <support@example.com>
  Date: 2026-01-10 10:00
  Type: Email
  Flags: attachment

  The item in order EX-1002 arrived damaged. A photo is attached.

  Attachments:
    ID     Name              Size    MIME Type   Path
    5001   photo.jpg         200 KB  image/jpeg  (not downloaded, use --download-attachments or \`attachment\` 5001)
    5002   receipt.txt       812 B   text/plain  /Users/example/Library/receipt.txt

${rule}

  ID: 1002
  Subject: Re: Damaged item in order EX-1002
  From: support@example.com
  To: "Customer, Sample" <customer@example.org>, undisclosed-recipients:;
  CC: partner@example.org, Team Lead <lead@example.com>
  Date: 2026-01-10 11:30
  Type: Email

  Sorry about that. Would you like a replacement or a refund?

  Attachments:
  Please reply with your choice.

${rule}

  ID: 1003
  Subject: Re: Damaged item in order EX-1002
  From: Sample Customer <customer@example.org>
  To: support@example.com
  Date: 2026-01-10 12:05
  Type: Comment
  Flags: unread

  Internal note: replacement approved.
`
