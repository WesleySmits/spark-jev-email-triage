# Domain glossary

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

A human confirmation or correction of one classification. A review preserves the original classification and becomes stale when its classification subject is no longer current.

## Logical message

A provider-independent communication that may have more than one delivery or mailbox copy. The application does not infer this identity until it has reliable correlation evidence.

## Delivery

One delivery of a logical message to a recipient or alias. A delivery may produce mailbox copies in more than one mailbox.

## Mailbox action

A requested provider mutation against explicitly named mailbox copies. A classification or review is not a mailbox action.

## Action proposal

One proposed mailbox action: the action, every target mailbox copy named explicitly by its mailbox and provider message id, the thread version each was proposed against, and what explains it. Making one changes nothing and authorizes nothing. A copy is a target only where the proposal names it, so a copy of the same message in another mailbox is never added to one.

## Action approval

One person's decision about one exact proposal. It is that person's decision, recorded by this application; it is not a provider's permission and no provider is told about it. An approval lapses once a target's thread moves past the version proposed against.

## Action receipt

The durable record of one mailbox action attempt and its provider readback, including failed or uncertain outcomes.
