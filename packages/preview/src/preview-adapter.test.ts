/**
 * Real-behavior tests for the preview adapters.  Uses fake `wrangler` and
 * `vercel` shell scripts in a temp dir so the full subprocess pipeline
 * runs without either CLI installed.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { writeFileSync, chmodSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { CloudflarePagesAdapter } from './cloudflare-pages-adapter.js'
import { VercelAdapter } from './vercel-adapter.js'
import { GitHubPagesAdapter } from './github-pages-adapter.js'

let tmpRoot: string
let fakeWranglerOk: string
let fakeWranglerErr: string
let fakeVercelOk: string

beforeAll(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'aedev-preview-test-'))

  fakeWranglerOk = join(tmpRoot, 'fake-wrangler-ok.sh')
  writeFileSync(
    fakeWranglerOk,
    [
      '#!/bin/sh',
      'if [ "$1" = "--version" ]; then echo "wrangler 3.42 (fake)"; exit 0; fi',
      '# wrangler pages deploy <dir> --project-name <name>',
      'echo "✨ Uploaded 1 files (0 already uploaded)"',
      'echo "✨ Deployment complete! Take a peek over at https://abc123.my-project.pages.dev"',
      'exit 0',
    ].join('\n') + '\n',
  )
  chmodSync(fakeWranglerOk, 0o755)

  fakeWranglerErr = join(tmpRoot, 'fake-wrangler-err.sh')
  writeFileSync(
    fakeWranglerErr,
    [
      '#!/bin/sh',
      'if [ "$1" = "--version" ]; then echo "wrangler 3.42"; exit 0; fi',
      'echo "Error: invalid token" 1>&2',
      'exit 2',
    ].join('\n') + '\n',
  )
  chmodSync(fakeWranglerErr, 0o755)

  fakeVercelOk = join(tmpRoot, 'fake-vercel-ok.sh')
  writeFileSync(
    fakeVercelOk,
    [
      '#!/bin/sh',
      'if [ "$1" = "--version" ]; then echo "Vercel CLI 32 (fake)"; exit 0; fi',
      'echo "https://my-project-abc123.vercel.app"',
      'exit 0',
    ].join('\n') + '\n',
  )
  chmodSync(fakeVercelOk, 0o755)
})

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

const REQ = { outputDir: '/tmp/build', projectName: 'demo' }

describe('CloudflarePagesAdapter', () => {
  it('returns requiresSecretGrant when no token is supplied', async () => {
    const original = process.env['AEDEV_CLOUDFLARE_API_TOKEN']
    delete process.env['AEDEV_CLOUDFLARE_API_TOKEN']
    try {
      const adapter = new CloudflarePagesAdapter({ wranglerBin: fakeWranglerOk })
      const result = await adapter.deploy(REQ)
      expect(result.url).toBeNull()
      expect(result.requiresSecretGrant).toBe(true)
      expect(result.requiredSecretName).toBe('AEDEV_CLOUDFLARE_API_TOKEN')
      expect(result.error).toBeUndefined()
    } finally {
      if (original !== undefined) process.env['AEDEV_CLOUDFLARE_API_TOKEN'] = original
    }
  })

  it('extracts the pages.dev URL from a successful wrangler deploy', async () => {
    const adapter = new CloudflarePagesAdapter({ wranglerBin: fakeWranglerOk })
    const result = await adapter.deploy({ ...REQ, token: 'cf-token' })
    expect(result.url).toBe('https://abc123.my-project.pages.dev')
    expect(result.requiresSecretGrant).toBe(false)
    expect(result.provider).toBe('cloudflare-pages')
    expect(result.error).toBeUndefined()
  })

  it('returns error (not requiresSecretGrant) when wrangler exits non-zero', async () => {
    const adapter = new CloudflarePagesAdapter({ wranglerBin: fakeWranglerErr })
    const result = await adapter.deploy({ ...REQ, token: 'cf-token' })
    expect(result.url).toBeNull()
    expect(result.requiresSecretGrant).toBe(false)
    expect(result.error).toContain('invalid token')
  })

  it('isAvailable returns false when the binary is missing', async () => {
    const adapter = new CloudflarePagesAdapter({ wranglerBin: '/no/such/wrangler' })
    expect(await adapter.isAvailable()).toBe(false)
  })

  it('isAvailable returns true with the fake binary', async () => {
    const adapter = new CloudflarePagesAdapter({ wranglerBin: fakeWranglerOk })
    expect(await adapter.isAvailable()).toBe(true)
  })

  it('honors a custom tokenEnvVar', async () => {
    const original = process.env['MY_CUSTOM_TOKEN']
    delete process.env['MY_CUSTOM_TOKEN']
    try {
      const adapter = new CloudflarePagesAdapter({ wranglerBin: fakeWranglerOk, tokenEnvVar: 'MY_CUSTOM_TOKEN' })
      const result = await adapter.deploy(REQ)
      expect(result.requiresSecretGrant).toBe(true)
      expect(result.requiredSecretName).toBe('MY_CUSTOM_TOKEN')
    } finally {
      if (original !== undefined) process.env['MY_CUSTOM_TOKEN'] = original
    }
  })
})

describe('VercelAdapter', () => {
  it('returns requiresSecretGrant when no token is supplied', async () => {
    const original = process.env['AEDEV_VERCEL_TOKEN']
    delete process.env['AEDEV_VERCEL_TOKEN']
    try {
      const adapter = new VercelAdapter({ vercelBin: fakeVercelOk })
      const result = await adapter.deploy(REQ)
      expect(result.url).toBeNull()
      expect(result.requiresSecretGrant).toBe(true)
      expect(result.requiredSecretName).toBe('AEDEV_VERCEL_TOKEN')
    } finally {
      if (original !== undefined) process.env['AEDEV_VERCEL_TOKEN'] = original
    }
  })

  it('extracts the vercel.app URL from a successful deploy', async () => {
    const adapter = new VercelAdapter({ vercelBin: fakeVercelOk })
    const result = await adapter.deploy({ ...REQ, token: 'vercel-token' })
    expect(result.url).toBe('https://my-project-abc123.vercel.app')
    expect(result.provider).toBe('vercel')
    expect(result.requiresSecretGrant).toBe(false)
    expect(result.error).toBeUndefined()
  })
})

describe('GitHubPagesAdapter', () => {
  it('returns an explanatory error since GH Pages is static-only', async () => {
    const adapter = new GitHubPagesAdapter()
    expect(await adapter.isAvailable()).toBe(true)
    const result = await adapter.deploy(REQ)
    expect(result.url).toBeNull()
    expect(result.provider).toBe('github-pages')
    expect(result.requiresSecretGrant).toBe(false)
    expect(result.error).toContain('static')
    expect(result.meta['note']).toContain('static-only')
  })
})
