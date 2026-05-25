import { describe, it, expect } from 'vitest'
import { existsSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createCli } from '../cli.js'

describe('aedev init', () => {
  it('creates expected directories', async () => {
    const home = join(tmpdir(), `aedev-test-${Date.now()}`)
    process.env['AEDEV_HOME'] = home
    const cli = createCli()
    await cli.parseAsync(['node', 'aedev', 'init'])
    expect(existsSync(join(home, 'state'))).toBe(true)
    expect(existsSync(join(home, 'evidence'))).toBe(true)
    expect(existsSync(join(home, 'repos.yaml'))).toBe(true)
    expect(existsSync(join(home, 'config.yaml'))).toBe(true)
    rmSync(home, { recursive: true })
    delete process.env['AEDEV_HOME']
  })

  it('is idempotent (safe to run twice)', async () => {
    const home = join(tmpdir(), `aedev-test-${Date.now()}`)
    process.env['AEDEV_HOME'] = home
    const cli = createCli()
    await cli.parseAsync(['node', 'aedev', 'init'])
    await cli.parseAsync(['node', 'aedev', 'init']) // no throw
    expect(existsSync(join(home, 'repos.yaml'))).toBe(true)
    rmSync(home, { recursive: true })
    delete process.env['AEDEV_HOME']
  })
})
