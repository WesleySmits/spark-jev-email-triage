import type { Preview } from '@storybook/react-vite'
import { MINIMAL_VIEWPORTS } from 'storybook/viewport'
import '../src/styles/tokens.css'

/**
 * Storybook's own sizes plus the widths the workbench is checked at. 390 is a
 * current phone, 600 the width where the workbench drops to one pane, 768 a
 * portrait tablet, and 640 is what a 1280px screen gives at 200% zoom.
 * 1024 is the narrowest window that still has a navigation rail.
 * `.storybook/stories.test.ts` sizes the window from this map, so a story's
 * `viewport` global means the same in Storybook and in the test run.
 */
export const viewports = {
  ...MINIMAL_VIEWPORTS,
  phone390: {
    name: 'Phone 390',
    styles: { width: '390px', height: '844px' },
    type: 'mobile',
  },
  onePane600: {
    name: 'One pane 600',
    styles: { width: '600px', height: '800px' },
    type: 'tablet',
  },
  zoom200: {
    name: 'Desktop at 200% zoom',
    styles: { width: '640px', height: '512px' },
    type: 'tablet',
  },
  tablet768: {
    name: 'Tablet 768',
    styles: { width: '768px', height: '1024px' },
    type: 'tablet',
  },
  narrowDesktop: {
    name: 'Narrow desktop 1024',
    styles: { width: '1024px', height: '768px' },
    type: 'desktop',
  },
} as const

const preview: Preview = {
  parameters: {
    viewport: { options: viewports },
    options: {
      storySort: {
        order: ['Foundations', 'Atoms', 'Molecules', 'Organisms', 'Templates', 'Pages'],
      },
    },
  },
}

export default preview
