# Variant A design QA

Source visual truth: `/tmp/inbox-zero-variants-review-desktop.png`

Implementation evidence:

- `/tmp/inbox-zero-variant-a-incomplete.png`
- `/tmp/inbox-zero-variant-a-confirmed.png`
- `/tmp/inbox-zero-variant-a-refreshing.png`
- `/tmp/inbox-zero-variant-a-failed.png`
- `/tmp/inbox-zero-variant-a-mobile.png`
- Combined comparison: `/tmp/inbox-zero-design-qa-comparison.png`

## Capture

- State: fictional incomplete scan matching the selected Variant A mock; confirmed, refreshing, and failed contract states were also captured.
- Desktop browser viewport: 480 × 640 CSS px; component: 400 × 182 CSS px; device scale factor 1.
- Mobile browser viewport: 375 × 667 CSS px; component: 320 × 182 CSS px; device scale factor 1.
- Source image: 1440 × 900 px; focused Variant A preview crop: 411 × 366 px.
- Implementation images use one image pixel per CSS pixel. The comparison preserves each component's native scale; no density normalization was needed.
- Browser: local headless Chromium through the project's installed Playwright, because the T3 collaborative preview host explicitly reported unavailable.

## Findings

No actionable P0, P1, or P2 differences remain.

- Fonts and typography: the implementation preserves the mock's compact hierarchy while using the project's existing system-font roles and weights.
- Spacing and layout rhythm: verdict, two scope rows, and scan metadata retain the selected compact vertical structure. Desktop and 320 px mobile captures have no horizontal overflow.
- Colors and tokens: the mock's dark palette was intentionally mapped to the existing light product surfaces and semantic success, attention, and danger tokens.
- Image and asset fidelity: the component contains no imagery, logos, decorative assets, or substitute icon drawings.
- Copy and content: `not reached`, `unknown`, `incomplete`, and `failed` are explicit. A zero is shown only for the contract-confirmed state and is withheld while a refresh is pending. The command interval and non-atomic warning remain visible.
- Keyboard and accessibility: the status section adds no focus stop. The browser Tab check did not move focus into it; status changes use the existing live-status pattern.
- Console: no console errors or page errors occurred in incomplete, confirmed, failed, or mobile captures.

The mock's mailbox-specific retry row is intentionally not duplicated inside the status component: the existing adjacent Inbox view controls continue to own `Load older` and `Retry older`. The mock's instructional zero-rule sentence is represented by the enforced contract and the explicit per-view rows rather than persistent extra copy.

## Full-view and focused comparison

The combined comparison shows the selected mock and implementation together. The component itself is the focused region, so a second crop would not expose additional detail.

## Comparison history

- Initial comparison: no P0/P1/P2 issue. The existing-product light-token adaptation and ownership of retry controls are intentional constraints, not drift.
- No visual fix loop was required.

## Interactions tested

- Rendered fictional positive/incomplete, confirmed, refreshing, and failed states.
- Rendered the incomplete state at a 375 px mobile viewport.
- Verified no horizontal overflow.
- Pressed Tab and confirmed the informational status bar is not focusable.
- Checked browser console and uncaught page errors in every captured state.

## Implementation checklist

- [x] Compact Variant A hierarchy
- [x] Contract-gated zero claim
- [x] Complete, incomplete, failed, and unknown language
- [x] Non-atomic scan interval
- [x] Existing product tokens
- [x] Mobile reflow and keyboard neutrality

final result: passed
