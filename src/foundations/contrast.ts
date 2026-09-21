// WCAG 2.x contrast ratio between two hex colors (#rgb or #rrggbb).
// Production CSS minification shortens #ffffff to #fff, so both forms occur.

function expand(hex: string): string {
  if (/^#[0-9a-f]{6}$/i.test(hex)) return hex
  if (/^#[0-9a-f]{3}$/i.test(hex)) {
    return hex.replace(/[0-9a-f]/gi, (digit) => digit + digit)
  }
  throw new Error(`Expected a #rgb or #rrggbb color, got "${hex}"`)
}

function channel(hex: string, offset: number): number {
  const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function luminance(color: string): number {
  const hex = expand(color)
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5)
}

export function contrastRatio(foreground: string, background: string): number {
  const a = luminance(foreground)
  const b = luminance(background)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}
