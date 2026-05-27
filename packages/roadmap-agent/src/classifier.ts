/** Stage M2 — classifier: route a candidate proposal to a track. */

export type ProposalTrack = 'fast-track' | 'standard' | 'blocked'

export interface ClassifiedProposal {
  id: string
  text: string
  track: ProposalTrack
  reason: string
}

const TYPO_RE = /\b(typo|fix typo|spelling|grammar|wording|punctuat|copy[-\s]edit)\b/i
const DOC_RE = /\b(docs?|README|comment|wording|rename)\b/i
const SECURITY_RE = /\b(security|vulnerab|cve|leak|secret|0day|exploit)\b/i
const RISKY_RE = /\b(database migration|breaking change|deprecat|drop column|rename column)\b/i
const BLOCKED_RE = /\b(blocked|waiting on|TODO\s*:\s*blocked)\b/i

export function classify(item: { id: string; text: string }): ClassifiedProposal {
  const t = item.text
  if (BLOCKED_RE.test(t)) return { ...item, track: 'blocked', reason: 'matches blocked marker' }
  if (TYPO_RE.test(t)) return { ...item, track: 'fast-track', reason: 'typo / copy-edit class' }
  if (DOC_RE.test(t)) return { ...item, track: 'fast-track', reason: 'docs / rename / comment' }
  if (SECURITY_RE.test(t)) return { ...item, track: 'standard', reason: 'security work needs review' }
  if (RISKY_RE.test(t)) return { ...item, track: 'standard', reason: 'risky migration / breaking change' }
  return { ...item, track: 'standard', reason: 'default' }
}
