import type { BuilderTaskSpec, Role, RoleContext, RoleOutput } from './role-interface.js'

/**
 * Builder role — reads the architecture + design + roadmap and emits a
 * task graph as `tasks.json` plus a human-readable `task-list.md`.  Each
 * spec carries a stable `ref`, dependency edges, and (optionally) the
 * file paths it claims so a parallel runner can detect overlap.
 *
 * MVP scope: deterministic baseline graph (scaffolding → core → UI polish
 * → tests → docs).  A later phase upgrades this to mission-aware planning
 * via `ClaudeCodeAdapter`.
 */
export class BuilderRole implements Role {
  readonly name = 'builder' as const

  async execute(ctx: RoleContext): Promise<RoleOutput> {
    const specs: BuilderTaskSpec[] = [
      {
        ref: 'scaffold',
        title: `Scaffolding for ${ctx.mission.title}`,
        prompt: `Set up the file structure described in architecture.md.  Do not implement logic yet — only stubs and types.`,
        fileOwnership: ['src/'],
      },
      {
        ref: 'core',
        title: `Core feature for ${ctx.mission.title}`,
        prompt: `Implement the core feature according to the roadmap.  Reference the PRD acceptance criteria.`,
        dependsOn: ['scaffold'],
        fileOwnership: ['src/'],
      },
    ]
    if (ctx.requiresUi) {
      specs.push({
        ref: 'ui',
        title: `UI implementation for ${ctx.mission.title}`,
        prompt: `Implement the UI according to design-brief.md.  Ensure responsive behaviour at the three documented breakpoints.`,
        dependsOn: ['core'],
        fileOwnership: ['src/components/', 'src/pages/', 'src/styles/'],
      })
    }
    specs.push({
      ref: 'tests',
      title: `Tests for ${ctx.mission.title}`,
      prompt: `Write unit + integration tests covering the acceptance criteria from the PRD.`,
      dependsOn: ctx.requiresUi ? ['core', 'ui'] : ['core'],
      fileOwnership: ['tests/', 'src/__tests__/'],
    })
    specs.push({
      ref: 'docs',
      title: `Docs for ${ctx.mission.title}`,
      prompt: `Update README and any user-facing docs to reflect the new behaviour.`,
      dependsOn: ['core'],
      fileOwnership: ['README.md', 'docs/'],
    })

    const tasksJson = JSON.stringify({ missionId: ctx.mission.id, specs }, null, 2)
    const taskList = renderTaskList(ctx.mission.id, specs)

    return {
      evidenceFiles: {
        'tasks.json': tasksJson,
        'task-list.md': taskList,
      },
      childTasks: specs,
      notes: `Builder produced ${specs.length} task specs.`,
    }
  }
}

function renderTaskList(missionId: string, specs: BuilderTaskSpec[]): string {
  const lines = [`# Task List — mission ${missionId}`, '']
  for (const s of specs) {
    const deps = s.dependsOn?.length ? `depends on: ${s.dependsOn.join(', ')}` : 'no dependencies'
    const owns = s.fileOwnership?.length ? `owns: ${s.fileOwnership.join(', ')}` : ''
    lines.push(`- **${s.ref}** — ${s.title}  (${deps}${owns ? `; ${owns}` : ''})`)
    lines.push(`    > ${s.prompt}`)
  }
  return lines.join('\n') + '\n'
}
