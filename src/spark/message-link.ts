/**
 * Whether this app can open one exact selected message in Spark.
 *
 * It cannot, and nothing here pretends otherwise. There is no `available:
 * true` form of `SparkMessageLink`, so no caller can be handed a link that
 * was never proved to work, and a UI reading this can only disable the
 * control and say why.
 *
 * What was looked at, 2026-09-26:
 * - `src/spark/commands.ts` is the complete set of Spark CLI calls this app
 *   may build: `accounts`, `emails` and `thread`. No `open`, `reveal` or
 *   `show` command exists in it, and the guarded Done path adds only
 *   `action markAsDone <id>`, which acts rather than opens.
 * - The repository documents no Spark URL scheme, and none is recorded in
 *   any adapter, fixture or runbook.
 * - Spark's own help describes a desktop deep link, `readdle-spark://bl=`,
 *   which Spark's Command Center copies for the message a person already
 *   selected there. Its payload is opaque, and nothing documents building
 *   one from the numeric message id a listing returns, which is the only id
 *   this app holds. A link a person must first obtain inside Spark cannot
 *   open the row they selected here.
 * - Nothing could be executed to prove one either way: Spark's CLI ships
 *   with Spark Desktop for macOS and, as `docs/runbook.md` states, the app
 *   is only supported when run on the Mac running that Spark session.
 *   `command -v spark` finds nothing on this Linux host, so neither
 *   `spark --help` nor any candidate scheme could be run here.
 *
 * A scheme read off a help page is not evidence that this app can build one.
 * Proving it means, on the Mac running Spark: listing the CLI's own
 * commands, and turning a message id that `spark emails` just returned into
 * an opened message, observing that Spark selects that exact message. Until
 * a person records that, this stays unavailable, and a message id remains
 * something to show and copy rather than something to follow.
 */

/**
 * Nothing proved a way to open one exact message in Spark:
 * - `unproven`: no command and no URL scheme was executed and observed to
 *   select the selected message on the host that runs Spark, and no
 *   documented way exists to build one from a provider message id.
 */
export type SparkMessageLink = Readonly<{ available: false; reason: 'unproven' }>

/** The only answer this app may give about opening a message in Spark. */
export const sparkMessageLink: SparkMessageLink = { available: false, reason: 'unproven' }
