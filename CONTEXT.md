# Product context and domain glossary

## Implemented boundary

`src/routes/index.tsx` reads mail through `ReviewDesk` and enables local
category reviews while keeping completion in `read-only` mode. Spark mailbox
data is only read. The CLI `pnpm shadow --apply` stores classifications;
the review desk appends human reviews to the same local schema-3 SQLite file.
The default is `.data/shadow-triage.sqlite`; `--db` selects the CLI path and
`SHADOW_DATABASE_PATH` selects the app path.

The root inbox is bounded to five readable mailboxes and ten recent Inbox
messages each, without pagination. Classifying is a CLI workflow; the app
only reads existing judgments and saves reviews. It shows a raw category
"Model score", which is not calibrated certainty. Reviews currently decide
category, not reply expectations or deadlines; the UI retains priority but
hides its uncertainty note after a review. See [README](README.md) for the
supported workflows and current limitations.

`/health` reports the configured deployment commit. Spark readiness separately
probes `spark accounts` on the executing host; neither proves that all mail,
the classifier, or local review storage works.

The terms below include future concepts. Logical-message correlation,
mailbox-action execution and action receipts are not exposed by the current
root route or shadow command on `main`.

## Mailbox

A Spark account or shared inbox that the application may read.

## Mailbox copy

One provider-visible copy of a message in one mailbox. A mailbox copy is identified by its mailbox and provider message id. Two mailbox copies may contain the same underlying communication without being erroneous duplicates.

## Thread snapshot

The ordered messages Spark returned when the application read a mailbox copy. Spark does not expose a stable thread id, so a snapshot's current thread id is provider-local and derived from its first message. That id is meaningful only inside the mailbox the copy was read from, and it changes once the provider stops returning that message.

## Classification subject

The immutable version of a thread snapshot that was sent to a classifier. It names the mailbox copy, latest message, rubric and classifier version.

## Classification

One classifier judgment about one classification subject. A classification proposes category, priority and review status. It never authorizes a mailbox action.

## Review

A human confirmation or correction of one exact classification subject, stored append-only beside the original classification. The current UI asks only about category. Reviews are shown for their matching subject, including historical labels when stale; they never make an unverified or stale judgment current and are not transferred to a newer subject.

## Logical message

A provider-independent communication that may have more than one delivery or mailbox copy. The application does not infer this identity until it has reliable correlation evidence.

## Delivery

One delivery of a logical message to a recipient or alias. A delivery may produce mailbox copies in more than one mailbox.

## Mailbox action

A requested provider mutation against explicitly named mailbox copies. A classification or review is not a mailbox action.

## Action receipt

The durable record of one mailbox action attempt and its provider readback, including failed or uncertain outcomes.
