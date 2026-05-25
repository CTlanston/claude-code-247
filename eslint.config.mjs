import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.venv/**',
      'eslint.config.mjs',
      'vitest.config.ts',
      'apps/dashboard/dist/**',
    ],
  },
  {
    files: ['packages/*/src/**/*.ts', 'packages/*/src/**/*.tsx', 'apps/*/src/**/*.ts', 'apps/*/src/**/*.tsx'],
  },
)
