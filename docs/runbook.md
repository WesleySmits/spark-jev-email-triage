# Release runbook

What it takes to release this application, and what may be claimed at each
step. Four things are decided separately and are reported separately: the
**build**, the **merge**, the **deployment**, and the **live result**. One is
never evidence for another. A green build says nothing about what is merged,
a merge says nothing about what is deployed, a healthy deployment says
nothing about whether Spark answers, and a Spark that answers on one host
says nothing about which code asked it or about any other host.

## Supported local start procedure

Run the app natively on the Mac running Spark Desktop, from a terminal in
that same logged-in macOS user session. Spark Desktop must be open and
signed in, and its `spark` CLI must be installed/enabled and executable on
that terminal's `PATH`. This is the local runtime the adapter is designed
for: it uses Spark's local IPC and the Mac's time zone. A different user,
SSH session, Linux host or container is not an equivalent verified runtime.
The repository does not pin a tested Spark Desktop/CLI version. Record the
installed versions and a successful readback on the intended Mac before
claiming live compatibility; Linux mock tests cannot establish that result.

1. Install Node.js 24 (see `.nvmrc`) and Corepack. Open Spark Desktop and
   enable/install its CLI using the instructions supplied with that Spark
   installation. `command -v spark` must find the Spark Desktop executable,
   not an unrelated program or only a shell alias. Reopen the terminal if
   the installation changed `PATH`.
2. In the repository root, in that same terminal, install the pinned pnpm
   dependencies and run the content-free provider check:

   ```sh
   corepack enable
   pnpm --version                         # 12.5.1, from packageManager
   pnpm install --frozen-lockfile
   pnpm readback:spark
   ```

   Continue when it prints `spark on this host: ready` and exits zero. It
   invokes only `spark accounts`, discards the result, and reads no message
   body or model. An empty account listing can also be ready: check the
   signed-in accounts in Spark if the inbox is empty. Do not paste raw
   `spark accounts` output into an issue.

3. Start the web process from that terminal, bound explicitly to loopback:

   ```sh
   APP_COMMIT_SHA="$(git rev-parse HEAD)" pnpm dev --host 127.0.0.1 --strictPort
   ```

   Open `http://127.0.0.1:3000`. Port 3000 must be free; stop the conflicting
   process or deliberately choose another local port. The app reads real
   mail when opened, but loading it neither classifies nor changes a mailbox.
   Stop the web process with Ctrl-C. Keep Spark open while using the app.

4. In another terminal on the same Mac, distinguish the two checks:

   ```sh
   curl -fsS http://127.0.0.1:3000/health
   pnpm readback:spark
   ```

   `/health` shows that the web handler answers and reports the configured
   commit. Only readback tests provider account discovery; neither checks
   review storage or Jev. The app retries readiness while Spark is away.

No API key or database is needed to read the inbox. An absent default
`.data/shadow-triage.sqlite` means there are no stored classifications.
To use existing judgments/reviews, set `SHADOW_DATABASE_PATH` in the terminal
that starts the app to the same local file selected by the shadow CLI's
`--db`. Relative paths resolve from the repository working directory. The
file must be a readable schema-3 database, and saving a review also needs
write access to it and its directory. An unreadable/unsupported store is
shown as unavailable, separately from Spark readiness. Follow the upgrade
section for an old database; do not run classification merely to start or
repair the app. `TYPESAFE_API_KEY` is only needed for an explicitly requested
Jev classification run, not this start procedure.

### Recovering a failed local check

Readback exits `1` for unavailable and prints fixed guidance without provider
errors, account names, environment values or secrets. Invalid command
options exit `64` before constructing a reader. Retry after the corresponding
repair:

| Reason          | Meaning and recovery                                                                                                                                                                                                          |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `missing`       | The process could not find `spark`. Install/enable Spark Desktop's CLI and fix the terminal's `PATH`; restart the app after changing its environment.                                                                         |
| `failed`        | Spark exited unsuccessfully, could not be started, timed out, or otherwise failed. Open/sign in to Spark in the same macOS user session, check executable permissions, then retry. This code cannot distinguish those causes. |
| `malformed`     | Spark answered in a form the adapter cannot parse. Check which executable `PATH` selects and CLI version compatibility. Do not share raw output.                                                                              |
| `configuration` | Readback could not construct its local reader. Check the system time zone and any `TZ` override, then restart in the Spark session. This is a CLI diagnostic, not a new browser readiness state.                              |
| `local-only`    | The app refuses a non-loopback caller before probing. Open it directly through `127.0.0.1` on the Spark Mac. The standalone local CLI does not normally produce this reason.                                                  |

Do not fix connectivity with a remote bridge, a forwarded-IP trust change,
or broader listener/request access. The mail and readiness boundary remains
loopback-only.

### What the container can run

`Dockerfile.app` packages the generated Node web server in a Linux image.
It can serve web assets and `/health` with `APP_COMMIT_SHA` set. It does not
install Spark Desktop or its CLI, include the source-based readback command,
or connect to the host Mac's Spark session. It is not the supported local
mail runtime, including when Docker itself runs on a Mac. Publishing its port
does not make host Spark available or bypass the request loopback checks.
Storybook's separate container serves component demonstrations, not live mail.

## Current operational boundary

The root route starts with ten unread Inbox messages from every readable
Spark mailbox. A person can request older ten-message pages or switch to the
same bounded reading of read Inbox mail. One continuation reads at most one
new page from each mailbox that may still have more; there is no fixed
application page ceiling and completed pages are not requested again. Filters
cover only the selected view's loaded rows. A first-page failure costs only
that mailbox; completed pages remain visible if a later page fails.
Opening a row lazily reads its body/thread. Refreshing does not classify.

Classification is the explicit `pnpm shadow --mailbox <mailbox> --apply`
workflow (see [README](../README.md#shadow-triage) for limits and exit codes).
It reads mail, sends minimized content to Jev, and writes local judgments.
The default dry run reads Spark but calls no model and writes no persistent
store. `pnpm shadow --preflight` checks a disposable database without Spark
or Jev; it is not a migration of the user's database.

The app reads those judgments and can append a category review in the same
SQLite file. `SHADOW_DATABASE_PATH` must match a CLI `--db` override. The
review server opens an existing schema-3 file for writing, without migration;
listing and body evidence open it read-only. Backups can include judgments,
reviewer account names, review timestamps and save-request records as well
as mail metadata. Treat the database and backups as private.

A review does not complete or mutate mail. Its category choice preserves the
model judgment and priority, and leaves the model's other signals showing. The
panel's "Model score" is raw category confidence, not calibrated certainty.
The panel and the reader name the grounds the run recorded for asking a
person; a record that stored none says so instead of naming a reason. A
suspicion signal is shown as a scored possibility, because policy admits one
from a deliberately low floor. There is no app control to launch
classification.

The separate Spark Done panel can archive one selected message ID only after
proposal, server-owned approval and a second confirmation. It is disabled by
default. A selected untriaged message can be proposed after its plain-text
body/thread is freshly read; no Jev classification is required. The server
still checks Inbox presence and the exact thread version before approval and
execution. If the provider returns no body result, this untriaged path is unavailable.
To enable it for a local session, set
`SPARK_DONE_ACTIONS_ENABLED=1` on the app server. The private, durable action
journal path is `SPARK_DONE_ACTION_DB_PATH` (default:
`.data/done-actions.sqlite`), separate from the shadow triage database. An
uncertain receipt blocks another automatic attempt on the same Spark message
ID; inspect Spark manually before any further action. Spark may affect
another visible copy of the message, and a new message may arrive between
preflight and the command.

## Upgrade an existing shadow database to schema 3

Do this on the machine that holds the local SQLite file before using the
review desk with an older database. Stop the app and any `pnpm shadow --apply`
run first, and keep them stopped until the upgrade has been checked. The
upgrade changes only this file. It does not read Spark, call Jev, or require
`TYPESAFE_API_KEY`. The app's read path never migrates a database.

The example uses the default database location. For another file, set `db`
to the same path used with `--db` or `SHADOW_DATABASE_PATH`. The backup contains
mail metadata and classifications; keep it private and outside Git.

```sh
db=.data/shadow-triage.sqlite
backup=.data/shadow-triage.before-upgrade.backup.sqlite
test -f "$db" && test ! -e "$backup" || exit 1
sqlite3 "$db" 'PRAGMA wal_checkpoint(TRUNCATE);'
test ! -e "$db-wal" && test ! -e "$db-shm" || exit 1
sqlite3 "$db" ".backup '$backup'"
sqlite3 "$backup" 'PRAGMA integrity_check; PRAGMA foreign_key_check; PRAGMA user_version;'
```

The backup check must print `ok`, no foreign-key rows, then `1` or `2`. If it does
not, stop and investigate the original database before changing anything.
Keep the backup until the upgraded app and stored classifications have been
checked. With the app still stopped, run:

```sh
pnpm shadow --migrate --db "$db"
sqlite3 "$db" 'PRAGMA integrity_check; PRAGMA foreign_key_check; PRAGMA user_version;'
```

The migration prints `migration ok: schema 3` or, on a repeat, `migration
skipped: schema current`. The final SQLite check must print `ok`, no
foreign-key rows, then `3`. A missing file, unsupported schema, damaged
database, or populated schema-1 `corrections` table is refused. Schema 1
upgrades through schema 2 to 3; schema 2 upgrades directly to 3. The migration
uses one SQLite transaction, so an error before commit leaves the original schema in
place. The review desk can then read the existing classifications and store
reviews. Never use `shadow --apply` merely to upgrade a database: that is a
classification run.

To roll back, stop the app and shadow runs again. Restore the backup while
all writers are stopped, then run the SQLite check. A rollback discards any
reviews written after the backup, so decide on it before resuming work.

```sh
sqlite3 "$db" 'PRAGMA wal_checkpoint(TRUNCATE);'
test ! -e "$db-wal" && test ! -e "$db-shm" || exit 1
test ! -e "$db.schema3-retained.sqlite" || exit 1
mv "$db" "$db.schema3-retained.sqlite"
cp -p "$backup" "$db"
sqlite3 "$db" 'PRAGMA integrity_check; PRAGMA foreign_key_check; PRAGMA user_version;'
```

The restored check must print `ok`, no foreign-key rows, then the original
schema version (`1` or `2`). Run an app version compatible with that schema,
or upgrade it again before starting the schema-3 app. Keep the retained file private for investigation;
do not put either SQLite file in a release report.

## 1. Build: the required check

CI is `.github/workflows/ci.yml`. The `quality` job runs the whole of
`pnpm check` — formatting, ESLint, `tsc`, Vitest, the Storybook play tests,
Fallow, both builds — plus commitlint and the Fallow changed-code audit on
pull requests, and it fails on whitespace errors or uncommitted generated
files.

For pull requests, that job also runs `pnpm eval:gate --base "$BASE_SHA"`.
It reads the base commit and current source offline. If the pinned Jev model
changed, the command requires reviewed before/after evidence over the exact
same fictitious set and applies the criterion documented in
`src/eval/README.md`. It fails closed for absent, mismatched or regressed
evidence. CI never receives `TYPESAFE_API_KEY`, never calls Jev or Spark and
never reads or changes a mailbox. Passing this release gate says nothing is
certain and authorizes no mailbox action.

A branch can require one check by name, so CI ends in one job,
`required-checks`, which waits for every other job and fails unless each
succeeded. That name is what a branch requires; adding a CI job means adding
it to that job's `needs`, and `src/release/ci-workflow.test.ts` reads the
workflow and fails the build if a job was left out. So the check a branch
requires cannot quietly stop covering what CI runs.

A cancelled run reports as cancelled, not as success, so the check must be
re-run before the pull request can merge.

### Observed repository protection

Repository settings are external to source. Read back on **2026-09-24**:

- The repository API and remote symbolic HEAD both name `main` as default.
- [Ruleset 23879348, release gates](https://github.com/WesleySmits/spark-jev-email-triage/rules/23879348)
  is active for `main` and `feature/human-triage-review`, with
  `bypass_actors: []` and `current_user_can_bypass: never`.
- Effective branch-rules responses for both branches include `pull_request`,
  `required_status_checks` with context `required-checks`, `deletion`, and
  `non_fast_forward`. Required approval count is zero and strict status
  checks are off; all three merge methods are allowed.
- Classic branch protection for `main` responds `404 Branch not protected`.
  That does **not** mean the branch lacks ruleset protection.

These observations replace the earlier claim that no ruleset exists. They
are dated evidence, not a guarantee about future settings. No protection
settings are changed by documenting them.

### Reading protection back

```sh
gh api repos/WesleySmits/spark-jev-email-triage --jq '{default_branch,allow_merge_commit,allow_squash_merge,allow_rebase_merge}'
git ls-remote --symref origin HEAD
gh api repos/WesleySmits/spark-jev-email-triage/rulesets
gh api repos/WesleySmits/spark-jev-email-triage/rulesets/23879348
gh api repos/WesleySmits/spark-jev-email-triage/rules/branches/main
gh api repos/WesleySmits/spark-jev-email-triage/rules/branches/feature/human-triage-review
gh api repos/WesleySmits/spark-jev-email-triage/branches/main/protection
```

Use the ids returned by the ruleset listing if they change. The
`rules/branches` endpoints report active ruleset rules; classic branch
protection is read separately through `branches/<branch>/protection`.
Do not infer absence of all protection from a single 404. Check effective
rules, the ruleset's enforcement and bypass actors together. If access is
refused or results cannot be verified, report protection as **unverified**,
with the endpoint and error, rather than claiming it is enabled or absent.

A check an actor is exempt from is not enforced for that actor. If a bypass
is ever added, say who is exempt whenever enforcement is reported, rather than
reporting the check as enforced for everyone.

## 2. Merge

Use `main` as the target for independent changes unless an explicit active
integration agreement says otherwise. Fetch first and check open and merged
PRs for existing work. Recent history uses purpose-prefixed task branches
such as `fix/review-response-loss` (#75) and `fix/review-db-migration` (#74);
older feature work targeted integration branches. This is observed practice,
not an enforced branch-name rule. Commit messages follow Conventional Commits
(`commitlint.config.js`, the commit hook, and PR CI).

Create an isolated worktree and a task branch from the fetched target,
leaving existing changes alone. Open a draft PR with scope and validation;
merge only through the PR once `required-checks` is green on its head commit.

Do not assume a merge method from the branch name. The repository API allows
merge, squash and rebase. PR #72 from `feature/human-triage-review` landed on
`main` as the single-parent commit `984c8e5`; the older #65 landed as the
two-parent merge `191e75c`. The old blanket claim that feature-to-main PRs
always use merge commits is therefore wrong. Record the actual target SHA
and inspect its parents before rollback, not the task branch's head SHA.

```sh
gh pr list --state all --limit 100 --json number,title,state,headRefName,baseRefName,url
gh pr view <number> --json baseRefName,headRefName,mergeCommit,mergedAt
git rev-list --parents -n 1 <target-sha>
```

## 3. Deployment: which commit is running

`Dockerfile.app` takes the commit as a build argument and keeps it in the
image:

```sh
docker build -f Dockerfile.app \
  --build-arg APP_COMMIT_SHA="$(git rev-parse HEAD)" \
  -t spark-jev-email-triage:"$(git rev-parse --short HEAD)" .
```

In Dokploy, set the build argument `APP_COMMIT_SHA` for the application. The
server reads the same name from its environment at runtime, so it can also be
set as an environment variable — but a value set by hand is a claim, while a
value baked in at build time is what the image was actually built from.
Prefer the build argument.

### Health

`GET /health` answers with the configured commit identity and health status:

```sh
curl -fsS http://<host>:3000/health
{"status":"ok","commit":"771bb2bef1f84c4c5a347e2048eb0a284165ac53"}
```

- `200` and `{"status":"ok","commit":"<40 hex>"}`: the deployment is
  reporting a syntactically valid commit identity. Compare it with the
  build/deployment record; the endpoint does not attest the running files.
- `503` and `{"status":"unidentified","reason":"unset"}`: the build carries no
  commit. `"reason":"malformed"` means something was set that is not a full
  commit; the value is never echoed back.

Health is deliberately narrow. It reads one environment variable. It opens no
database, calls no provider, reads no mailbox, and holds no address, subject
or body, so it is safe to expose to a monitor, to log and to paste into a
release report. It is **not** a check that mail can be read: a build with no
Spark can return `200` when its commit identity is set. This does not prove
that the configured SHA matches the running files or the merged commit.

`src/release/health.ts` holds that judgment, `src/release/health.server.ts`
the response, `src/routes/health.ts` the route.

Verify before pointing anything at a new deployment:

```sh
curl -fsS http://<host>:3000/health | grep -o '"commit":"[0-9a-f]\{40\}"'
```

and compare that commit with the merge commit from step 2. They must be the
same string. A deployment whose commit cannot be read is not released; it is
rolled back.

## 4. Live result: does Spark answer, where the deployment runs

Separate from health, and run deliberately:

```sh
pnpm readback:spark
spark on this host: ready
```

It makes one read-only Spark call — `spark accounts` — through the same probe
the application uses, drops the listing, and prints a status line plus fixed recovery guidance on failure. Exit codes: `0`
ready, `1` unavailable, `64` invalid options. A failure prints a coarse
reason, `missing`, `failed`, `malformed`, `local-only` or a CLI initialization
`configuration` failure, and no address,
count, subject or body. `ready` means account discovery answered; it does
not prove Inbox/body reads, writable review storage or Jev availability.

### It only speaks for the host it ran on

Spark is read through a CLI on the machine that holds the mail, so an answer
is the connectivity of that one host and of nothing else. A run on a
maintainer's Mac is a **local** result. It is not the deployed application's
connectivity, and reporting it as such would claim a thing nobody observed.

**A live deployed result comes from the deployment's own runtime**, the host
or container that serves the application:

```sh
ssh <runtime-host> 'cd <app> && pnpm readback:spark'
```

The shipped `Dockerfile.app` runtime copies only `.output`, not the source,
package scripts or `tsx` needed by `pnpm readback:spark`, and installs no
Spark CLI. Do not assume that command is available in the container. If the
probe cannot run in the deployed runtime, then
deployed connectivity is **blocked**, and blocked is what is reported. It is
not `unavailable`, which would mean the runtime asked and got no answer, and
it is certainly not `ready`. A deployment that cannot reach Spark serves a
page that says Spark is away; that is the application behaving correctly, and
it is a fact the release report should carry rather than hide.

Do not add a public endpoint to work around this. The application's own
readiness probe already answers loopback requests only, on purpose, because
mail belongs to the computer it lives on; a remotely reachable Spark probe
would be a new way to learn about someone's mail setup from off that machine.
Run the readback on the runtime, or report blocked.

### Reporting a release

The four results are written separately and none is folded into another:

> build `<sha>`: `required-checks` green
> merged as `<sha>`
> deployed commit `<sha>`, read from `GET /health` on `<host>`
> deployed Spark connectivity: `blocked` — the probe cannot run on the
> runtime (Linux container, no Spark Desktop)
> local Spark connectivity (`<maintainer's Mac>`): `ready`

Say "not run" where one of them was not run, and "blocked" where it could not
be. Nothing here licenses reporting a step that was skipped, or a host that
was never asked, as passed.

## Rollback

The deployment and the source roll back separately.

1. **Deployment.** Redeploy the previous image, or rebuild the previous
   commit with its own `APP_COMMIT_SHA`. Confirm with `GET /health` that the
   commit it answers with is the one intended. This is the fast path and
   needs no repository change.
2. **Source.** Revert through a pull request, then merge it once
   `required-checks` is green. History is not rewritten, so the reverted
   commit stays readable and can be re-applied.

   Inspect the commit being undone: `984c8e5` (#72) has one parent;
   `191e75c` (#65) has two. These examples show why branch names alone
   cannot choose a revert command:

   ```sh
   git rev-list --parents -n 1 <sha>    # one parent: ordinary commit; two: merge commit
   git revert <single-parent-sha>      # an ordinary or squashed commit
   git revert -m 1 <merge-sha>          # a merge commit, keeping its first parent
   ```

   `-m 1` on a single-parent commit fails with a mainline error, and leaving it off
   a merge commit fails too, so the check above is the whole trick. Reverting
   a merge commit backs out everything it brought in. When only one change
   is at fault, select that change's actual commit and target a revert PR at
   the branch that needs the correction.

   Step 1 needs no repository change at all, which is the point: the fast way
   back is redeploying a known commit, not editing protection. Step 2 is an
   ordinary pull request and passes the same check as any other change.

3. **When CI itself is broken** and a revert cannot go green, an authorized
   admin may change the ruleset explicitly and temporarily. The observed
   ruleset has no bypass actors,
   so this is a recorded act, not a quiet one:
   1. Read the ruleset back first and keep that copy:
      `gh api repos/WesleySmits/spark-jev-email-triage/rulesets/<id> > ruleset-before.json`
   2. Make the smallest change that unblocks the revert — set the ruleset's
      `enforcement` to `disabled`, or drop the `required_status_checks` rule —
      and say in the incident note what was changed, by whom, when and why.
   3. Merge the revert.
   4. Restore immediately from the copy, and read it back again to prove the
      rules are as they were, with `bypass_actors` still empty.

   Keep the incident record and before/after responses; audit-log access
   and retention have not been verified here. Step 4's readback closes the incident. While
   enforcement is off, the check is not enforced, and any release report
   covering that window must say so.

Force-pushing or deleting `main` or `feature/human-triage-review` is not a
rollback path; the ruleset observed above blocks both.

What rolling back cannot undo: mail the application already read is not
changed by a rollback, because mailbox access only reads. Local reviews are
writes and remain in SQLite after a code rollback. The shadow-triage
database keeps earlier judgments beside newer ones, so reverting code does
not remove judgments an older build stored; a judgment naming a rubric or
classifier build the running code no longer holds reads as stale, which is
the intended outcome and needs no clean-up.

## Privacy-safe logging

This application reads someone's mail, so the rule is: **nothing derived from
a message may be logged.** Concretely, never log or print a subject, an
address, a display name, a body, an attachment name, a message or thread id,
or a mailbox id — not in CI output, not in a health answer, not in a release
report, not in a bug report.

What may be logged is already the shape the code uses:

- `SparkLogEntry` in `src/spark/reader.ts` is one Spark call as an event
  name, the command, an outcome code, a duration and an item count, and
  nothing else. The live inbox and the readback pass `log: () => undefined`,
  so they log nothing at all.
- Provider failures reach the browser and the logs as coarse reasons —
  `missing`, `failed`, `malformed`, `local-only` — never as the provider's
  own message, which can name accounts. `src/spark/process.ts` never reads
  stderr for that reason.
- Configuration errors print field paths, never values, because a value may
  be the user's own address (`src/shadow/command.ts`).
- The quality report and run snapshots name fixtures, categories, counts and
  content-free provider codes, so they may be printed and pasted as they are
  (`src/eval/README.md`).
- `TYPESAFE_API_KEY` is the only secret. It is read server-side, the SDK's
  own logging is off, and `/health` reads no environment variable but
  `APP_COMMIT_SHA`.

When reporting an incident, name the mailbox copy by nothing at all: a count,
a status and a timestamp are enough to describe what happened.
