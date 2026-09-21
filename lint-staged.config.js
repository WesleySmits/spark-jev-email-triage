export default {
  '*.{js,ts,tsx}': ['prettier --write', 'eslint --max-warnings=0 --no-warn-ignored'],
  '*.{json,md,yml,yaml,css}': 'prettier --write',
}
