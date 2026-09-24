import { readFileSync } from 'node:fs'
import { parse } from 'postcss'
import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { compactOnly, compactQuery, compactWidth, WorkbenchTemplate } from './WorkbenchTemplate'

type Element = ReactElement<Record<string, unknown>>
type Props = Parameters<typeof WorkbenchTemplate>[0]

// WorkbenchTemplate is a plain function of its props, so the returned element
// shows where each slot lands. Landmarks, focus, reflow and scrolling are
// checked in Storybook.
const slots: Props = {
  topBar: <header>Top bar</header>,
  sidebar: <aside>Sidebar</aside>,
  queue: <section>Queue</section>,
  reader: <article>Reader</article>,
  mobilePane: 'reader',
}

function render(overrides: Partial<Props> = {}) {
  const root = WorkbenchTemplate({ ...slots, ...overrides }) as Element
  const [topBar, workspace, filters] = root.props['children'] as Element[]
  if (!topBar || !workspace) throw new Error('Missing workbench part')
  const [sidebar, main] = workspace.props['children'] as Element[]
  if (!sidebar || !main) throw new Error('Missing workspace part')
  const [queue, reader] = main.props['children'] as Element[]
  if (!queue || !reader) throw new Error('Missing main part')
  return { root, topBar, workspace, sidebar, main, queue, reader, filters }
}

function css() {
  return parse(readFileSync(new URL('./WorkbenchTemplate.css', import.meta.url), 'utf8'))
}

/** Declarations per selector inside the given media query, or outside any when null. */
function rules(media: string | null) {
  const found = new Map<string, Map<string, string>>()
  css().walkRules((rule) => {
    const parent = rule.parent
    const params = parent?.type === 'atrule' && 'params' in parent ? parent.params : null
    if (params !== media) return
    for (const selector of rule.selectors) {
      const declarations = found.get(selector) ?? new Map<string, string>()
      rule.walkDecls((declaration) => {
        declarations.set(declaration.prop, declaration.value)
      })
      found.set(selector, declarations)
    }
  })
  return found
}

describe('WorkbenchTemplate', () => {
  it('puts the top bar above the rail and a main area with queue and reader', () => {
    const { root, topBar, workspace, sidebar, main, queue, reader } = render()
    expect(root).toMatchObject({
      type: 'div',
      props: { className: 'workbench workbench--mobile-reader' },
    })
    expect(topBar).toBe(slots.topBar)
    expect(workspace.props['className']).toBe('workbench__workspace')
    expect(sidebar).toMatchObject({
      type: 'div',
      props: { className: 'workbench__sidebar', children: slots.sidebar },
    })
    expect(main).toMatchObject({ type: 'main', props: { className: 'workbench__main' } })
    expect(queue.props).toEqual({ className: 'workbench__queue', children: slots.queue })
    expect(reader.props).toEqual({ className: 'workbench__reader', children: slots.reader })
  })

  it('marks the mobile pane the caller chose, and adds the caller class', () => {
    expect(render({ mobilePane: 'queue', className: 'extra' }).root.props['className']).toBe(
      'workbench workbench--mobile-queue extra',
    )
  })

  it('styles with tokens only', () => {
    const values: string[] = []
    css().walkDecls((declaration) => {
      values.push(declaration.value)
    })
    expect(values.filter((value) => /#[0-9a-f]{3,8}\b/i.test(value))).toEqual([])
  })

  it('bounds the queue and lets the reader take the rest on desktop', () => {
    const desktop = rules(null)
    expect(desktop.get('.workbench')?.get('flex-direction')).toBe('column')
    expect(desktop.get('.workbench > *')?.get('flex')).toBe('none')
    const workspace = desktop.get('.workbench > .workbench__workspace')
    expect(workspace?.get('flex')).toBe('1 1 auto')
    expect(workspace?.get('min-height')).toBe('0')
    expect(workspace?.get('grid-template-columns')).toBe('184px minmax(0, 1fr)')
    expect(desktop.get('.workbench__main')?.get('grid-template-columns')).toBe(
      'clamp(280px, 30vw, 400px) minmax(0, 1fr)',
    )
    for (const pane of ['.workbench__sidebar', '.workbench__queue', '.workbench__reader']) {
      expect(desktop.get(pane)?.get('overflow-x')).toBe('hidden')
      expect(desktop.get(pane)?.get('overscroll-behavior')).toBe('contain')
    }
  })

  it('narrows the rail on smaller desktops', () => {
    expect(
      rules('(max-width: 1024px)')
        .get('.workbench > .workbench__workspace')
        ?.get('grid-template-columns'),
    ).toBe('156px minmax(0, 1fr)')
  })

  it('puts the compact filters outside main, after the workspace', () => {
    const filters = <div>Sheet</div>
    const { root, filters: rendered } = render({ filters })
    expect(rendered).toBe(filters)
    expect(root.props['children'] as unknown[]).toHaveLength(3)
    expect(render().filters).toBeUndefined()
  })

  it('drops the rail where it would leave the reader too narrow', () => {
    const compact = rules(compactQuery)
    expect(compactWidth).toBe(900)
    expect(compact.get('.workbench__sidebar')?.get('display')).toBe('none')
    expect(compact.get('.workbench > .workbench__workspace')?.get('grid-template-columns')).toBe(
      'minmax(0, 1fr)',
    )
  })

  it('leaves the compact control out of the layout while the rail is there', () => {
    const wide = rules(`(min-width: ${String(compactWidth + 1)}px)`)
    expect(wide.get(`.workbench .${compactOnly}`)?.get('display')).toBe('none')
  })

  it('shows one pane, queue or reader, at 600px and below', () => {
    const mobile = rules('(max-width: 600px)')
    for (const hidden of [
      '.workbench--mobile-reader .workbench__queue',
      '.workbench--mobile-queue .workbench__reader',
    ]) {
      expect(mobile.get(hidden)?.get('display')).toBe('none')
    }
    expect(mobile.get('.workbench__main')?.get('grid-template-columns')).toBe('minmax(0, 1fr)')
    expect(mobile.get('.workbench__queue')?.get('border-right')).toBe('0')
  })
})
