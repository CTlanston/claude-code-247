import { mkdirSync, readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'fs'
import { join } from 'path'
import type { Mission } from '@aedev/core'
import type { Role, RoleContext, RoleOutput } from './role-interface.js'
import { ArchitectRole } from './architect-role.js'
import { DesignerRole } from './designer-role.js'
import { BuilderRole } from './builder-role.js'
import { QARole } from './qa-role.js'
import { ReviewerRole } from './reviewer-role.js'
import { ReleaseRole } from './release-role.js'

/**
 * Orchestrates the autonomous product-team role sequence for a single
 * mission.  Reads any pre-existing evidence (e.g. PRD from IntakeService)
 * into the bundle, then runs Architect → Designer → Builder → QA →
 * Reviewer → Release in order, writing each role's output back to disk
 * and merging into the bundle for the next role.
 *
 * Per ADR-0009 §product-workflow, this is the canonical order.  Roles can
 * be subclassed or replaced at construction time for tests or future
 * upgrades.
 */
export interface RolePipelineOptions {
  /** Override the default ordered role list. */
  roles?: Role[]
  /** If true, the Designer/QA UI artefacts are produced.  Default: heuristic on mission.title/description. */
  requiresUi?: boolean
  /** Per-mission risk level used by Architect/Release.  Default: 'medium'. */
  riskLevel?: 'low' | 'medium' | 'high'
}

export interface RolePipelineRunResult {
  missionId: string
  evidenceDir: string
  rolesRun: string[]
  bundle: Record<string, string>
  notes: string[]
  childTaskCount: number
}

export class RolePipeline {
  private readonly roles: Role[]

  constructor(opts: RolePipelineOptions = {}) {
    this.roles = opts.roles ?? [
      new ArchitectRole(),
      new DesignerRole(),
      new BuilderRole(),
      new QARole(),
      new ReviewerRole(),
      new ReleaseRole(),
    ]
  }

  async run(mission: Mission, evidenceDir: string, opts: RolePipelineOptions = {}): Promise<RolePipelineRunResult> {
    mkdirSync(evidenceDir, { recursive: true })
    const requiresUi = opts.requiresUi ?? heuristicRequiresUi(mission)
    const riskLevel = opts.riskLevel ?? (mission.riskLevel ?? 'medium')

    // Read any existing evidence into the bundle (e.g. PRD written by IntakeService).
    const bundle = readEvidenceDir(evidenceDir)
    // Normalize PRD filename: IntakeService writes <missionId>.md; later roles read prd.md.
    if (!bundle['prd.md']) {
      const aliases = [`${mission.id}.md`, 'PRD.md', 'prd-draft.md']
      for (const alt of aliases) {
        if (bundle[alt]) {
          bundle['prd.md'] = bundle[alt]
          writeFileSync(join(evidenceDir, 'prd.md'), bundle[alt])
          break
        }
      }
    }

    const rolesRun: string[] = []
    const notes: string[] = []
    let childTaskCount = 0

    for (const role of this.roles) {
      const ctx: RoleContext = { mission, evidenceDir, bundle, requiresUi, riskLevel }
      const out: RoleOutput = await role.execute(ctx)
      for (const [filename, content] of Object.entries(out.evidenceFiles)) {
        writeFileSync(join(evidenceDir, filename), content)
        bundle[filename] = content
      }
      if (out.childTasks?.length) childTaskCount += out.childTasks.length
      if (out.notes) notes.push(`${role.name}: ${out.notes}`)
      rolesRun.push(role.name)
    }

    // Write a manifest so consumers can replay or inspect the run.
    const manifest = {
      missionId: mission.id,
      rolesRun,
      notes,
      requiresUi,
      riskLevel,
      childTaskCount,
      generatedAt: new Date().toISOString(),
    }
    writeFileSync(join(evidenceDir, 'pipeline-manifest.json'), JSON.stringify(manifest, null, 2))

    return { missionId: mission.id, evidenceDir, rolesRun, bundle, notes, childTaskCount }
  }
}

function readEvidenceDir(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    try {
      if (statSync(full).isFile()) {
        out[entry] = readFileSync(full, 'utf-8')
      }
    } catch {
      // skip
    }
  }
  return out
}

function heuristicRequiresUi(mission: Mission): boolean {
  const haystack = `${mission.title} ${mission.description ?? ''}`.toLowerCase()
  return /(ui|page|landing|dashboard|component|frontend|button|form|design|visual|layout)/.test(haystack)
}
