import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'

export class EvidenceWriter {
  constructor(private evidenceDir: string) {
    mkdirSync(evidenceDir, { recursive: true })
  }

  writeFile(filename: string, content: string): void {
    writeFileSync(join(this.evidenceDir, filename), content, 'utf8')
  }

  readFile(filename: string): string | null {
    const p = join(this.evidenceDir, filename)
    return existsSync(p) ? readFileSync(p, 'utf8') : null
  }

  writePlan(content: string): void { this.writeFile('plan.md', content) }
  writeDiffSummary(content: string): void { this.writeFile('diff-summary.md', content) }
  writeTestSummary(content: string): void { this.writeFile('test-summary.md', content) }
  writeDoneReport(content: string): void { this.writeFile('done-report.md', content) }
  writeValidatorReport(validator: string, content: string): void { this.writeFile(`validator-${validator}.md`, content) }
  writeRiskReport(content: string): void { this.writeFile('risk-report.md', content) }

  toBundle(): Record<string, string> {
    const bundle: Record<string, string> = {}
    if (!existsSync(this.evidenceDir)) return bundle
    for (const f of readdirSync(this.evidenceDir)) {
      const content = this.readFile(f)
      if (content !== null) bundle[f] = content
    }
    return bundle
  }
}
