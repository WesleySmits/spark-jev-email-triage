# Reviewed evaluation set

`reviewed-set.ts` holds the mail this repository measures triage against, and
the outcome a person expects for each thread. It is data and judgment only:
it calls nothing, so every test that uses it runs in CI without a provider,
a network or a secret.

## What an expectation is

An expectation is what a person decided after reading the thread against
`defaultRubric` in `src/domain/rubric.ts`: a category, a priority, whether
they want the thread in front of a human, and why in their own words.

- Expectations are written from the mail. They are never copied from a
  classifier answer, recomputed from `src/jev/policy.ts`, or adjusted to make
  a run agree. A yardstick built from what it measures measures nothing, and
  `reviewed-set.test.ts` fails if the module reaches for the classifier, the
  TypeSafe SDK or the environment.
- The reason matters as much as the labels. A later reader disagreeing with a
  call should be able to argue with the sentence rather than guess at it.
- Disagreement between the set and a classifier is a finding, not a defect in
  the set. Change an expectation only because a person re-read the mail and
  the rubric, and say so in the commit.

## The version an expectation covers

Each case names the subject and the latest message id it was reviewed at.
Provider order decides which message is latest, as everywhere else in the
domain. Editing a labelled thread therefore fails the set's test until a
person re-reads it and updates both the expectation and its `reviewedOn`
date. Labels never drift onto mail nobody reviewed.

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
mail subjects, addresses and bodies stay out of logs and public errors.
