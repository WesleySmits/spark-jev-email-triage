import {
  composeStories,
  setProjectAnnotations,
  type Meta,
  type StoryObj,
} from '@storybook/react-vite'
import type { Globals } from 'storybook/internal/types'
import { beforeAll, describe, expect, test } from 'vitest'
import { page } from 'vitest/browser'
import main from './main'
import preview, { viewports } from './preview'

// Storybook's portable stories: each story renders with the project's
// annotations and then runs its play function. A failed assertion fails the
// test.
const project = setProjectAnnotations([preview])
beforeAll(project.beforeAll)

type StoryFile = Readonly<Record<string, StoryObj>> & { default: Meta }

// Vite needs a literal glob here, so it repeats `stories` from main.ts. The
// first test fails when the two differ.
const glob = '../src/**/*.stories.tsx'
const files = import.meta.glob<StoryFile>('../src/**/*.stories.tsx', { eager: true })

test('finds the stories that main.ts lists', () => {
  expect(main.stories).toEqual([glob])
})

// The preview's viewport sizes in pixels, like mobile1: 320 by 568. A story
// that names one is rendered at that size here too, so what Storybook shows
// and what this run checks are the same window.
const sizes = new Map(
  Object.entries(viewports).map(([name, { styles }]) => [
    name,
    [Number.parseInt(styles.width, 10), Number.parseInt(styles.height, 10)] as const,
  ]),
)

/** The story's viewport global, like 'mobile1', or else a desktop window. */
function sizeOf(globals: Globals) {
  const viewport = globals['viewport'] as { value?: string } | undefined
  return sizes.get(viewport?.value ?? '') ?? ([1280, 1024] as const)
}

for (const [path, file] of Object.entries(files)) {
  describe(path.replace('../', ''), () => {
    for (const [name, story] of Object.entries(composeStories(file))) {
      test(name, async () => {
        await page.viewport(...sizeOf(story.globals))
        await story.run()
      })
    }
  })
}
