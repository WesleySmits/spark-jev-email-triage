import js from '@eslint/js'
import { builtinModules } from 'node:module'
import prettier from 'eslint-config-prettier'
import reactHooks from 'eslint-plugin-react-hooks'
import storybook from 'eslint-plugin-storybook'
import { defineConfig, globalIgnores } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'

// The plugin types declare `files?: undefined` and `plugins?: undefined`,
// which exactOptionalPropertyTypes rejects. At runtime these are plain flat
// configs, so re-type them as such.
const storybookRecommended = /** @type {import('eslint').Linter.Config[]} */ (
  /** @type {unknown} */ (storybook.configs['flat/recommended'])
)

const serverOnlyMessage =
  'Spark, Jev, shadow triage, TypeSafe, *.server and *.functions code is server-only.'
const serverOnly = [
  '**/*.server',
  '**/*.functions',
  '**/spark',
  '**/spark/**',
  '**/jev',
  '**/jev/**',
  '**/shadow',
  '**/shadow/**',
  '@typesafe-ai/*',
]

/** @param {string[]} extraServerOnly */
function browserOnlyImports(extraServerOnly) {
  const message = 'Storybook and components run in the browser.'
  return {
    paths: builtinModules.map((name) => ({ name, message })),
    patterns: [
      { group: ['node:*'], message },
      { group: [...serverOnly, ...extraServerOnly], message: serverOnlyMessage },
    ],
  }
}

export default defineConfig(
  globalIgnores(['dist/', '.output/', '.tanstack/', 'storybook-static/', 'src/routeTree.gen.ts']),
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
  },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  reactHooks.configs.flat.recommended,
  storybookRecommended,
  {
    // Storybook and the components run in the browser. Keep server code and secrets out.
    files: ['.storybook/preview.ts', 'src/**/*.stories.tsx', 'src/components/**/*.{ts,tsx}'],
    // Tests run in Node.
    ignores: ['**/*.test.{ts,tsx}'],
    rules: { 'no-restricted-imports': ['error', browserOnlyImports([])] },
  },
  {
    // A story inside a server-only folder would reach it through `./`.
    files: ['src/{spark,jev,shadow}/**/*.stories.tsx'],
    rules: { 'no-restricted-imports': ['error', browserOnlyImports(['./*', '../*'])] },
  },
  {
    // Routes render. They read mail only through a seam in `src/app`, which
    // is where the server boundary and the provider stay.
    files: ['src/routes/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: serverOnly, message: serverOnlyMessage }] },
      ],
    },
  },
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  prettier,
)
