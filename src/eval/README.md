# Reviewed evaluation set

`reviewed-set.ts` holds the mail this repository measures triage against, and
the outcome a person expects for each thread. It is data and judgment only:
it calls nothing, so every test that uses it runs in CI without a provider, a
network or a secret.

## Who stands behind a label

Every case was proposed by Claude Opus 5, running in T3 Code, from the mail
and the rubric alone, and then read by Wesley Smits. He kept nine proposals
and corrected two.

Each case carries its own `curation`:

- `state` is `proposed` until a person reads the case, `confirmed` after.
- `proposedBy` names who wrote the labels first and `proposedOn` the day.
  Neither is a review date.
- `confirmedBy` and `confirmedOn` name the person who read the case and the
  day they did. They stay `null` while a case is `proposed`, and the set's
  test fails if a case claims a confirmation without naming both.
- `changedOnReview` says whether that person changed the proposal or kept it.
  A case cannot be marked changed without having been read.

Reviewing a case means reading its thread and its rubric, then keeping or
correcting the category, priority and handling, and saying so in the commit.
Correcting a proposal is an ordinary outcome, not a defect in it.

## What an expectation is

An expectation is the outcome a reader settled on after reading the thread
against `defaultRubric` in `src/domain/rubric.ts`: a category, a priority,
whether the thread should go in front of a person, and the argument for all
three.

- Expectations are written from the mail. They are never copied from a
  classifier answer, recomputed from `src/jev/policy.ts`, or adjusted to make
  a run agree. A yardstick built out of what it measures measures nothing,
  and `reviewed-set.test.ts` fails if the module reaches for the classifier,
  the TypeSafe SDK or the environment.
- The argument matters as much as the labels, and may claim only what the
  mail says. Whoever reads a case next should be able to disagree with the
  sentence rather than guess at it.
- Disagreement between the set and a classifier is a finding, not a defect in
  the set.

## What an expectation was written against

Each case names three things: the subject and latest message id of the thread
it was written against, a digest of that whole parsed thread, and the rubric
id whose meanings its labels were chosen under. Provider order decides which
message is latest, as everywhere else in the domain.

The subject and the message id are the anchors a reader recognises, and they
are not enough on their own. What a person judged is the whole thread, which
is why `classificationSubjectSchema` freezes a whole snapshot rather than a
few of its fields. An edited body, a renamed sender, a different attachment
or a changed earlier message can leave a subject and every message id intact
while making the labels wrong, so `threadDigest` in `thread-digest.ts` covers
the parsed thread whole. It hashes the thread with its keys sorted at every
depth, so the value follows content rather than the order a schema declares
its fields. It detects drift; it is not a security boundary.

Every one of those values is written down in the case rather than computed
when the test runs, so a fixture is compared against what was read and not
against itself. Editing a labelled thread, or bumping the rubric id because a
meaning or threshold changed, therefore fails the set's test. The labels are
then read again rather than carried onto mail, or into meanings, that nobody
chose them for. Recording a new digest is how a person says they re-read the
mail; it is not a formality to paste past.

## Reading a live report

`pnpm eval:jev:live` prints one row per case: what the set expects, what Jev
answered, and what policy made of it. Two vocabularies meet there, so
`handling-agreement.ts` writes down how they line up rather than leaving a
reader of the table to guess: `may_auto_label` predicts `auto_accepted`, and
`needs_person` predicts `needs_review`. The row's `handlingAgrees` says
whether policy did what the case expected.

A provider failure is not a judgment. Policy reports `needs_review` for one
because nothing judged the thread, not because it decided a person should
see it, so such a row has no `handlingAgrees` at all and counts towards
neither the category nor the handling figure. Counting it as agreement would
flatter the set; counting it as a mismatch would blame it for an outage.

Agreement is reported, never asserted. The thresholds are not calibrated, so
a disagreement is something to read rather than a failure to fix.

## Reading a quality report

`quality-report.ts` counts what one run of the set says about triage
quality, and `quality-report-text.ts` renders it. `pnpm eval:jev:live` prints
it under the per-case table, from the same answers the table shows.

The report is a pure function of the observations it is handed: the same
answers always give the same figures, in whatever order they arrive, so a run
can be recomputed rather than believed. It calls nothing, reads no mailbox
and looks at no clock, and its tests run offline like the rest of the set.

Every figure is split by rubric and by the pinned classifier build that was
asked, because a category, a priority and a threshold mean what a rubric
version says they mean, and two builds are two classifiers. The versioned
models that actually answered are named beside the build, so an alias that
moved under a pinned name is visible rather than averaged away.

What one slice holds:

- **Category quality**: agreement with the expectation a person settled on,
  over the run and per category. How often a category was expected and how
  often it was answered are counted separately, because a classifier that
  answers `other` for everything agrees with every `other` case while being
  useless. Each disagreement is named by its fixture.
- **Review rate**: the share of judged threads policy sends to a person, with
  the share the set expects beside it. They answer different questions, so
  the handling agreement is reported too: a run that reviews the right number
  of the wrong threads did not do well.
- **Calibration**: the confidence of the chosen category against how often
  that choice agreed, in bins of a tenth, with the expected calibration error
  they weigh out to.
- **Provider-failure rate**: failed attempts over all attempts, by their
  content-free code. A failure is no judgment, so it stays out of every
  quality figure, as it does in `handling-agreement.ts`.
- **Latency**: the wall clock around each call, which only the live run
  measures. A report built from answers nobody timed says the figure was not
  measured rather than printing a zero.
- **Cost**: the provider's own token counts. The cost in money is always
  unavailable: no price per token is recorded in this repository, and a
  number nobody can stand behind is worse than none.

## Thresholds are not moved by a report

`defaultRubric.thresholds` are not calibrated, and the set is small. A report
is the evidence to argue from, never the argument itself: fitting a threshold
to eleven cases fits it to those eleven.

Changing one needs the report before and after the change, over the same set
and the same classifier build, in the commit that changes it, and a rubric id
bump, because a threshold is part of what a rubric means. `reviewed-set.ts`
pins the rubric its labels were chosen under, so bumping the id fails the
set's test until each case is read again under the new meanings.

No threshold has been changed for this report. The figures it prints are the
baseline a later run is compared with.

## Provenance and privacy

Every case records where its mail came from.

- `invented` means no real message, person or address was involved at any
  point. Every case in the set today is invented.
- `sanitized` means a real message was rewritten. It is allowed only when the
  mailbox owner agrees, and its `note` must say what was removed and by whom.
  Sanitizing means replacing, not masking: names, addresses, links, order and
  account numbers, tracking tokens, quoted history and attachment contents go
  away entirely, and what is left must read as invented mail.
- Addresses and links use domains reserved by RFC 2606 or RFC 6761
  (`example.com`, `example.org`, `example.net`, `.example`, `.test`,
  `.invalid`). `src/domain/fixtures.test.ts` enforces this over every thread
  the set labels.
- Nothing here holds a credential, a real message id, a mailbox path or a
  provider response body. The set stores mail text on purpose, which is
  exactly why that text must be fictitious: the repository is public and its
  test output is not private.

The same rule holds for the rest of the repository, from the other direction:
mail subjects, addresses and bodies stay out of logs and public errors. The
quality report is written to be printed, logged and pasted into a ticket, so
it carries only fixture names, categories, counts and content-free provider
codes; a test renders the whole set and fails if any subject, address or
sender name reaches the text.
