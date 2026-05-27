import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: [
      'packages/*/src/**/*.test.ts',
      'apps/*/src/**/*.test.ts',
    ],
    // Subprocess-spawning tests (docker-runner, preview-adapter, bridge-runner)
    // run fake binaries via child_process; under heavy parallel load the
    // spawn handshake can drift past the default 5s. 30s gives ~6x headroom
    // while still failing fast on real hangs.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
