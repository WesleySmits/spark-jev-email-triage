# Spark Jev Email Triage

TanStack Start app with React, Vite, and strict TypeScript.

## Setup

Requires Node.js 24 and pnpm 12.5.1 (pinned in `packageManager`).

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

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

`pnpm eval:jev:live` runs the live Jev evaluation over synthetic fixtures. It
calls the TypeSafe API, needs `TYPESAFE_API_KEY`, reports itself blocked
without it, and is never part of `pnpm test` or CI.

## Shadow triage

`pnpm shadow` reads recent mail from one Spark mailbox and reports what
triage would do. It changes nothing in Spark or any mailbox.

```sh
pnpm shadow --preflight                              # check migrations on a disposable database
pnpm shadow --mailbox you@example.com                # dry run: counts only, no Jev calls, no writes
pnpm shadow --mailbox you@example.com --apply        # classify with Jev and store the outcomes
```

- Options: `--limit` (default 25, at most 100), `--max-jev-calls` (default
  25), `--concurrency` (Jev requests in flight, default 2, at most 4), and
  `--db` (default `.data/shadow-triage.sqlite`, which Git ignores).
- `--apply` needs `TYPESAFE_API_KEY`; without it the command reports itself
  blocked.
- `SHADOW_DATABASE_PATH` points the app at a database a run wrote elsewhere
  with `--db`. The app only ever reads it.
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

## Dokploy deployment

- `Dockerfile.app` builds the TanStack Start application with Nitro and runs
  the generated Node server on port 3000.
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

- The app's root route shows recent Spark mail, strictly read-only. It
  reads only through `ReviewDesk` in `src/app/review-desk.ts`, its one deep
  read interface: `open` for the list and what was stored about it, `focus`
  for one opened row's body and `probe` for whether Spark answers.
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
- Live mail is not triaged in the app, so every message is in one "Recent
  mail" workflow. Each row shows what shadow triage last stored about it
  instead: "Triage current", "Triage from earlier", "Triage outdated",
  "Triage failed", "Not triaged" or "Triage unreadable", always as words
  beside their tone, with the model's category where labels apply. The
  reader repeats that state under its header and says what it means, with
  the category, the priority and whether the priority was uncertain, whether
  the model accepted its own labels or sent them to a person, and when it
  was judged. `auto_accepted` reads as the model accepting its labels, never
  as a review by a person; no probability is shown, so nothing suggests the
  model's confidence is calibrated. The page offers no way to save a review
  or change a mailbox. Only the row whose body was read can say "Triage
  current", and only for the very judgment the reading listed: a judgment the
  store already contradicts is never promoted back, and a proof that a later
  reading has outlived is dropped rather than kept. Spark's list shows at
  most 30 characters of a sender and 50 of a subject and has no uncut or
  structured form. A cut sender keeps its whole name when the address
  was cut, otherwise the visible start; a cut subject keeps its visible
  start. Both end in `…`, and nothing is guessed. Only a blank value
  shows as unavailable.
- `src/app/inbox.ts` is the browser-safe read model: queue rows are strict
  summaries without a body, each naming its `mailbox` (the account marker
  is only a color, which several mailboxes may share), and the page loads
  one body at a time, only when its message opens, through an injected
  loader. A late response for a message that is no longer open is dropped.
- `src/app/demo.ts` keeps fictional sample data for tests; the app no
  longer shows it.
- The only persistence is the local shadow-triage SQLite file (Node's
  built-in `node:sqlite`, migrated through `PRAGMA user_version`).
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
- `src/domain/rubric.ts` holds the opinionated default rubric for any Spark
  inbox, personal or work: the categories `personal`, `notification`,
  `security`, `purchase`, `newsletter`, `promotion`, `suspicious`, and
  `other`, four priorities, and the policy thresholds. Ids and classifier
  text are English; display labels will come from UI translations, with
  English as the default and Dutch as a second locale.
- The only secret is `TYPESAFE_API_KEY`, read server-side from the
  environment. The SDK's logging is off and its base URL is pinned. No
  deployment configuration.
- CI runs every quality command, the Storybook play tests, and the build on
  pull requests and `main`.
- On pull requests, CI also runs commitlint and the Fallow changed-code audit.
- CI fails on `git diff --check` errors or uncommitted generated files.
- Branch protection is not configured yet, so CI results are not enforced on merge.
- The shadow-triage database stores:
  - mailbox, thread, and message ids
  - the scrubbed, truncated subject and latest sender that Jev saw
  - judgment values with raw probabilities, rubric and model versions, token
    counts, and provider error codes
  - run status and counts
  - an empty table for later human corrections

  It never stores mail bodies, attachment details, or credentials. Reruns are
  idempotent. A new message, rubric, or model gets a new judgment and keeps
  the old ones. Provider failures are retried. A run is `completed` only when
  nothing failed or was deferred.
