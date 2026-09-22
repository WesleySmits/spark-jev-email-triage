import type { ReactNode } from 'react'

/**
 * Turns a plain-text mail body into MessageReader children: paragraphs,
 * quoted replies and bold text, with Markdown-like link syntax reduced to
 * words a person reads.
 *
 * Deterministic and inert. The output holds only `p`, `blockquote`, `strong`
 * and strings. It never makes links, loads images or renders HTML: a URL
 * becomes at most its hostname as text, and markup in the mail stays literal
 * text. Anything it doesn't recognise exactly is left as it was.
 *
 * - A blank line starts a new paragraph; single line breaks stay.
 * - Lines starting with `>` become a quote, nested up to eight deep.
 * - `[label](url)` shows `label`. Spark's redundant `[[label](url)](url)`
 *   form is flattened too. An empty label shows the hostname of an http(s)
 *   URL; with any other URL the text stays as written.
 * - `![alt](url)` shows `alt`, or nothing, and never loads.
 * - `**bold**` and `__bold__` lose their markers when both ends are clear.
 */
export function formatMessageBody(text: string): ReactNode[] {
  return blocks(text.replace(/\r\n?/g, '\n').split('\n'), 0)
}

const maxQuoteDepth = 8
const quoteMarker = /^[ \t]{0,3}>[ \t]?/
const isBlank = (line: string) => line.trim() === ''
const isQuoted = (line: string, depth: number) => depth < maxQuoteDepth && quoteMarker.test(line)

function blocks(lines: readonly string[], depth: number): ReactNode[] {
  const out: ReactNode[] = []
  for (let start = 0; start < lines.length;) {
    const quoted = isQuoted(lines[start] ?? '', depth)
    const belongs = quoted
      ? (line: string) => isQuoted(line, depth)
      : (line: string) => !isBlank(line) && !isQuoted(line, depth)
    // A blank line is a run of one that makes no block.
    const end = Math.max(runEnd(lines, start, belongs), start + 1)
    const run = lines.slice(start, end)
    const block = quoted ? quote(run, depth, start) : paragraph(run, start)
    if (block) out.push(block)
    start = end
  }
  return out
}

/** Index of the first line from `start` on that doesn't belong to the run. */
function runEnd(lines: readonly string[], start: number, belongs: (line: string) => boolean) {
  const end = lines.findIndex((line, index) => index >= start && !belongs(line))
  return end === -1 ? lines.length : end
}

function quote(lines: readonly string[], depth: number, key: number): ReactNode {
  const children = blocks(
    lines.map((line) => line.replace(quoteMarker, '')),
    depth + 1,
  )
  if (children.length === 0) return null
  return (
    <blockquote key={key} className="message-reader__quote">
      {children}
    </blockquote>
  )
}

function paragraph(lines: readonly string[], key: number): ReactNode {
  const text = readableLinks(lines.join('\n'))
  return isBlank(text) ? null : <p key={key}>{withBold(text)}</p>
}

// `[label](url)` or `![alt](url)`. A label holds no brackets or line breaks,
// except one whole image, as in a linked logo. A URL holds no spaces or
// angle brackets and at most balanced single parentheses, or is `<url>`.
const link =
  /(!?)\[((?:[^[\]\n]|!\[[^[\]\n]*\]\([^\s()<>]*\))*)\]\((<[^\s<>]*>|[^\s()<>]*(?:\([^\s()<>]*\)[^\s()<>]*)*)\)/g
const image = /!\[([^[\]\n]*)\]\([^\s()<>]*\)/g

/** Spark sometimes wraps one Markdown link in the same link a second time. */
function readableLinks(text: string): string {
  return text.replace(link, readableLink).replace(link, readableLink)
}

function readableLink(match: string, bang: string, label: string, target: string): string {
  const words = label.replace(image, '$1').trim()
  if (bang === '!' || words !== '') return words
  return hostname(target.replace(/^<(.*)>$/, '$1')) ?? match
}

/** The hostname of an http(s) URL, without `www.`; nothing for other URLs. */
function hostname(url: string): string | undefined {
  try {
    const { protocol, hostname } = new URL(url)
    if (protocol !== 'http:' && protocol !== 'https:') return undefined
    return hostname.replace(/^www\./, '') || undefined
  } catch {
    return undefined
  }
}

// `**text**` or `__text__`: the markers touch the text inside, which has no
// marker character or line break, and no letter, digit or marker touches them
// from outside, so `snake__case__name` and `2**8**2` stay as written.
const bold =
  /(?<![\p{L}\p{N}*_])(?:\*\*(?![\s*])([^*\n]*?[^\s*])\*\*|__(?![\s_])([^_\n]*?[^\s_])__)(?![\p{L}\p{N}*_])/gu

function withBold(text: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(bold)) {
    if (match.index > last) out.push(text.slice(last, match.index))
    out.push(<strong key={match.index}>{match[1] ?? match[2]}</strong>)
    last = match.index + match[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}
