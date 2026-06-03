process.env['NODE_ENV'] = process.env['NODE_ENV'] ?? 'test'
process.env['VITEST'] = process.env['VITEST'] ?? '1'

;(globalThis as typeof globalThis & { __AEDEV_TEST_RUNTIME__?: boolean }).__AEDEV_TEST_RUNTIME__ = true
