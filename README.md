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

| Command             | Purpose                                             |
| ------------------- | --------------------------------------------------- |
| `pnpm format`       | Format files with Prettier                          |
| `pnpm format:check` | Verify formatting                                   |
| `pnpm lint`         | ESLint with type-aware rules, zero warnings         |
| `pnpm typecheck`    | `tsc --noEmit` in strict mode                       |
| `pnpm test`         | Run Vitest once                                     |
| `pnpm fallow`       | Dead code, cycles, complexity, and duplication      |
| `pnpm fallow:audit` | Fallow audit of changes against `origin/main`       |
| `pnpm build`        | Production build                                    |
| `pnpm check`        | Format check, lint, typecheck, test, Fallow, builds |

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
- Output is status and counts only. The exit code is `0` for completed or
  dry runs, `1` for failed, `2` for partial, `3` for blocked, and `64` for
  invalid options.

Git hooks:

- `pre-commit`: lint-staged runs Prettier and ESLint on staged files.
- `commit-msg`: commitlint enforces Conventional Commits.

## Storybook

`pnpm storybook` starts Storybook on http://localhost:6006.
`pnpm build-storybook` writes a static build to `storybook-static/`; CI runs it.

- Storybook 10 with `@storybook/react-vite`. It uses `.storybook/vite.config.ts`
  with only the React plugin, so the TanStack Start plugin and server
  functions stay out of the browser bundle.
- Stories and `.storybook/preview.ts` may not import Node built-ins, `src/spark`,
  `src/jev`, `src/shadow`, or the TypeSafe SDK (ESLint `no-restricted-imports`).
- The sidebar order is Foundations, Atoms, Molecules, Organisms, Templates,
  Pages. There are no stories yet.
- No addons; Storybook's built-in controls, actions, and viewport are enough
  for now. Telemetry is off.

## Safety status

- No product features or UI. The only persistence is the local shadow-triage
  SQLite file (Node's built-in `node:sqlite`, migrated through
  `PRAGMA user_version`).
- `src/spark` reads mail through the local `spark` CLI, read-only. Its command
  type allows only `accounts`, `emails`, and `thread`. It never uses a shell,
  runs one call at a time with a timeout and output limit, and logs no mail
  content. Only the shadow command calls it.
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
- CI runs every quality command and the build on pull requests and `main`.
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
