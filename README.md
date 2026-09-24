# Spark Jev Email Triage

TanStack Start app with React, Vite, and strict TypeScript.

## Current product status

The root route reads a bounded recent inbox from the local Spark CLI and
shows classifications previously stored by the shadow CLI. Mailbox data is
read-only; local data is not: `shadow --apply` stores classifications and the
app saves human category reviews in the same SQLite database. Neither a
classification nor a review completes, archives, moves, or marks mail as read.

The inbox includes the first five readable mailboxes in provider order and
up to ten recent Inbox messages per mailbox, sorted newest first (at most
50 rows before deduplication). It has no pagination or complete-history
view. Search and mailbox filtering operate on those loaded rows. One failed
mailbox listing currently makes the whole inbox unavailable. Copies in
different mailboxes remain distinct even when message ids, subjects or
contents match.

That reach is stated on the page rather than left to be inferred. Every
reading carries a scope: the mailboxes it listed with their counts, how
many readable mailboxes the provider offered, the two bounds, and when the
last successful refresh finished. The queue header shows it under the title
in both the desktop and the mobile queue pane, marked when a bound may have
cut the reading. The figures are counted from the rows that were kept, never
estimated: a mailbox whose listing came back full is reported as possibly
cut, because a full listing only proves more was never asked for. The two
bounds are stated apart, because they leave out different mail: a mailbox
the mailbox bound never reached is missing whole, newest mail included,
while the per-mailbox bound only cuts off older mail in a mailbox that was
read. The
mailbox filter is named "All loaded", the search says it searches loaded
mail, and a reading that loaded nothing reads differently from a filter that
matched nothing.

Supported: reading mail, refreshing, opening one body, viewing stored triage,
and confirming or correcting its category locally. Classification starts
through `pnpm shadow --mailbox <mailbox> --apply`, not from the UI; it sends
minimized thread content to Jev and requires `TYPESAFE_API_KEY`. Loading,
refreshing and reviewing in the app make no model calls. There is no UI
triage-run control, priority/reply/deadline editor, persisted completion/Undo,
or mailbox-action workflow on `main`.

The workbench's single-key shortcuts (K, J, E and `/`) can be turned off in
the rail, under the shortcut help. The choice is kept in that browser's local
storage, holds after a reload, and carries no mail. With the keys off nothing
in the page claims one, and Tab, Enter and Escape keep working. The rail, and
with it the setting, is hidden below a 600px viewport.

The web process needs the local Spark CLI to read mail. A successful build
or `/health` response does not prove Spark readiness. See
[the runbook](docs/runbook.md) for separate deployment and host-local checks.

## Setup

For live mail, follow the [supported local start procedure](docs/runbook.md#supported-local-start-procedure):
Node.js 24, pnpm 12.5.1, and the Spark Desktop CLI on the same Mac and in the
same logged-in user session as Spark. The procedure checks provider readiness
before starting the app on loopback. Linux/container builds do not provide a
working Spark integration.

`pnpm install` installs the Git hooks.

## Quality commands

| Command               | Purpose                                              |
| --------------------- | ---------------------------------------------------- |
| `pnpm format`         | Format files with Prettier                           |
| `pnpm format:check`   | Verify formatting                                    |
| `pnpm lint`           | ESLint with type-aware rules, zero warnings          |
| `pnpm typecheck`      | `tsc --noEmit` in strict mode                        |
| `pnpm test`           | Run Vitest once                                      |
| `pnpm test-storybook` | Run every story and its play function in Chromium    |
| `pnpm fallow`         | Dead code, cycles, complexity, and duplication       |
| `pnpm fallow:audit`   | Fallow audit of changes against `origin/main`        |
| `pnpm build`          | Production build                                     |
| `pnpm check`          | Format check, lint, typecheck, tests, Fallow, builds |

`pnpm eval:jev:live` runs the live Jev evaluation over the reviewed
evaluation set. It calls the TypeSafe API, needs `TYPESAFE_API_KEY`, reports
itself blocked without it, and is never part of `pnpm test` or CI. It reports
what each case expects beside what policy did, and then the quality report
counted from the same answers: category quality, the review rate policy
produces beside the one the set expects, calibration and the
provider-failure rate, split by rubric and classifier build. A provider
failure is no judgment and counts in no quality figure. Latency is the wall
clock around each call, which only this run measures; the cost in money is
always unavailable, because no price per token is recorded here.

The run also writes itself down, under `.data/` which Git ignores, so the
figures can be checked without calling the provider again:

```sh
pnpm eval:report .data/eval-run-2026-09-23T09-00-00.000Z.json
```

`pnpm eval:report` counts the same report from that snapshot offline: no
provider, no mailbox, no database and no writes. The snapshot holds the
answers the run received, names its mail by fixture rather than copying any
of it, and pins the labels the run was measured against, so a case read again
since is refused rather than quietly counted another way.

## Shadow triage

`pnpm shadow` reads recent mail from one Spark mailbox and reports what
triage would do. It changes nothing in Spark or any mailbox.

```sh
pnpm shadow --preflight                              # check migrations on a disposable database
pnpm shadow --migrate --db .data/shadow-triage.sqlite # upgrade an existing database locally
pnpm shadow --mailbox you@example.com                # dry run: counts only, no Jev calls, no writes
pnpm shadow --mailbox you@example.com --apply        # classify with Jev and store the outcomes
```

- Options: `--limit` (default 25, at most 100), `--max-jev-calls` (default
  25), `--concurrency` (Jev requests in flight, default 2, at most 4), and
  `--db` (default `.data/shadow-triage.sqlite`, which Git ignores).
- `--apply` needs `TYPESAFE_API_KEY`; without it the command reports itself
  blocked.
- `--migrate` requires an existing `--db` path. It upgrades schema 1 or 2 to 3
  without Spark, Jev, or a TypeSafe key. Back up the file first using the
  procedure in `docs/runbook.md`.
- `SHADOW_DATABASE_PATH` points the app at a database a run wrote elsewhere
  with `--db`. The app reads classifications from it and appends human reviews to it.
- Output is status and counts only. The exit code is `0` for completed or
  dry runs, `1` for failed, `2` for partial, `3` for blocked, and `64` for
  invalid options.

Git hooks:

- `pre-commit`: lint-staged runs Prettier and ESLint on staged files.
- `commit-msg`: commitlint enforces Conventional Commits.

## Storybook

`pnpm storybook` starts Storybook on http://localhost:6006.
`pnpm build-storybook` writes a static build to `storybook-static/`; CI runs it.
`pnpm test-storybook` renders every story and runs its play function in
headless Chromium through Vitest browser mode and Storybook's portable
stories (`.storybook/stories.test.ts`). It starts no Storybook server. A
story's `viewport` global sets the window size; other stories get 1280×1024.
The first local run needs `pnpm exec playwright install --only-shell chromium`.

## Releasing

`docs/runbook.md` is the release runbook: the required check and observed branch
protection, how a deployment names the commit it was built
from, health, the live Spark readback, rollback, and what may be logged. It
reports the build, the merge, the deployment and the live result separately,
because none of them is evidence for another.

```sh
curl -fsS http://localhost:3000/health   # which commit is running
pnpm readback:spark                      # whether Spark answers on this host
```

## Dokploy deployment

- `Dockerfile.app` builds the TanStack Start application with Nitro and runs
  the generated Node server on port 3000. Pass the commit as
  `--build-arg APP_COMMIT_SHA=$(git rev-parse HEAD)`, or set `APP_COMMIT_SHA`
  in Dokploy, so `GET /health` can say what is deployed.
- `Dockerfile.storybook` builds the independent static Storybook site and
  serves it with Nginx on port 80.
- The Dockerfiles contain no application secrets. Configure any runtime
  secrets only in Dokploy, never in the repository.

- Storybook 10 with `@storybook/react-vite`. It uses `.storybook/vite.config.ts`
  with only the React plugin, so the TanStack Start plugin and server
  functions stay out of the browser bundle.
- Stories and `.storybook/preview.ts` may not import Node built-ins, `src/spark`,
  `src/jev`, `src/shadow`, or the TypeSafe SDK (ESLint `no-restricted-imports`).
- The sidebar order is Foundations, Atoms, Molecules, Organisms, Templates,
  Pages. Every component under `src/components/` has stories, up to
  `Pages/Workbench`.
- `src/components/` holds atoms, molecules, organisms, the workbench template
  and the WorkbenchPage: each a component, its CSS (tokens only) and its
  stories. Components do not depend on Storybook or its specimen CSS.
- `src/styles/tokens.css` is the single design-token source. It declares
  custom properties on `:root` only, so importing it changes nothing on its
  own. Storybook imports it in `.storybook/preview.ts`; the app imports it
  and `src/styles/app.css`, its base styles, once in `src/routes/__root.tsx`.
  `src/styles/README.md` holds the foundation rules, design decisions, and
  provenance.
- `src/foundations/` holds the Foundations stories and their Storybook-only
  specimen CSS. Specimens read token values in the browser instead of copying
  them. `contrast-pairs.test.ts` checks the maintained token pairs in
  `tokens.css` against their WCAG contrast limits.
- No addons; Storybook's built-in controls, actions, and viewport are enough
  for now.
- Telemetry is off in `.storybook/main.ts` and, through
  `STORYBOOK_DISABLE_TELEMETRY=true` in both scripts, also when `main.ts`
  fails to load (Storybook otherwise reports that error).

## Safety status

- The app's root route keeps mailbox access read-only. It uses
  `ReviewDesk` in `src/app/review-desk.ts`: `open` for the list and stored
  evidence, `focus` for one opened row's body, `probe` for Spark readiness,
  `review` to append a local review, and `check` to read a save's outcome.
  Everything below it stays behind that module, so the route imports no
  server, Spark, Jev or persistence code.
- `ReviewDesk.open` calls `getLiveInbox` in `src/app/live-inbox.functions.ts`,
  a server function: it discovers the readable mailboxes (at most 5), lists
  the 10 most recent Inbox messages in each, one Spark call at a time, and
  returns strict summaries without a body, newest first. An app server that
  doesn't answer is reported as `unreachable`, not as an error. Opening a
  message calls `getLiveBody` for that message only; it returns that
  message's plain-text body, or `null` when it has none, and reads only
  messages the last list offered. Both answer only requests from this
  computer (loopback) and send `Cache-Control: no-store`.
- `ReviewDesk.open` also carries the judgment shadow triage last stored
  about each listed row, read through `src/app/stored-classifications.server.ts`
  from the local shadow database, opened read-only. Loading or refreshing
  the page classifies nothing: no classifier is constructed and no Jev call
  is made. A stored judgment applies to the one mailbox copy it covered, so
  two alias copies of one delivery never share one, and a covered message
  that names another mailbox than its own judgment matches no row at all.
- What the store alone can prove is bounded, and the states say so. Listing
  reads no thread, so a judgment the store does not contradict reads as
  `unverified`: what was judged, not what holds now. A message delivered
  after the last shadow run leaves the store untouched, so silence is no
  evidence of currency. A judgment the store does contradict — it observed a
  later message in that thread, or it names another rubric or classifier
  build — reads as `stale` and keeps its labels. A failed Jev attempt reads
  as `provider_failure`, never as a classification, and a row nothing
  applies to reads as `none`.
- Only opening a row can make a judgment `current`. The lazy body read of
  that one row already reads its thread, and that thread is what decides:
  the judgment must name the same mailbox copy, thread and latest message,
  under the current rubric and classifier build. So `current` costs no
  provider call beyond the body the reader asked for, and no thread is ever
  read to list or refresh. A judgment the store already contradicts is never
  promoted back by a later read.
- Judgments that cannot be read are reported as unavailable, not as absent.
  A database that was never written says `none`; one that is there but holds
  an unsupported schema or cannot be read says `unavailable`. Either way all
  listed mail still shows, and a body is never held up for its judgment.
- When Spark is missing, fails, or prints output that doesn't parse, the
  page says so and shows no mail; it never falls back to sample data.
  Errors reach the browser only as a coarse reason or a fixed message.
- The page runs in `read-only` completion mode: no Complete, E, Completed
  notice or Undo. The sync button only reads the inbox again.
- Spark wiring lives in `*.server.ts` files, which TanStack Start keeps out
  of the client build; ESLint also keeps components and stories from
  importing `*.server`, `*.functions`, `src/spark` and Node built-ins, and
  keeps routes from importing that server-only code at all.
- Classification cannot be started in the app, so every message is in one "Recent
  mail" workflow. Each row shows what shadow triage last stored about it
  instead: "Triage current", "Triage from earlier", "Triage outdated",
  "Triage failed", "Not triaged" or "Triage unreadable", always as words
  beside their tone, with the model's category where labels apply. The
  reader repeats that state under its header and says what it means, with
  the category, the priority and whether the priority was uncertain, whether
  the model accepted its own labels or sent them to a person, and when it
  was judged. `auto_accepted` reads as the model accepting its labels, never
  as a review by a person. The review panel shows category confidence as a
  percentage labelled "Model score"; this is the model's raw score, not a
  calibrated probability of correctness. The page can save a category
  review but cannot change a mailbox. Spark's list shows at most 30 characters of a sender
  and 50 of a subject and has no uncut or structured form. A cut sender keeps its whole name when the address
  was cut, otherwise the visible start; a cut subject keeps its visible
  start. Both end in `…`, and nothing is guessed. Only a blank value
  shows as unavailable.
- Only the row whose body was read can say "Triage current", and only for
  the very judgment the reading listed. A judgment the store already
  contradicts is never promoted back. Every reading of the desk is named
  with an opaque id of its own, and a body request records the reading it
  ran under, so a proof belongs to that reading alone. Refreshing lists the
  mailbox again under a new reading: the provider may have moved on since
  the open row's thread was read, and nothing reads a thread again to find
  out, so the row falls back to what the store alone says until the reader
  opens that thread anew. The text that was read stays; no body, thread or
  classifier call follows a refresh. The same reading rendered again keeps
  what it proved.
- `src/app/inbox.ts` is the browser-safe read model: queue rows are strict
  summaries without a body, each naming its `mailbox` (the account marker
  is only a color, which several mailboxes may share), and the page loads
  one body at a time, only when its message opens, through an injected
  loader. A late response for a message that is no longer open is dropped.
- `src/app/demo.ts` keeps fictional sample data for tests; the app no
  longer shows it.
- Classifications and reviews persist in the local shadow-triage SQLite
  file (Node's built-in `node:sqlite`, schema 3 via `PRAGMA user_version`).
  Evaluation snapshots are separate local JSON files under `.data/`.
- A `current` or `unverified` classification offers a category review;
  stale, failed, absent or unreadable classifications do not. The save
  rechecks the exact subject against the store in a transaction, without
  reading Spark; `unverified` is not proof of live currency. Reviews are
  append-only, retain the original judgment, and record the server's local
  OS account name and timestamp. The latest applicable review determines
  the displayed labels after reload; it never makes a classification current.
  Review POSTs and save readback are loopback-only with `no-store` responses.
  A lost response is an unknown outcome, with readback and a retry using the
  same request id to avoid duplicate reviews. The pending subject, chosen
  labels and request id are kept in the browser tab's `sessionStorage` before
  sending; saving is blocked if that storage cannot retain the request.
- The review UI only asks about category and retains the model priority.
  A saved review is never evidence that another field was confirmed: the
  model's own signals stay beside it, and the copy says the review covers
  the category only.
- The panel and the reader say why review was asked for, from the grounds the
  run recorded beside the judgment: a category score under the accept level,
  an answer of Other, a mail read as a possible scam, and the signals cited
  for that last one. Each reads as itself, so no state explains every
  `needs_review` as the model doubting its own category.
- No ground is stated more strongly than what produced it. Policy admits a
  suspicion signal from `suspicionFloor`, which is low on purpose, so every
  signal is shown as a possibility the model scored rather than as a checked
  finding. `other` covers both a category that does not fit and a thread that
  does not say enough, and a run stores one code for both, so the copy names
  both and claims neither. Those grounds
  are policy decisions over the model's scores, made in ordinary code; they
  say nothing about whether the judgment still describes the mail, which is
  the state beside them, and nothing about what a person decided, which is a
  review beside them. A judgment read as a possible scam carries that warning
  as a value of its own, so confirming or correcting the category never
  clears it.
- Grounds are codes from closed sets that `src/domain/triage.ts` defines, and
  every line shown for one is this application's own copy. No mail or model
  text is shown for a reason, inert or otherwise: a stored value that is not
  one of those codes has no line to print.
- A record that does not give its grounds reads as an explicit unknown state
  and says so, rather than borrowing another judgment's reason. That covers a
  row stored without them, one naming a code this build cannot read, and one
  whose grounds disagree with the review need stored beside it. The judgment
  itself stays readable either way, and no warning or reassurance is claimed
  for it.
- `src/spark` reads mail through the local `spark` CLI, read-only. Its command
  type allows only `accounts`, `emails`, and `thread`. It never uses a shell,
  runs one call at a time with a timeout and output limit, and logs no mail
  content. The shadow command and the live inbox call it.
- `src/jev` classifies one normalized thread with Jev through the official
  TypeSafe SDK. It sends a minimized state: the latest five messages with
  quoted history, URL queries, and long opaque tokens removed, bounded text,
  and attachment names without contents. Email text is framed as untrusted
  data. Every response is validated; a provider failure is reported apart
  from model uncertainty. Policy in ordinary code sends an ambiguous or
  low-confidence category to review and reports an uncertain priority
  without forcing review. Suspicion only raises review priority. Nothing
  authorizes a mailbox action, and only the shadow command calls it.
- `src/eval/reviewed-set.ts` is the reviewed evaluation set: the invented,
  sanitized threads triage is measured against, each with the category,
  priority, handling and the argument for them that a person settled on
  against the rubric. It covers ambiguous, suspicious, personal, purchase and
  notification mail among the rest. An assistant proposed every case and a
  named person then read all of them, keeping most and correcting two; each
  case's `curation` says who proposed it, who read it, when, and whether that
  reading changed it. Expectations are never taken from a classifier answer
  or from policy, and the set calls nothing, so its tests run in CI with no
  provider, network or secret; only `pnpm eval:jev:live` reaches Jev. Each
  case names the thread it was written against by subject, latest message and
  a digest of the whole parsed thread, along with the rubric id, so any edit
  to that mail — a body, a sender, an attachment or an earlier message — or a
  bumped rubric fails the test until the labels are read again, and each
  records its provenance. `src/eval/README.md` holds the review record and the
  provenance and privacy rules, including what sanitizing a real message
  would require.
- `src/eval/quality-report.ts` counts what one run of that set says about
  triage quality — category quality, the review rate beside the set's own,
  calibration and the provider-failure rate — split by rubric and by the
  pinned classifier build, and `quality-report-text.ts` renders it. It is a
  pure function of the answers it is handed, and the judged rows are put in
  one canonical order before anything is summed, so the same run always gives
  the same figures. A figure with no source data says which one it is missing
  and why, rather than reading as a zero: latency is reported only where a run
  timed the calls, and the cost in money never, because no price per token is
  recorded here. The report names fixtures, categories, counts and
  content-free provider codes and no mail at all, so it may be printed, logged
  and pasted as it is. It is evidence for a threshold, never an argument on
  its own: `src/eval/README.md` says what changing one takes, and nothing here
  changes one.
- Only a rubric this build still holds can be counted, and every threshold
  belongs to the slice that names its rubric rather than to the report as a
  whole. A run judged under an older rubric was judged under other meanings
  and other thresholds, which this build did not keep, so it is refused where
  it enters instead of being counted under today's.
- `src/eval/run-snapshot.ts` writes one run down and reads it back, and
  `pnpm eval:report` (`src/eval/command.ts`) counts the report from it
  offline, with no provider, mailbox, database or write of its own. A
  snapshot names its mail by fixture and by a digest of the thread it was
  measured against, never copying any of it, pins the labels that run was
  measured against without the prose that argued for them, keeps the
  classifier's answers and token counts whole, and keeps a failed call as its
  content-free code alone. It is parsed, never trusted: a case this build
  lacks, a labelled thread that has changed since, a case whose expected
  labels were corrected since, a file written to an older shape and a rubric
  no longer held are each refused, so a run is never recounted against a
  yardstick it was not measured with. The live run writes its snapshot under `.data/`, which Git
  ignores, named after the run's own timestamp, so no live answer is
  committed and no argument decides where anything is written.
- `src/domain/rubric.ts` holds the opinionated default rubric for any Spark
  inbox, personal or work: the categories `personal`, `notification`,
  `security`, `purchase`, `newsletter`, `promotion`, `suspicious`, and
  `other`, four priorities, and the policy thresholds. Ids and classifier
  text and current UI labels are English; a Dutch locale is not implemented.
- The only secret is `TYPESAFE_API_KEY`, read server-side from the
  environment. The SDK's logging is off and its base URL is pinned.
  Docker build targets exist; runtime secrets are configured outside Git.
- CI runs the checks in `pnpm check`, including Storybook play tests and
  both builds, on pull requests and pushes to `main`.
- On pull requests, CI also runs commitlint and the Fallow changed-code audit.
- CI fails on `git diff --check` errors or uncommitted generated files.
- CI ends in one job, `required-checks`, which waits for every other job and
  fails unless each succeeded. It is the single check a branch can require,
  and `src/release/ci-workflow.test.ts` reads the workflow and fails when a
  job is not covered by it.
- GitHub readback on 2026-09-24 showed active ruleset `23879348` requiring
  PRs and `required-checks` on `main` and `feature/human-triage-review`, with
  no bypass actors. Repository settings can change; see the runbook's
  evidence and readback commands before reporting enforcement.
- `GET /health` answers with the configured commit identity, and
  nothing else: it reads one environment variable, `APP_COMMIT_SHA`, calls no
  provider, opens no database and holds no mail. A build that cannot name its
  commit answers `503`, because a deployment nobody can name cannot be rolled
  back to a known commit. It is not a Spark check.
- `pnpm readback:spark` is the live Spark check, deliberately apart from
  health: one read-only `spark accounts` call through the app's own probe,
  a status line plus fixed recovery guidance on failure, and no address, subject, count or body. It speaks for
  the host it ran on and says so, so a deployment's connectivity is only what
  that deployment's own runtime answered; where the probe cannot run there,
  `docs/runbook.md` has it reported as blocked rather than as ready.
- The shadow-triage database stores:
  - mailbox, thread, and message ids
  - the scrubbed, truncated subject and latest sender that Jev saw
  - judgment values with raw probabilities, rubric and model versions, token
    counts, and provider error codes
  - run status and counts
  - append-only human reviews: exact classification subject, decision,
    corrected category/priority when supplied, reviewer and time
  - save request ids, payloads and outcomes for idempotent retries

  It never stores mail bodies, attachment details, or credentials. Reruns are
  idempotent. A new message, rubric, or model gets a new judgment and keeps
  the old ones. Provider failures are retried. A run is `completed` only when
  nothing failed or was deferred.
