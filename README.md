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

| Command             | Purpose                                                |
| ------------------- | ------------------------------------------------------ |
| `pnpm format`       | Format files with Prettier                             |
| `pnpm format:check` | Verify formatting                                      |
| `pnpm lint`         | ESLint with type-aware rules, zero warnings            |
| `pnpm typecheck`    | `tsc --noEmit` in strict mode                          |
| `pnpm test`         | Run Vitest once                                        |
| `pnpm fallow`       | Dead code, cycles, complexity, and duplication         |
| `pnpm fallow:audit` | Fallow audit of changes against `origin/main`          |
| `pnpm build`        | Production build                                       |
| `pnpm check`        | Format check, lint, typecheck, test, Fallow, and build |

`pnpm eval:jev:live` runs the live Jev evaluation over synthetic fixtures. It
calls the TypeSafe API, needs `TYPESAFE_API_KEY`, reports itself blocked
without it, and is never part of `pnpm test` or CI.

Git hooks:

- `pre-commit`: lint-staged runs Prettier and ESLint on staged files.
- `commit-msg`: commitlint enforces Conventional Commits.

## Safety status

- No product features or persistence.
- `src/spark` reads mail through the local `spark` CLI, read-only. Its command
  type allows only `accounts`, `emails`, and `thread`. It never uses a shell,
  runs one call at a time with a timeout and output limit, and logs no mail
  content. Nothing in the app calls it yet.
- `src/jev` classifies one normalized thread with Jev through the official
  TypeSafe SDK. It sends a minimized state: the latest five messages with
  quoted history, URL queries, and long opaque tokens removed, bounded text,
  and attachment names without contents. Email text is framed as untrusted
  data. Every response is validated; a provider failure is reported apart
  from model uncertainty. Policy in ordinary code sends ambiguous or
  low-confidence results to review, and suspicion only raises review
  priority. Nothing authorizes a mailbox action, and nothing in the app
  calls it yet.
- The only secret is `TYPESAFE_API_KEY`, read server-side from the
  environment. The SDK's logging is off and its base URL is pinned. No
  deployment configuration.
- CI runs every quality command and the build on pull requests and `main`.
- On pull requests, CI also runs commitlint and the Fallow changed-code audit.
- CI fails on `git diff --check` errors or uncommitted generated files.
- Branch protection is not configured yet, so CI results are not enforced on merge.
