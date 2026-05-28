import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { CodexCliAdapter } from './codex-adapter.js'

describe('CodexCliAdapter', () => {
  it('runs codex exec with safe local subscription defaults', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aedev-codex-'))
    const fake = join(dir, 'codex')
    const argvPath = join(dir, 'argv.txt')
    const stdinPath = join(dir, 'stdin.txt')
    writeFileSync(fake, [
      '#!/bin/sh',
      `printf "%s\\n" "$@" > ${JSON.stringify(argvPath)}`,
      `cat > ${JSON.stringify(stdinPath)}`,
      'printf "%s\\n" \'{"message":"done","usage":{"input_tokens":7,"output_tokens":3}}\'',
    ].join('\n'))
    chmodSync(fake, 0o755)

    const result = await new CodexCliAdapter({ codexBin: fake }).run('hello codex', dir, {
      timeoutMs: 5000,
    })

    const argv = readFileSync(argvPath, 'utf8')
    expect(argv).toContain('exec')
    expect(argv).toContain('--cd')
    expect(argv).toContain('--sandbox')
    expect(argv).toContain('workspace-write')
    expect(argv).toContain('--ask-for-approval')
    expect(argv).toContain('never')
    expect(argv).toContain('--json')
    expect(readFileSync(stdinPath, 'utf8')).toBe('hello codex')
    expect(result.exitCode).toBe(0)
    expect(result.transcript).toBe('done')
    expect(result.inputTokens).toBe(7)
    expect(result.outputTokens).toBe(3)
  })

  it('times out and reports exit 124', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aedev-codex-timeout-'))
    const fake = join(dir, 'codex')
    writeFileSync(fake, '#!/bin/sh\nsleep 5\n')
    chmodSync(fake, 0o755)

    const result = await new CodexCliAdapter({ codexBin: fake }).run('slow', dir, {
      timeoutMs: 50,
    })

    expect(result.exitCode).toBe(124)
    expect(result.error).toMatch(/timed out/)
  })
})
