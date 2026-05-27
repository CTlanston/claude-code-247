/** Minimal Prometheus-style metrics registry — Stage J L1.
 *  Real prod will swap in prom-client; the contract surface stays. */

type LabelKV = Record<string, string | number>

interface Series {
  type: 'counter' | 'gauge'
  help: string
  values: Map<string, number>
}

function labelKey(labels: LabelKV | undefined): string {
  if (!labels) return ''
  return Object.keys(labels)
    .sort()
    .map((k) => `${k}="${String(labels[k])}"`)
    .join(',')
}

function renderLabelSet(k: string): string {
  return k.length === 0 ? '' : `{${k}}`
}

export class PromRegistry {
  private readonly series = new Map<string, Series>()

  counter(name: string, help: string): void {
    if (!this.series.has(name)) this.series.set(name, { type: 'counter', help, values: new Map() })
  }

  gauge(name: string, help: string): void {
    if (!this.series.has(name)) this.series.set(name, { type: 'gauge', help, values: new Map() })
  }

  inc(name: string, labels?: LabelKV, by = 1): void {
    const s = this.series.get(name)
    if (!s || s.type !== 'counter') throw new Error(`counter not registered: ${name}`)
    const k = labelKey(labels)
    s.values.set(k, (s.values.get(k) ?? 0) + by)
  }

  set(name: string, value: number, labels?: LabelKV): void {
    const s = this.series.get(name)
    if (!s || s.type !== 'gauge') throw new Error(`gauge not registered: ${name}`)
    const k = labelKey(labels)
    s.values.set(k, value)
  }

  render(): string {
    const lines: string[] = []
    for (const [name, s] of this.series) {
      lines.push(`# HELP ${name} ${s.help}`)
      lines.push(`# TYPE ${name} ${s.type}`)
      for (const [k, v] of s.values) {
        lines.push(`${name}${renderLabelSet(k)} ${v}`)
      }
    }
    return lines.join('\n') + '\n'
  }
}

/** Workbook §3 Stage J: 5 new gauges. */
export function registerStandardGauges(reg: PromRegistry): void {
  reg.gauge('holds_open', 'Currently-open HOLDs across all tasks')
  reg.gauge('approval_pending', 'Currently-pending approvals')
  reg.gauge('session_health', 'CLI session health: 0=unknown, 1=healthy, 2=expired')
  reg.gauge('subscription_calls_24h', 'CLI subscription calls in the last 24h')
  reg.gauge('moves_in_flight', 'Move sagas currently in progress')
}
