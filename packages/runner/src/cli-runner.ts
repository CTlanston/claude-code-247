import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { RunnerConfig, RunResult, Task } from '@aedev/core'
import { generateId } from '@aedev/core'
import { ClaudeCodeAdapter } from './claude-adapter.js'
import { CodexCliAdapter } from './codex-adapter.js'
import type { RunnerInterface } from './runner-interface.js'

export type LocalCliKind = 'claude' | 'codex'

export class LocalCliRunner implements RunnerInterface {
  constructor(private readonly kind: LocalCliKind) {}

  async run(task: Task, config: RunnerConfig): Promise<RunResult> {
    const started = Date.now()
    const runId = generateId()
    const workdir = join(config.worktreeBaseDir, task.id)
    const evidenceDir = join(config.outputBaseDir, task.id)
    mkdirSync(workdir, { recursive: true })
    mkdirSync(evidenceDir, { recursive: true })

    const prompt = [
      task.prompt,
      '',
      'Write a concise final summary. Do not push to GitHub. Leave all evidence in the workspace.',
    ].join('\n')

    const result = this.kind === 'claude'
      ? await new ClaudeCodeAdapter().run(prompt, workdir)
      : await new CodexCliAdapter().run(prompt, workdir)

    writeFileSync(join(evidenceDir, 'transcript-summary.md'), result.transcript || '(no transcript)')
    writeFileSync(join(evidenceDir, `${this.kind}-raw.json`), JSON.stringify(result.rawJson, null, 2))
    writeFileSync(join(evidenceDir, 'test-summary.md'), [
      '# Test Summary',
      '',
      'No test command was supplied to the local CLI runner.',
      `Exit code: ${result.exitCode}`,
      result.error ? `Error: ${result.error}` : '',
    ].filter(Boolean).join('\n'))
    writeFileSync(join(evidenceDir, 'done-report.md'), [
      '# Done Report',
      '',
      `Task: ${task.id}`,
      `Runner: ${this.kind}`,
      `Exit code: ${result.exitCode}`,
    ].join('\n'))

    return {
      runId,
      taskId: task.id,
      exitCode: result.exitCode,
      evidenceDir,
      durationMs: Date.now() - started,
    }
  }
}
