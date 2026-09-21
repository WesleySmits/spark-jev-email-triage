import './KeyboardHint.css'

type KeyboardHintProps = Readonly<{
  /** The key as printed on the keyboard, for example `/`, `J` or `E`. */
  children: string
}>

/**
 * A key the user can press, shown next to the action it triggers.
 *
 * @example
 * import { KeyboardHint } from '../atoms/KeyboardHint/KeyboardHint'
 *
 * <KeyboardHint>E</KeyboardHint>
 */
export function KeyboardHint({ children }: KeyboardHintProps) {
  return <kbd className="st-keyboard-hint">{children}</kbd>
}
