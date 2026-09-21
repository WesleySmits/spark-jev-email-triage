import type { Preview } from '@storybook/react-vite'
import '../src/styles/tokens.css'

const preview: Preview = {
  parameters: {
    options: {
      storySort: {
        order: ['Foundations', 'Atoms', 'Molecules', 'Organisms', 'Templates', 'Pages'],
      },
    },
  },
}

export default preview
