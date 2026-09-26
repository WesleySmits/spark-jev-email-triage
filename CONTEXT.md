# Product context and domain glossary

## Implemented boundary

`src/routes/index.tsx` reads mail through `ReviewDesk` and enables local
reviews of a classification's category and priority. The legacy Complete control remains off; the separate
guarded Done panel can archive one selected Spark message ID after human
approval and a second confirmation. The action server is disabled by default.
The CLI `pnpm shadow --apply` stores classifications;
the review desk appends human reviews to the same local schema-5 SQLite file.
The default is `.data/shadow-triage.sqlite`; `--db` selects the CLI path and
`SHADOW_DATABASE_PATH` selects the app path.

The root inbox starts with one ten-message page of unread mail from every
readable mailbox. A person can load older unread pages or switch to the same
bounded reading of read Inbox mail ("Other Inbox"). Each continuation reads at
most one new page for each mailbox that may still have more; there is no fixed
application page ceiling and completed pages are not requested again. Each
reading carries an inbox scope: selected view, completed pages,
loaded mailbox counts, first-page failures, later-page incomplete reads,
readable mailboxes offered, whether another page may exist, and when the
reading finished. The queue states that scope on desktop and mobile, so a
bounded selection never reads as a whole mailbox or as Inbox Zero. A mailbox's
first-page failure costs only that mailbox's rows; a later failure preserves
its completed pages. Only failing to discover the mailboxes makes a reading
unavailable.

`ReviewDesk.search` is a browser-safe discovery contract behind a POST server
boundary. Wesley selected Variant C: mailbox reach and failures live in the
rail and the queue remains compact. The root route uses that direction in both
the desktop rail and compact filters sheet while retaining Feature 2's Jev run
control. Search
matches only sender and subject metadata from the loaded Spark `emails` pages.
One opaque continuation adds at most one page per still-bounded mailbox. Its
scope exposes per-mailbox page depth, unique mailbox copies scanned and
matched, truncation, bounds, coarse failures and search completion time. It
does not read bodies, classify, mutate mail or put query text in Spark logs.

`ReviewDesk.refresh` is the read-only incremental refresh contract. It
rediscovers mailboxes and re-reads exactly the already-loaded page depth for
the selected view, deduplicating copies across shifting pages. Fully refreshed
mailboxes report added, removed and updated copies; failed or incomplete
mailboxes report a coarse error without guessing changes from unread data.
Per-mailbox completed depth and last successful read time remain explicit. It
reads no body, calls no classifier and changes no mailbox.
The route uses this contract for Refresh, keeps the page mounted within one
view so stable mailbox-copy selections survive, and shows only changes proved
by complete per-mailbox reads.

The queue is a worklist. Every loaded row is placed in one of five attention
groups, in this order: needs review, high priority, attention, not triaged and
informational. A row is placed by the judgment a reading holds for it and by
what a person decided about that exact version; a stale, failed, unreadable or
missing judgment places nothing and is grouped as not triaged with its cause
named. Each row carries one line saying which labels placed it and who decided
each, with the model's advice kept beside a person's decision. Each group
counts its rows and says whether the count is of loaded rows, of every message
the view holds when the Inbox Zero scan proved the reading complete, or of a
filter. Placing a row moves no mail.

The workflow and mailbox filters move into a modal sheet from the top bar
at 900px and below, so they remain reachable on narrow screens.

The workbench queue header can explicitly start a bounded Jev run over its
loaded worklist, show progress, request a safe Stop and read the durable result.
The control and server contract are default-off and loopback-only. Opening and
refreshing only read and never start Jev. The CLI mailbox workflow remains
available. The app otherwise reads existing judgments and saves reviews. It shows a raw category
"Model score", which is not calibrated certainty. The review contract and the panel
decide category and priority as separate fields, and neither reply
expectations nor deadlines. Jev's advice for each field is shown beside the
decision a person makes about it; choosing the value marked as that advice is
what records a confirmation, and a field nobody touched stays the model's,
uncertainty note included, and reads as not reviewed. See [README](README.md) for the
supported workflows and current limitations.

`/health` reports the configured deployment commit. Spark readiness separately
probes `spark accounts` on the executing host; neither proves that all mail,
the classifier, or local review storage works.

The terms below include future concepts. Logical-message correlation is not
implemented. Handling outcomes are defined as a domain model and are offered
nowhere in the app, stored nowhere, and wired to nothing. The root route
exposes only guarded Spark Done, never an automatic action from
classification or review.

## Mailbox

A Spark account or shared inbox that the application may read.

## Inbox scope

What one unread or read reading of the inbox holds, what bounded it and what it
could not read: the requested page count, the mailboxes it listed with their
loaded counts, first-page failures, later-page incomplete reads, how many
readable mailboxes the provider offered, whether a further page may exist, and
when that reading finished. Every figure is counted from the rows that were
kept, so a scope describes a reading and never a mailbox. Mailbox copies are
counted separately, so one delivery to a primary address and an alias counts
in both.

A mailbox whose first page could not be read holds no rows in the scope. That
is not the same as a mailbox that answered with nothing, and neither is a
claim about what the mailbox holds. When a later page fails, earlier pages
remain in the scope and the mailbox is explicitly incomplete.

## Mailbox copy

One provider-visible copy of a message in one mailbox. A mailbox copy is identified by its mailbox and provider message id. Two mailbox copies may contain the same underlying communication without being erroneous duplicates.

## Thread snapshot

The ordered messages Spark returned when the application read a mailbox copy. Spark does not expose a stable thread id, so a snapshot's current thread id is provider-local and derived from its first message. That id is meaningful only inside the mailbox the copy was read from, and it changes once the provider stops returning that message.

## Classification subject

The immutable version of a thread snapshot that was sent to a classifier. It names the mailbox copy, latest message, rubric and classifier version.

## Classification

One classifier judgment about one classification subject. A classification proposes category, priority and review status. It never authorizes a mailbox action.

## Review

A human confirmation or correction of one exact classification subject, stored append-only beside the original classification. A review decides the category, the priority or both, one field at a time: each field carries its own confirmation or correction, and a field no review named stays the classifier's and is attributed to it. Reply expectation and deadline are not reviewable; what to do about a message is a work decision, not a classifier label anyone confirms here. One Save records every field a person decided and no other. Reviews are shown for their matching subject, including historical labels when stale; they never make an unverified or stale judgment current and are not transferred to a newer subject.

## Logical message

A provider-independent communication that may have more than one delivery or mailbox copy. The application does not infer this identity until it has reliable correlation evidence.

## Delivery

One delivery of a logical message to a recipient or alias. A delivery may produce mailbox copies in more than one mailbox.

## Handling outcome

What a person decided to do about one mailbox copy, as of the thread version
they were shown: "handle now", "reply needed", "follow up later" or "read
only". Every outcome changes this application's local record of the work
owed and nothing else, except "handle now", which also proposes one guarded
Spark Done, because it is the only outcome claiming the message is finished.
The other three move no mail, schedule nothing with Spark, and leave the copy
where it is. Deciding
an outcome runs no provider command: a proposal it makes still waits for the
approval, receipt and readback every Spark Done waits for. Reply expectation
and deadline remain outside review; a handling outcome is a work decision, not
a classifier label anyone confirms.

## Mailbox action

A requested provider mutation. Spark Done addresses exactly one provider
message ID and accepts no mailbox selector, so the ID, not the row, is what
Spark acts on. The selected mailbox copy is context for preflight and
readback, not an exact write boundary: another copy carrying that same ID,
such as one delivery to an address and an alias, can be affected by an action
decided on one row. Unresolved attempts are locked by that ID alone, so a
pending or uncertain receipt blocks every copy sharing it. A classification,
a review or a handling outcome is not a mailbox action.

## Action proposal

One proposed Spark Done action: the selected message ID, the mailbox copy it
was selected from, the observed thread version, and what explains the
proposal. Making one changes nothing. Spark may affect another visible copy
that shares the ID, and a new message may arrive between preflight and action.

## Action approval

One person's decision about one exact proposal, recorded in a separate local
action journal with server-owned identity and time. It expires after five
minutes and is rechecked before execution. Approval alone starts no Spark
action.

## Action receipt

The durable record claimed before one Spark Done attempt. It stores a
confirmed status and readback time only after Archive/Inbox verification;
otherwise a pending or uncertain status prevents an automatic retry on the
same message ID.

## Opening a message in Spark

Not available. No Spark command or URL scheme was executed and observed to
select one exact message, so the application claims no such link. The
supported CLI surface reads accounts, emails and threads only. Spark's help
describes a desktop deep link that its own Command Center copies for a
message already selected inside Spark; its payload is opaque and nothing
documents building one from the provider message ID this application holds.
Nothing could be run either way here, because Spark's CLI ships with macOS
Spark Desktop and the host running these checks does not have it. Proving a
link means running it on the Mac in that Spark session and observing the
selected message; until then a message ID is something to read and copy,
never to follow.
