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
      '**/.review-venv/**',
      'eslint.config.mjs',
      'vitest.config.ts',
      'apps/dashboard/dist/**',
      'state/**',
      'workspaces/**',
      'worktrees/**',
      'logs/**',
      '.evidence/**',
      'evidence/**/state/**',
      'evidence/**/workspaces/**',
      'evidence/**/worktrees/**',
      'evidence/launch/roadmap-agent-tick-*.json',
      'evidence/launch/roadmap-agent-tick-*.md',
    ],
  },
  {
    files: ['packages/*/src/**/*.ts', 'packages/*/src/**/*.tsx', 'apps/*/src/**/*.ts', 'apps/*/src/**/*.tsx'],
  },
  // GROUND RULE 8: the `claude` CLI subprocess may run only in workers.
  // Static guard: daemon source MUST NOT import the sentinel's LlmReviewer
  // (which spawns `claude --print`) and MUST NOT spawn child_process
  // directly. Test files are exempt because they wrap spawns in fake
  // bins / inject mock spawn fns.
  {
    files: ['packages/daemon/src/**/*.ts'],
    ignores: ['packages/daemon/src/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'node:child_process',
              importNames: ['spawn', 'exec', 'execFile', 'execSync', 'execFileSync', 'spawnSync', 'fork'],
              message: 'GROUND RULE 8: daemon process must not fork subprocesses. Move this code into a worker or @aedev/chaos/real-effects sandbox helper.',
            },
            {
              name: 'child_process',
              importNames: ['spawn', 'exec', 'execFile', 'execSync', 'execFileSync', 'spawnSync', 'fork'],
              message: 'GROUND RULE 8: daemon process must not fork subprocesses.',
            },
          ],
          patterns: [
            {
              group: ['@aedev/sentinel/dist/llm-reviewer*', '@aedev/sentinel/**/llm-reviewer*'],
              message: 'GROUND RULE 8: daemon must not import LlmReviewer. Spawn the sentinel review in a worker / sidecar process.',
            },
          ],
        },
      ],
    },
  },
)
