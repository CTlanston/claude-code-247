import { describe, expect, it, vi } from 'vitest'
import type { Repo, ValidatorResult } from '@aedev/core'
import { DraftPrGate, DraftPrGateError, renderDraftPrBody } from './draft-pr-gate.js'

const repo: Repo = {
  id: 'repo-1',
  name: 'repo',
  path: '/tmp/repo',
  defaultBranch: 'main',
  enabled: true,
  testCommands: [],
  forbiddenPaths: ['.env*', 'secrets/**', '.github/**', 'AGENTS.md', 'CLAUDE.md'],
  riskRules: {},
  mergePolicy: 'WAITING',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const validator: ValidatorResult = {
  id: 'v1',
  taskId: 't1',
  runId: 'r1',
  validator: 'gemini',
  verdict: 'pass',
  summary: 'Looks good',
  createdAt: '2026-01-01T00:00:00.000Z',
}

describe('DraftPrGate', () => {
  it('blocks when remote writes are disabled', async () => {
    const gate = new DraftPrGate({ allowRemoteWrites: false, remoteWriteWhitelist: ['repo'] }, {
      pushBranch: vi.fn(),
    }, {
      createDraftPr: vi.fn(),
    })

    await expect(gate.openDraftPr(request())).rejects.toMatchObject({
      code: 'REMOTE_WRITES_DISABLED',
    } satisfies Partial<DraftPrGateError>)
  })

  it('blocks forbidden paths before pushing', async () => {
    const pushBranch = vi.fn()
    const gate = new DraftPrGate({ allowRemoteWrites: true, remoteWriteWhitelist: ['repo'] }, { pushBranch }, {
      createDraftPr: vi.fn(),
    })

    await expect(gate.openDraftPr(request({ changedPaths: ['.github/workflows/ci.yml'] }))).rejects.toMatchObject({
      code: 'FORBIDDEN_PATH',
    } satisfies Partial<DraftPrGateError>)
    expect(pushBranch).not.toHaveBeenCalled()
  })

  it('pushes a branch and creates a draft PR with evidence body', async () => {
    const pushBranch = vi.fn()
    const createDraftPr = vi.fn().mockResolvedValue({ number: 12, url: 'https://example/pr/12', state: 'open', draft: true })
    const gate = new DraftPrGate({ allowRemoteWrites: true, remoteWriteWhitelist: ['repo'] }, { pushBranch }, { createDraftPr })

    const out = await gate.openDraftPr(request())

    expect(out.draft).toBe(true)
    expect(pushBranch).toHaveBeenCalledOnce()
    expect(createDraftPr).toHaveBeenCalledOnce()
    expect(createDraftPr.mock.calls[0][0].body).toContain('Automatic merge is disabled')
  })
})

describe('renderDraftPrBody', () => {
  it('includes mission, evidence, risk, validator, DAG, and rollback sections', () => {
    const body = renderDraftPrBody(request())
    expect(body).toContain('Mission: m1')
    expect(body).toContain('Evidence: file:///evidence')
    expect(body).toContain('Risk score: 12')
    expect(body).toContain('gemini: pass')
    expect(body).toContain('Rollback')
  })
})

function request(overrides: Partial<Parameters<DraftPrGate['openDraftPr']>[0]> = {}): Parameters<DraftPrGate['openDraftPr']>[0] {
  return {
    repo,
    missionId: 'm1',
    title: 'Draft PR',
    branch: 'codex/m1',
    base: 'main',
    changedPaths: ['src/app.ts'],
    evidenceUri: 'file:///evidence',
    riskScore: 12,
    validatorResults: [validator],
    rollbackNotes: 'Close the draft PR and delete the branch.',
    taskDag: [{ id: 't1', title: 'Code', role: 'coder', parentIds: [], contextFiles: [], writeFiles: [], expectedEvidence: [], checkpointGate: null }],
    ...overrides,
  }
}

describe('DraftPrGate — P4 per-repo whitelist (GR#3)', () => {
  it('blocks a non-whitelisted repo even when allow_remote_writes is true', async () => {
    const pushBranch = vi.fn()
    const gate = new DraftPrGate({ allowRemoteWrites: true, remoteWriteWhitelist: ['hermus-agent'] }, { pushBranch }, { createDraftPr: vi.fn() })
    await expect(gate.openDraftPr(request())).rejects.toMatchObject({
      code: 'REPO_NOT_WHITELISTED',
    } satisfies Partial<DraftPrGateError>)
    expect(pushBranch).not.toHaveBeenCalled()
  })

  it('an empty whitelist blocks every repo (fail-closed default)', async () => {
    const gate = new DraftPrGate({ allowRemoteWrites: true, remoteWriteWhitelist: [] }, { pushBranch: vi.fn() }, { createDraftPr: vi.fn() })
    await expect(gate.openDraftPr(request())).rejects.toMatchObject({
      code: 'REPO_NOT_WHITELISTED',
    } satisfies Partial<DraftPrGateError>)
  })

  it('global flag off wins over the whitelist (double gate)', async () => {
    const gate = new DraftPrGate({ allowRemoteWrites: false, remoteWriteWhitelist: ['repo'] }, { pushBranch: vi.fn() }, { createDraftPr: vi.fn() })
    await expect(gate.openDraftPr(request())).rejects.toMatchObject({
      code: 'REMOTE_WRITES_DISABLED',
    } satisfies Partial<DraftPrGateError>)
  })
})
