# Release runbook

What it takes to release this application, and what may be claimed at each
step. Four things are decided separately and are reported separately: the
**build**, the **merge**, the **deployment**, and the **live result**. One is
never evidence for another. A green build says nothing about what is merged,
a merge says nothing about what is deployed, a healthy deployment says
nothing about whether Spark answers, and a Spark that answers says nothing
about which code asked it.

## 1. Build: the required check

CI is `.github/workflows/ci.yml`. The `quality` job runs the whole of
`pnpm check` — formatting, ESLint, `tsc`, Vitest, the Storybook play tests,
Fallow, both builds — plus commitlint and the Fallow changed-code audit on
pull requests, and it fails on whitespace errors or uncommitted generated
files.

A branch can require one check by name, so CI ends in one job,
`required-checks`, which waits for every other job and fails unless each
succeeded. That name is what a branch requires; adding a CI job means adding
it to that job's `needs`, and `src/release/ci-workflow.test.ts` reads the
workflow and fails the build if a job was left out. So the check a branch
requires cannot quietly stop covering what CI runs.

A cancelled run reports as cancelled, not as success, so the check must be
re-run before the pull request can merge.

### The protection settings to apply

Protection is repository configuration, not source, so this document cannot
enforce it and neither can this repository. **As of 2026-09-23 neither `main`
nor `feature/human-triage-review` is protected and no ruleset exists** (both
branch-protection reads answer 404, `rulesets` answers `[]`), which means CI
results are advisory today: a merge is possible with the check red.

One ruleset covers both branches. Apply it with a token that may administer
the repository:

```sh
gh api -X POST repos/WesleySmits/spark-jev-email-triage/rulesets \
  --input - <<'JSON'
{
  "name": "release gates",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [
    { "actor_type": "RepositoryRole", "actor_id": 5, "bypass_mode": "always" }
  ],
  "conditions": {
    "ref_name": {
      "include": ["refs/heads/main", "refs/heads/feature/human-triage-review"],
      "exclude": []
    }
  },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": false,
        "required_status_checks": [{ "context": "required-checks" }]
      }
    }
  ]
}
JSON
```

What each part is for, and why it is no larger than this:

- **`pull_request`, zero approvals.** Every change reaches these branches
  through a pull request, which is what makes a status check able to block a
  merge at all. Zero approvals, because this repository has one maintainer;
  raising it later changes nothing else here.
- **`required_status_checks: required-checks`.** The one name CI ends in. No
  other context is listed, so the required set does not have to be edited
  when CI gains a job.
- **`strict_required_status_checks_policy: false`.** A branch does not have
  to be rebased on its target before merging. Strict would re-run CI for
  every intervening merge; the check itself is unaffected.
- **`deletion` and `non_fast_forward`.** These branches cannot be deleted or
  force-pushed, so history cannot be rewritten under a merged release.
- **`bypass_actors`: the repository admin role, `always`.** This is the
  rollback path. A revert still goes through a pull request in the ordinary
  case, but an admin can act when CI itself is broken. Without a bypass, a
  repository whose CI cannot run is a repository that cannot be rolled back.
  Confirm in the read-back that actor id 5 is the admin role for this
  repository.

`actor_id` values and rule shapes are GitHub's, not this repository's. Read
the applied ruleset back rather than assuming this document applied cleanly.

### Reading protection back

```sh
gh api repos/WesleySmits/spark-jev-email-triage/rulesets
gh api repos/WesleySmits/spark-jev-email-triage/rulesets/<id>
gh api repos/WesleySmits/spark-jev-email-triage/rules/branch/main
gh api repos/WesleySmits/spark-jev-email-triage/rules/branch/feature/human-triage-review
```

The last two answer with the rules that apply to a branch, whether they come
from a ruleset or from classic branch protection, which is the read that
matters. Enforcement may be claimed only once that read shows the
`pull_request` and `required_status_checks` rules on both branches, with
`required-checks` as the context. Until then, say that the check exists and
that protection is not applied.

## 2. Merge

Merge through the pull request, once `required-checks` is green on the head
commit. Record the merge commit: that SHA, and no branch name, is what a
deployment is built from and what a rollback goes back to.

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

`GET /health` answers with the commit and nothing else:

```sh
curl -fsS http://<host>:3000/health
{"status":"ok","commit":"771bb2bef1f84c4c5a347e2048eb0a284165ac53"}
```

- `200` and `{"status":"ok","commit":"<40 hex>"}`: the deployment is
  identified, and that commit is what is running.
- `503` and `{"status":"unidentified","reason":"unset"}`: the build carries no
  commit. `"reason":"malformed"` means something was set that is not a full
  commit; the value is never echoed back.

Health is deliberately narrow. It reads one environment variable. It opens no
database, calls no provider, reads no mailbox, and holds no address, subject
or body, so it is safe to expose to a monitor, to log and to paste into a
release report. It is **not** a check that mail can be read: a build with no
Spark is healthy, because the deployed code is exactly what was merged.

`src/release/health.ts` holds that judgment, `src/release/health.server.ts`
the response, `src/routes/health.ts` the route.

Verify before pointing anything at a new deployment:

```sh
curl -fsS http://<host>:3000/health | grep -o '"commit":"[0-9a-f]\{40\}"'
```

and compare that commit with the merge commit from step 2. They must be the
same string. A deployment whose commit cannot be read is not released; it is
rolled back.

## 4. Live result: does Spark answer

Separate from health, and run deliberately:

```sh
pnpm readback:spark
spark: ready
```

It makes one read-only Spark call — `spark accounts` — through the same probe
the application uses, drops the listing, and prints one line. Exit codes: `0`
ready, `1` unavailable, `64` invalid options. A failure prints a coarse
reason, `missing`, `failed`, `malformed` or `local-only`, and no address,
count, subject or body.

It runs where Spark runs, which is the Mac holding the mail, and it says
nothing about which build is deployed. Report it as its own result:

> build `<sha>` green · merged as `<sha>` · deployed commit `<sha>` from
> `/health` · `pnpm readback:spark`: ready

Say "not run" where one of the four was not run. Nothing here licenses
reporting a step that was skipped as passed.

## Rollback

The deployment and the source roll back separately.

1. **Deployment.** Redeploy the previous image, or rebuild the previous
   commit with its own `APP_COMMIT_SHA`. Confirm with `GET /health` that the
   commit it answers with is the one intended. This is the fast path and
   needs no repository change.
2. **Source.** Revert through a pull request: `git revert -m 1 <merge sha>`
   on a branch, then merge it once `required-checks` is green. History is not
   rewritten, so the reverted commit stays readable and can be re-applied.
3. **When CI itself is broken**, an admin may bypass the ruleset, which is
   why `bypass_actors` holds the admin role. Write down what was bypassed and
   why, and restore the ordinary path before the next release.

Force-pushing or deleting `main` or `feature/human-triage-review` is not a
rollback path and the ruleset refuses both.

What rolling back cannot undo: mail the application already read is not
changed by a rollback, because the application only reads. The shadow-triage
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
