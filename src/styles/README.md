# Design foundations

`tokens.css` is the only token source. It declares custom properties on
`:root` and nothing else. Storybook shows every token under **Foundations**.

## Using the tokens

- Import `tokens.css` once, before any other styles, at the consumer's entry
  point: `import './styles/tokens.css'`. Nothing else is needed.
- The app does not import it yet. That is deliberate for this phase.
- Base styles are the consumer's job, not the token file's. They should set
  `color-scheme: light`, use `var(--text-ui)` and `var(--ink)` on the body, and
  include the focus and reduced-motion rules below.

## Rules

**Color**

- One accent per screen. `--accent` means selection or the primary action.
- `--attention`, `--success` and `--danger` mean review, completed, and
  disconnected or failed. Use each as a set: text, `-soft` fill, and `-line`
  border. Danger has no `-line` token; its border is `--danger`. Always pair a
  state color with a label, icon, border or structural change.
- Readable text uses `--ink`, `--ink-soft` or `--muted`. `--muted` reaches
  4.5:1 on `--paper`, `--surface`, `--surface-2` and `--canvas`.
- `--faint` is decorative only. Never use it for readable text, including
  placeholders, times and counts.
- `--line` and `--line-strong` are decorative dividers and frames.
- Borders of interactive controls (fields, secondary buttons, checkbox and
  radio marks, keyboard hints) use `--border-control`. It reaches 3:1 on
  `--paper`, `--surface` and `--surface-2`, the supported control
  backgrounds. Controls do not sit directly on `--canvas`.
- Account colors are 8px markers only, never fills.

**Type**

- One system UI family. No font files are shipped or downloaded.
- Titles use weight 750. Message text uses `--text-message` within
  `--measure-message` and never scrolls horizontally.
- Metadata is never lighter than `--muted`. Counts and keyboard hints use
  `font-variant-numeric: tabular-nums`.

**Space, shape, elevation**

- Spacing uses `--s1` to `--s6` and `--s8`. There is no `--s7`.
- `--radius-control` for controls and panels, `--radius-frame` for larger
  frames, `--radius-pill` for compact tags only.
- Prefer borders and surface shifts over shadows. `--shadow-shell` is for
  the single outer shell, `--shadow-toast` for transient feedback. Don't
  nest cards.
- Selection pairs an inset 3px `--accent` rule with `--accent-soft` and
  stronger text.

**Focus and motion**

- Every focusable element shows
  `outline: var(--focus-width) solid var(--focus)` with
  `outline-offset: var(--focus-offset)` on `:focus-visible`.
- Small state changes use `var(--duration-state) var(--ease-state)`. Don't
  animate layout columns or message content.
- Under `prefers-reduced-motion: reduce`, transition and animation durations
  collapse to near zero and smooth scrolling is off.

Contrast limits for the maintained token pairs are enforced by
`src/foundations/contrast-pairs.test.ts`.

## Decisions (2026-09-21)

1. `--muted` darkened from `#646b77` to `#5d6470`. Only the OKLCH lightness
   changed (0.526 to 0.501); hue and chroma stayed the same. It now passes
   4.5:1 on every neutral surface, `--canvas` included (4.95:1).
2. `--faint` is kept as a decorative color only.
3. Added `--border-control: #808791`, in the hue of `--line-strong`, at the
   lightest value that reaches 3:1 with margin on the supported control
   backgrounds. `--line` and `--line-strong` stay unchanged for decorative
   use.
4. Title weight stays 750.
5. The danger state border uses `--danger`; there is no `--danger-line`.
6. Storybook and sample copy are English, like the rest of the repository.

## Provenance

The source is the OpenDesign design system
`user:spark-triage-directions-design-system` (project
`ec6b0660-e90d-4608-8015-51a4d448e84c`), selected direction "Compact
workbench" from source project `51230779-25ac-4d3f-b194-7e6199dc142b`. Values
are the exported hex values, except for the decisions above. The generated
OKLCH aliases are left out because they are not proven equivalents. Control
and metadata type sizes come from the source's type preview (13/20 at 700,
11/16), and overlines from its navigation labels (10px, 800, 0.08em).
