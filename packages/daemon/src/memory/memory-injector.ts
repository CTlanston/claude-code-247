import type { AedevDb } from '@aedev/core'

export class MemoryInjector {
  constructor(private db: AedevDb) {}

  getApprovedContext(repoId?: string): string {
    const items = this.db.listMemoryItems({ approved: true, repoId })
    if (items.length === 0) return ''
    return [
      '## Relevant Memory (approved)',
      '',
      ...items.map((item) => `### ${item.title}\n\`\`\`\n${item.content}\n\`\`\``),
    ].join('\n')
  }

  getSafeApprovedItems(repoId?: string) {
    const secretPattern = /PASSWORD\s*=|TOKEN\s*=|SECRET\s*=|API_KEY\s*=/i
    return this.db.listMemoryItems({ approved: true, repoId }).filter(
      (item) => !secretPattern.test(item.content)
    )
  }
}
