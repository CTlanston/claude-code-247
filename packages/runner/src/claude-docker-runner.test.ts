import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { RunnerConfig, Task } from '@aedev/core'
import { ClaudeDockerRunner, preflightClaudeDockerEnvironment, type DockerExecRequest } from './claude-docker-runner.js'

let tmpRoot: string

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'aedev-claude-docker-test-'))
})

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

function makeTask(id = 'task-claude-docker'): Task {
  return {
    id,
    missionId: 'mission-001',
    repoId: 'repo-001',
    title: 'Test task',
    prompt: 'Implement a tiny change',
    status: 'pending',
    attemptNumber: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

function makeConfig(root: string): RunnerConfig {
  return {
    mode: 'claude-docker',
    maxConcurrentWorkers: 1,
    worktreeBaseDir: join(root, 'worktrees'),
    outputBaseDir: join(root, 'output'),
  }
}

describe('ClaudeDockerRunner', () => {
  it('preflights image and credential materialization without leaking credential paths', () => {
    const result = preflightClaudeDockerEnvironment({
      AEDEV_CLAUDE_CREDENTIAL_FILE: '/private/tmp/not-a-real-claude-credential.json',
      ANTHROPIC_API_KEY: 'api-key-must-not-be-used',
    }, {
      credentialFileProbe: () => false,
    })

    expect(result.ready).toBe(false)
    expect(result.imageConfigured).toBe(false)
    expect(result.credentialMaterialization).toBe('env-file')
    expect(result.credentialFileReadable).toBe(false)
    expect(result.apiFallbackEnvPresent).toEqual(['ANTHROPIC_API_KEY'])
    expect(result.issues.map((issue) => issue.holdCode)).toEqual([
      'HOLD-CLAUDE-DOCKER-IMAGE',
      'HOLD-CLAUDE-AUTH-IN-DOCKER',
    ])
    expect(JSON.stringify(result)).not.toContain('/private/tmp/not-a-real-claude-credential.json')
    expect(result.notes.join('\n')).toContain('stripped from the container')
  })

  it('preflights ready when an explicit image and injected credential provider are configured', () => {
    const result = preflightClaudeDockerEnvironment({}, {
      image: 'claude-worker:test',
      credentialProviderConfigured: true,
    })

    expect(result.ready).toBe(true)
    expect(result.imageConfigured).toBe(true)
    expect(result.credentialMaterialization).toBe('injected-provider')
    expect(result.credentialFileReadable).toBe(true)
    expect(result.issues).toEqual([])
  })

  it('runtime preflight probes the image for claude and a readable credential mount', async () => {
    const credentialPath = join(tmpRoot, 'credential.json')
    writeFileSync(credentialPath, '{"ok":true}')
    let cleaned = false
    let seen: DockerExecRequest | undefined
    const runner = new ClaudeDockerRunner({
      image: 'claude-worker:test',
      credentialProvider: async () => ({
        path: credentialPath,
        cleanup: () => { cleaned = true },
      }),
      runDocker: async (_bin, req) => {
        seen = req
        return { exitCode: 0, stdout: '', stderr: '' }
      },
    })

    const result = await runner.preflightRuntime()

    expect(result.ready).toBe(true)
    expect(result.dockerProbeRan).toBe(true)
    expect(result.dockerProbeExitCode).toBe(0)
    expect(cleaned).toBe(true)
    expect(seen?.stdin).toBe('')
    expect(seen?.args).toContain('claude-worker:test')
    expect(seen?.args).toContain('sh')
    expect(seen?.args.join(' ')).toContain('command -v claude')
    expect(seen?.args.some((arg) => arg === `${credentialPath}:/root/.claude/.credentials.json:ro`)).toBe(true)
  })

  it('runtime preflight redacts credential paths from docker probe failures', async () => {
    const credentialPath = join(tmpRoot, 'credential.json')
    writeFileSync(credentialPath, '{"ok":true}')
    const runner = new ClaudeDockerRunner({
      image: 'claude-worker:test',
      credentialProvider: async () => ({ path: credentialPath }),
      runDocker: async () => ({
        exitCode: 127,
        stdout: '',
        stderr: `cannot read ${credentialPath}`,
      }),
    })

    const result = await runner.preflightRuntime()

    expect(result.ready).toBe(false)
    expect(result.dockerProbeRan).toBe(true)
    expect(result.issues[0]?.holdCode).toBe('HOLD-CLAUDE-AUTH-IN-DOCKER')
    expect(result.issues[0]?.reason).toContain('<claude-credential>')
    expect(result.issues[0]?.reason).not.toContain(credentialPath)
  })

  it('requires an explicit Claude-capable Docker image', async () => {
    const runner = new ClaudeDockerRunner({
      env: {},
      credentialProvider: async () => ({ path: join(tmpRoot, 'credential.json') }),
    })

    await expect(runner.run(makeTask(), makeConfig(tmpRoot))).rejects.toThrow(/HOLD-CLAUDE-DOCKER-IMAGE/)
  })

  it('requires a materialized Claude credential by default', async () => {
    const runner = new ClaudeDockerRunner({ env: { AEDEV_CLAUDE_DOCKER_IMAGE: 'claude-worker:test' } })

    await expect(runner.run(makeTask(), makeConfig(tmpRoot))).rejects.toThrow(/HOLD-CLAUDE-AUTH-IN-DOCKER/)
  })

  it('rejects a configured credential source that is not a readable file', async () => {
    const runner = new ClaudeDockerRunner({
      env: {
        AEDEV_CLAUDE_DOCKER_IMAGE: 'claude-worker:test',
        AEDEV_CLAUDE_CREDENTIAL_FILE: join(tmpRoot, 'missing-credential.json'),
      },
    })

    await expect(runner.run(makeTask(), makeConfig(tmpRoot))).rejects.toThrow(/must point to a readable file/)
  })

  it('runs claude through docker with read-only credential mount and writes evidence', async () => {
    const credentialPath = join(tmpRoot, 'credential.json')
    writeFileSync(credentialPath, '{"ok":true}')
    let seen: DockerExecRequest | undefined
    let cleaned = false
    const runner = new ClaudeDockerRunner({
      image: 'claude-worker:test',
      credentialProvider: async () => ({
        path: credentialPath,
        cleanup: () => { cleaned = true },
      }),
      runDocker: async (_bin, req) => {
        seen = req
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            result: 'implemented the task',
            model: 'claude-opus-4-8',
            usage: { input_tokens: 123, output_tokens: 45 },
            total_cost_usd: 0.12,
          }),
          stderr: '',
        }
      },
    })

    const result = await runner.run(makeTask(), makeConfig(tmpRoot))

    expect(result.exitCode).toBe(0)
    expect(cleaned).toBe(true)
    // Image runs via its own ENTRYPOINT — no command/CMD is appended; image is the last arg.
    expect(seen?.args.at(-1)).toBe('claude-worker:test')
    // Worktree mounts at /workspace (where the entrypoint reads prompt.txt / writes result.json).
    expect(seen?.args.some((arg) => arg.endsWith(':/workspace:rw'))).toBe(true)
    // Role/model/permission/tools are passed as CLAUDE_* env per the image contract.
    expect(seen?.args).toContain('CLAUDE_ROLE=coder')
    expect(seen?.args).toContain('CLAUDE_PERMISSION_MODE=bypassPermissions')
    expect(seen?.args.some((arg) => arg.startsWith('CLAUDE_MODEL='))).toBe(true)
    expect(seen?.args.some((arg) => arg.startsWith('CLAUDE_ALLOWED_TOOLS='))).toBe(true)
    expect(seen?.args.some((arg) => arg === `${credentialPath}:/root/.claude/.credentials.json:ro`)).toBe(true)
    // ANTHROPIC_* are explicitly cleared inside the container (no paid-API fallback);
    // they appear only as empty `-e KEY=` assignments, never with a value.
    expect(seen?.args).toContain('ANTHROPIC_API_KEY=')
    expect(seen?.args.some((arg) => /^ANTHROPIC_API_KEY=.+/.test(arg))).toBe(false)

    const usage = JSON.parse(readFileSync(join(result.evidenceDir, 'model-usage.json'), 'utf8')) as Record<string, unknown>
    expect(usage['provider']).toBe('claude-docker')
    expect(usage['model']).toBe('claude-opus-4-8')
    expect(usage['inputTokens']).toBe(123)
    expect(usage['outputTokens']).toBe(45)
    expect(usage['costUsd']).toBe(0.12)
    expect(readFileSync(join(result.evidenceDir, 'transcript-summary.md'), 'utf8')).toContain('implemented the task')
    const meta = readFileSync(join(result.evidenceDir, 'docker-meta.json'), 'utf8')
    expect(meta).toContain('<claude-credential>')
    expect(meta).not.toContain(credentialPath)
  })

  it('materializes AEDEV_CLAUDE_CREDENTIAL_FILE into a temporary read-only mount source', async () => {
    const sourceCredential = join(tmpRoot, 'source-credential.json')
    writeFileSync(sourceCredential, '{"subscription":true}')
    let mountedPath = ''
    const runner = new ClaudeDockerRunner({
      env: {
        AEDEV_CLAUDE_DOCKER_IMAGE: 'claude-worker:test',
        AEDEV_CLAUDE_CREDENTIAL_FILE: sourceCredential,
      },
      runDocker: async (_bin, req) => {
        const mount = req.args.find((arg) => arg.endsWith(':/root/.claude/.credentials.json:ro')) ?? ''
        mountedPath = mount.split(':')[0] ?? ''
        expect(readFileSync(mountedPath, 'utf8')).toBe('{"subscription":true}')
        return { exitCode: 0, stdout: '{"result":"ok","usage":{"input_tokens":1,"output_tokens":1}}', stderr: '' }
      },
    })

    await runner.run(makeTask(), makeConfig(tmpRoot))

    expect(mountedPath).not.toBe(sourceCredential)
    expect(existsSync(mountedPath)).toBe(false)
  })

  it('turns claude JSON errors into a failed RunResult', async () => {
    const credentialPath = join(tmpRoot, 'credential.json')
    writeFileSync(credentialPath, '{}')
    const runner = new ClaudeDockerRunner({
      image: 'claude-worker:test',
      credentialProvider: async () => ({ path: credentialPath }),
      runDocker: async () => ({
        exitCode: 0,
        stdout: JSON.stringify({ is_error: true, result: 'auth failed', usage: { input_tokens: 0, output_tokens: 0 } }),
        stderr: '',
      }),
    })

    const result = await runner.run(makeTask(), makeConfig(tmpRoot))

    expect(result.exitCode).toBe(1)
    expect(readFileSync(join(result.evidenceDir, 'test-summary.md'), 'utf8')).toContain('Final exit code: 1')
  })

  it('injects CLAUDE_CODE_OAUTH_TOKEN (no file mount) and redacts it in docker-meta', async () => {
    let seen: DockerExecRequest | undefined
    const runner = new ClaudeDockerRunner({
      image: 'claude-worker:test',
      env: { AEDEV_CLAUDE_OAUTH_TOKEN: 'sk-ant-oat-SECRET' },
      runDocker: async (_bin, req) => {
        seen = req
        return { exitCode: 0, stdout: '{"result":"ok","usage":{"input_tokens":5,"output_tokens":7}}', stderr: '' }
      },
    })

    const result = await runner.run(makeTask(), makeConfig(tmpRoot))

    expect(result.exitCode).toBe(0)
    expect(seen?.args).toContain('CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat-SECRET')
    expect(seen?.args.some((a) => a.includes('.credentials.json'))).toBe(false)
    expect(seen?.args).toContain('ANTHROPIC_API_KEY=')
    const meta = readFileSync(join(result.evidenceDir, 'docker-meta.json'), 'utf8')
    expect(meta).not.toContain('sk-ant-oat-SECRET')
    expect(meta).toContain('<redacted>')
    expect(JSON.parse(meta).authKind).toBe('token')
  })

  it('prefers the OAuth token over a credential file when both env vars are set', async () => {
    let seen: DockerExecRequest | undefined
    const runner = new ClaudeDockerRunner({
      image: 'claude-worker:test',
      env: { AEDEV_CLAUDE_OAUTH_TOKEN: 'sk-ant-oat-PREFERRED', AEDEV_CLAUDE_CREDENTIAL_FILE: '/nonexistent/.credentials.json' },
      runDocker: async (_bin, req) => {
        seen = req
        return { exitCode: 0, stdout: '{"result":"ok","usage":{"input_tokens":1,"output_tokens":1}}', stderr: '' }
      },
    })

    await runner.run(makeTask(), makeConfig(tmpRoot))

    expect(seen?.args).toContain('CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat-PREFERRED')
    expect(seen?.args.some((a) => a.includes('.credentials.json'))).toBe(false)
  })

  it('reads authoritative token counts from /workspace/cli-envelope.json over result.json', async () => {
    const task = makeTask()
    const config = makeConfig(tmpRoot)
    const workdir = join(config.worktreeBaseDir, task.id)
    const runner = new ClaudeDockerRunner({
      image: 'claude-worker:test',
      env: { AEDEV_CLAUDE_OAUTH_TOKEN: 'sk-ant-oat-x' },
      // The patched runner:e2e1 entrypoint writes cli-envelope.json (raw CLI usage)
      // and result.json (coder-authored, usage 0) into /workspace; emulate that.
      runDocker: async () => {
        writeFileSync(join(workdir, 'cli-envelope.json'), JSON.stringify({
          result: 'done', model: 'claude-sonnet-4-6',
          usage: { input_tokens: 222, output_tokens: 888 }, total_cost_usd: 0.05,
        }))
        writeFileSync(join(workdir, 'result.json'), JSON.stringify({
          summary: 'coder self-report', usage: { input_tokens: 0, output_tokens: 0 },
        }))
        return { exitCode: 0, stdout: '', stderr: '' }
      },
    })

    const result = await runner.run(task, config)

    const usage = JSON.parse(readFileSync(join(result.evidenceDir, 'model-usage.json'), 'utf8')) as Record<string, unknown>
    expect(usage['inputTokens']).toBe(222)   // from cli-envelope, NOT result.json's 0
    expect(usage['outputTokens']).toBe(888)
    expect(usage['costUsd']).toBe(0.05)
  })
})
