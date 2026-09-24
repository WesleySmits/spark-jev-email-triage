# Reviewed evaluation set

`reviewed-set.ts` holds the mail this repository measures triage against, and
the outcome a named reviewer expects for each thread. It is data and judgment only:
it calls nothing, so every test that uses it runs in CI without a provider, a
network or a secret.

## Who stands behind a label

The original eleven cases were proposed by Claude Opus 5, running in T3 Code,
from the mail and the rubric alone, and then read by Wesley Smits. He kept
nine proposals and corrected two. The seven Feature 8 cases were proposed and
reviewed in separate Codex passes. They say `reviewerKind: assistant`; they do
not claim Wesley reviewed labels he has not yet reviewed. Human approval of
the feature PR remains the release boundary.

Each case carries its own `curation`:

- `state` is `proposed` until a named reviewer reads the case, `confirmed` after.
- `proposedBy` names who wrote the labels first and `proposedOn` the day.
  Neither is a review date.
- `confirmedBy`, `confirmedOn` and `reviewerKind` name who read the case, what
  kind of reviewer they were and the day they did. They stay `null` while a
  case is `proposed`, and the set's test fails if those claims disagree.
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
Sums over floating-point confidences do depend on the order they are added
in, so the judged rows are put in one canonical order before anything is
summed, and every arrangement of one run gives one mean and one calibration
error.

Every figure is split by rubric and by the pinned classifier build that was
asked, because a category, a priority and a threshold mean what a rubric
version says they mean, and two builds are two classifiers. The versioned
models that actually answered are named beside the build, so an alias that
moved under a pinned name is visible rather than averaged away.

What one slice holds:

- **Category quality**: agreement with the expectation a reviewer settled on,
  over the run and per category. How often a category was expected and how
  often it was answered are counted separately, because a classifier that
  answers `other` for everything agrees with every `other` case while being
  useless. Each disagreement is named by its fixture.
- **Priority quality**: agreement with the reviewed priority, per priority and
  over the run, with each disagreement named. The report separately counts
  the priorities policy calls uncertain; category confidence is never used as
  a proxy for priority confidence.
- **Review load**: the share of judged threads policy sends to a person, with
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

## Recounting a run

A live run reaches the provider once, and another run is another run, so a
printed report is a claim nobody else can check. `pnpm eval:jev:live`
therefore writes the run down as well: a snapshot under `.data/`, named after
the run's own UTC timestamp, holding the answers it received. Git ignores
`.data/`, so a live answer is never committed, and no argument or environment
variable decides where anything is written.

```sh
pnpm eval:report .data/eval-run-2026-09-23T09-00-00.000Z.json
```

`pnpm eval:report` counts the same figures from that file and prints the same
report. It calls no provider, reads no mailbox, opens no database and writes
nothing, so anyone holding a snapshot can check a run's figures without a
key, a network or the machine that ran it.

What a snapshot holds, and what it does not:

- The mail is named, never copied: a fixture's name and the digest of the
  thread it was measured against. The mail itself stays in
  `src/domain/fixtures.ts` or `src/eval/fixtures.ts`, where a reviewer read it, so no subject,
  address, body or attachment can travel in a snapshot. A test writes the
  whole set and fails if any of them does.
- The labels the run was measured against: the category, the priority and the
  handling the case expected then, and none of the prose that argued for
  them. A run is a comparison, and pinning only the mail pins half of it.
  Reading a case again and correcting its labels is an ordinary outcome here
  — two cases in the set began that way — and it leaves the thread and its
  digest untouched, so nothing else would catch it.
- The classifier's answers travel whole — the chosen labels, every
  probability, the provider's own token counts — because they are what the
  figures are counted from. They are numbers and rubric labels.
- A failed call keeps its content-free code and nothing else. A provider's
  own detail, HTTP status or message is dropped: the report counts failures
  by code, and a detail is the one field that could carry provider text into
  a file meant to be shared.
- Latency travels as measured, or as `null` where nothing measured it.

A snapshot is read back as data and never trusted. Every field is parsed, and
a run this build cannot honestly count is refused rather than reported:

- `unknown_fixture`: it names a case this build does not have.
- `changed_fixture`: the labelled thread has changed since the run, so the
  answers describe mail this build no longer holds. The digest is recomputed
  from the thread rather than read from the case, so an edit is caught even
  if the recorded digest was edited with it.
- `changed_expectation`: the mail is the mail the run measured, but the case
  expects other labels now. The answers are still the answers; what they
  would be counted against is not, so the figures would be another comparison
  printed under this run's name. Every label counts: an expectation is one
  judgment a reviewer settled on.
- `unsupported_rubric`: it was judged under a rubric this build no longer
  holds. See below.

A snapshot names the shape it was written to. The field is bumped whenever
that shape changes, and an older file is refused rather than read as though
it said what it does not: a version 1 file carried no expectation, and
recounting one against whatever the set says today is the very drift the
field exists to prevent.

One refused entry refuses the run: a report over the rest would be another
run's report printed under this one's name.

## One rubric at a time

Only a rubric this build still holds can be counted, and `reportableRubrics`
in `quality-report.ts` says which. There is one.

A run judged under an older rubric was judged under other category and
priority meanings and other thresholds, and this build kept neither. Counting
it would apply today's policy to yesterday's judgments and then print today's
thresholds beside them, as though those were the ones that produced the
figures. `triage.ts` keeps old rubric ids parseable on purpose, so such a run
reads back fine; it is refused where it enters instead.

Thresholds therefore belong to the slice that names their rubric, in the
report and in the text, rather than to the report as a whole. A figure is
never shown under thresholds that did not produce it.

## Thresholds are not moved by a report

`defaultRubric.thresholds` are not calibrated, and the set is small. A report
is the evidence to argue from, never the argument itself: fitting a threshold
to eighteen cases fits it to those eighteen.

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
  `.invalid`). `src/domain/fixtures.test.ts` and `src/eval/fixtures.test.ts`
  enforce this over every thread the set labels.
- Nothing here holds a credential, a real message id, a mailbox path or a
  provider response body. The set stores mail text on purpose, which is
  exactly why that text must be fictitious: the repository is public and its
  test output is not private.

The same rule holds for the rest of the repository, from the other direction:
mail subjects, addresses and bodies stay out of logs and public errors. The
quality report is written to be printed, logged and pasted into a ticket, so
it carries only fixture names, categories, counts and content-free provider
codes; a test renders the whole set and fails if any subject, address or
sender name reaches the text. A run snapshot is written to be shared for the
same reason and holds no mail either, which a test of its own enforces over
every case, bodies included.
