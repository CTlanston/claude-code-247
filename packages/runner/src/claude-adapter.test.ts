/**
 * Real-behavior tests for ClaudeCodeAdapter.
 *
 * The unit tests use a fake `claude` binary written to a temp directory so the
 * full subprocess pipeline (spawn → stdin → stdout → JSON parse → result) is
 * exercised without requiring the real `claude` CLI on the test machine.
 *
 * The opt-in smoke tests at the bottom invoke the real `claude` CLI when
 * `AEDEV_SMOKE_CLAUDE=1` is set.  They are skipped by default.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { writeFileSync, chmodSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { ClaudeCodeAdapter } from './claude-adapter.js'

let tmpRoot: string
let fakeClaudeOk: string
let fakeClaudeErr: string
let fakeClaudeSlow: string

beforeAll(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'aedev-claude-adapter-test-'))

  // Fake claude that emits a successful JSON response.  Reads & discards stdin.
  fakeClaudeOk = join(tmpRoot, 'fake-claude-ok.sh')
  writeFileSync(
    fakeClaudeOk,
    [
      '#!/bin/sh',
      'cat > /dev/null',
      `echo '{"result":"hello from fake","is_error":false,"usage":{"input_tokens":3,"output_tokens":2},"total_cost_usd":0.0001,"session_id":"fake","duration_ms":10,"num_turns":1,"stop_reason":"end_turn"}'`,
      'exit 0',
    ].join('\n') + '\n',
  )
  chmodSync(fakeClaudeOk, 0o755)

  // Fake claude that emits an error JSON and exits non-zero.
  fakeClaudeErr = join(tmpRoot, 'fake-claude-err.sh')
  writeFileSync(
    fakeClaudeErr,
    [
      '#!/bin/sh',
      'cat > /dev/null',
      `echo '{"result":"","is_error":true}' `,
      'echo "boom" 1>&2',
      'exit 2',
    ].join('\n') + '\n',
  )
  chmodSync(fakeClaudeErr, 0o755)

  // Fake claude that sleeps longer than the test timeout.
  fakeClaudeSlow = join(tmpRoot, 'fake-claude-slow.sh')
  writeFileSync(
    fakeClaudeSlow,
    [
      '#!/bin/sh',
      'cat > /dev/null',
      'sleep 5',
      'exit 0',
    ].join('\n') + '\n',
  )
  chmodSync(fakeClaudeSlow, 0o755)
})

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

describe('ClaudeCodeAdapter — real subprocess', () => {
  it('parses a successful JSON response into a structured result', async () => {
    const adapter = new ClaudeCodeAdapter({ claudeBin: fakeClaudeOk })
    const result = await adapter.run('hello prompt', tmpRoot, { systemPrompt: 'sys' })

    expect(result.exitCode).toBe(0)
    expect(result.transcript).toBe('hello from fake')
    expect(result.inputTokens).toBe(3)
    expect(result.outputTokens).toBe(2)
    expect(result.costUsd).toBe(0.0001)
    expect(result.error).toBeUndefined()
    expect(result.rawJson['session_id']).toBe('fake')
  })

  it('reports stderr and non-zero exit code as an error', async () => {
    const adapter = new ClaudeCodeAdapter({ claudeBin: fakeClaudeErr })
    const result = await adapter.run('p', tmpRoot)

    expect(result.exitCode).toBe(2)
    expect(result.error).toContain('boom')
    expect(result.rawJson['is_error']).toBe(true)
  })

  it('enforces the timeout by SIGTERM and returns exitCode 124', async () => {
    const adapter = new ClaudeCodeAdapter({ claudeBin: fakeClaudeSlow })
    const result = await adapter.run('p', tmpRoot, { timeoutMs: 150 })

    expect(result.exitCode).toBe(124)
    expect(result.error).toMatch(/timed out/)
  })

  it('strips ANTHROPIC_API_KEY in local_claude_code auth mode', async () => {
    // Indirect check: fake claude that echoes whether the env var was present.
    const probe = join(tmpRoot, 'probe-claude.sh')
    writeFileSync(
      probe,
      [
        '#!/bin/sh',
        'cat > /dev/null',
        `if [ -z "$ANTHROPIC_API_KEY" ]; then`,
        `  echo '{"result":"no-key","is_error":false,"usage":{"input_tokens":0,"output_tokens":0}}'`,
        `else`,
        `  echo '{"result":"key-present","is_error":false,"usage":{"input_tokens":0,"output_tokens":0}}'`,
        `fi`,
      ].join('\n') + '\n',
    )
    chmodSync(probe, 0o755)

    const original = process.env['ANTHROPIC_API_KEY']
    process.env['ANTHROPIC_API_KEY'] = 'should-be-stripped'
    try {
      const adapter = new ClaudeCodeAdapter({ claudeBin: probe })
      const result = await adapter.run('p', tmpRoot, { authMode: 'local_claude_code' })
      expect(result.transcript).toBe('no-key')
      expect(result.authMode).toBe('local_claude_code')
    } finally {
      if (original === undefined) delete process.env['ANTHROPIC_API_KEY']
      else process.env['ANTHROPIC_API_KEY'] = original
    }
  })

  it('defaults to local_claude_code even when ANTHROPIC_API_KEY is present', async () => {
    const probe = join(tmpRoot, 'probe-claude-default-auth.sh')
    writeFileSync(
      probe,
      [
        '#!/bin/sh',
        'cat > /dev/null',
        `if [ -z "$ANTHROPIC_API_KEY" ]; then`,
        `  echo '{"result":"default-local","is_error":false,"usage":{"input_tokens":0,"output_tokens":0}}'`,
        `else`,
        `  echo '{"result":"silent-api-fallback","is_error":false,"usage":{"input_tokens":0,"output_tokens":0}}'`,
        `fi`,
      ].join('\n') + '\n',
    )
    chmodSync(probe, 0o755)

    const original = process.env['ANTHROPIC_API_KEY']
    process.env['ANTHROPIC_API_KEY'] = 'must-not-leak-into-default-mode'
    try {
      const adapter = new ClaudeCodeAdapter({ claudeBin: probe })
      const result = await adapter.run('p', tmpRoot)
      expect(result.transcript).toBe('default-local')
      expect(result.authMode).toBe('local_claude_code')
    } finally {
      if (original === undefined) delete process.env['ANTHROPIC_API_KEY']
      else process.env['ANTHROPIC_API_KEY'] = original
    }
  })

  it('passes ANTHROPIC_API_KEY through in anthropic_api auth mode', async () => {
    const probe = join(tmpRoot, 'probe-claude-2.sh')
    writeFileSync(
      probe,
      [
        '#!/bin/sh',
        'cat > /dev/null',
        `if [ -z "$ANTHROPIC_API_KEY" ]; then`,
        `  echo '{"result":"no-key","is_error":false,"usage":{"input_tokens":0,"output_tokens":0}}'`,
        `else`,
        `  echo '{"result":"key-present","is_error":false,"usage":{"input_tokens":0,"output_tokens":0}}'`,
        `fi`,
      ].join('\n') + '\n',
    )
    chmodSync(probe, 0o755)

    const original = process.env['ANTHROPIC_API_KEY']
    process.env['ANTHROPIC_API_KEY'] = 'present'
    try {
      const adapter = new ClaudeCodeAdapter({ claudeBin: probe })
      const result = await adapter.run('p', tmpRoot, { authMode: 'anthropic_api' })
      expect(result.transcript).toBe('key-present')
      expect(result.authMode).toBe('anthropic_api')
    } finally {
      if (original === undefined) delete process.env['ANTHROPIC_API_KEY']
      else process.env['ANTHROPIC_API_KEY'] = original
    }
  })

  it('reports spawn failure when the binary does not exist', async () => {
    const adapter = new ClaudeCodeAdapter({ claudeBin: '/definitely/not/a/real/path/claude-xyz' })
    const result = await adapter.run('p', tmpRoot)
    expect(result.exitCode).toBe(-1)
    expect(result.error).toMatch(/spawn failed/)
  })

  it('isAvailable returns false when the binary is missing', async () => {
    const adapter = new ClaudeCodeAdapter({ claudeBin: '/no/such/binary/claude' })
    expect(await adapter.isAvailable()).toBe(false)
  })
})

const smokeRunner = process.env['AEDEV_SMOKE_CLAUDE'] === '1' ? describe : describe.skip

smokeRunner('ClaudeCodeAdapter — smoke against real `claude` CLI (opt-in)', () => {
  it('round-trips a trivial prompt and returns OK', async () => {
    const adapter = new ClaudeCodeAdapter()
    expect(await adapter.isAvailable()).toBe(true)
    const result = await adapter.run(
      'Reply with the single token OK and nothing else.',
      process.cwd(),
      {
        systemPrompt: 'You are a smoke-test responder. Reply with exactly: OK',
        timeoutMs: 60_000,
      },
    )
    expect(result.exitCode).toBe(0)
    expect(result.transcript.length).toBeGreaterThan(0)
    expect(result.error).toBeUndefined()
  }, 90_000)
})
