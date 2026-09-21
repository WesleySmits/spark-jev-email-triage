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

Git hooks:

- `pre-commit`: lint-staged runs Prettier and ESLint on staged files.
- `commit-msg`: commitlint enforces Conventional Commits.

## Safety status

- No product features, persistence, email access, or external services.
- No secrets or deployment configuration.
- CI runs every quality command and the build on pull requests and `main`.
- On pull requests, CI also runs commitlint and the Fallow changed-code audit.
- CI fails on `git diff --check` errors or uncommitted generated files.
- Branch protection is not configured yet, so CI results are not enforced on merge.
