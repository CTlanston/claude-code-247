import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { allowRemoteWritesEnabled, remoteWriteWhitelist } from './remote-write-policy.js'

let stateDir: string
const savedEnv: Record<string, string | undefined> = {}
const KEYS = ['AEDEV_ALLOW_REMOTE_WRITES', 'AEDEV_REMOTE_WRITE_WHITELIST', 'HOME'] as const

beforeEach(() => {
  stateDir = join(tmpdir(), `aedev-rw-policy-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(stateDir, { recursive: true })
  for (const k of KEYS) savedEnv[k] = process.env[k]
  delete process.env['AEDEV_ALLOW_REMOTE_WRITES']
  delete process.env['AEDEV_REMOTE_WRITE_WHITELIST']
  process.env['HOME'] = stateDir // keep the real ~/.aedev out of the test
})

afterEach(() => {
  for (const k of KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
  rmSync(stateDir, { recursive: true, force: true })
})

describe('remoteWriteWhitelist (P4)', () => {
  it('defaults to empty (fail-closed) with no env and no config', () => {
    expect(remoteWriteWhitelist(stateDir)).toEqual([])
  })

  it('reads a comma-separated env list (env wins over config)', () => {
    writeFileSync(join(stateDir, 'config.yaml'), 'remote_write_whitelist:\n  - from-config\n')
    process.env['AEDEV_REMOTE_WRITE_WHITELIST'] = 'hermus-agent, other-repo'
    expect(remoteWriteWhitelist(stateDir)).toEqual(['hermus-agent', 'other-repo'])
  })

  it('parses a yaml block list from config.yaml', () => {
    writeFileSync(join(stateDir, 'config.yaml'), [
      'allow_remote_writes: true',
      'remote_write_whitelist:',
      '  - hermus-agent',
      '  - "quoted-repo"',
      'other_key: 1',
      '',
    ].join('\n'))
    expect(remoteWriteWhitelist(stateDir)).toEqual(['hermus-agent', 'quoted-repo'])
    expect(allowRemoteWritesEnabled(stateDir)).toBe(true)
  })

  it('parses an inline yaml list', () => {
    writeFileSync(join(stateDir, 'config.yaml'), 'remote_write_whitelist: [hermus-agent, "x-repo"]\n')
    expect(remoteWriteWhitelist(stateDir)).toEqual(['hermus-agent', 'x-repo'])
  })
})
