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

const serverOnlyMessage = 'Spark, Jev, shadow triage, and TypeSafe code is server-only.'
const serverOnly = [
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
  const message = 'Storybook runs in the browser.'
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
    // Storybook runs in the browser. Keep server code and secrets out.
    files: ['.storybook/preview.ts', 'src/**/*.stories.tsx'],
    rules: { 'no-restricted-imports': ['error', browserOnlyImports([])] },
  },
  {
    // A story inside a server-only folder would reach it through `./`.
    files: ['src/{spark,jev,shadow}/**/*.stories.tsx'],
    rules: { 'no-restricted-imports': ['error', browserOnlyImports(['./*', '../*'])] },
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
