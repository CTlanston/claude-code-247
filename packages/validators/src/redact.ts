export interface RedactedEvidence {
  bundle: Record<string, string>
  removed: string[]
}

const ALLOWED = [
  /^diff-summary\.md$/,
  /^changed-files\.md$/,
  /^test-summary\.md$/,
  /^typecheck\.out$/,
  /^lint\.out$/,
  /^risk-report\.(md|json)$/,
  /^screenshot-report\.md$/,
  /^preview-url\.txt$/,
  /^mission-contract\.md$/,
  /^task-plan\.md$/,
  /^validator-result\.json$/,
]

const SECRET_PATTERNS = [
  /API_KEY\s*=/gi,
  /TOKEN\s*=/gi,
  /SECRET\s*=/gi,
  /PASSWORD\s*=/gi,
]

const FORBIDDEN_KEYS = [
  /transcript/i,
  /conversation/i,
  /model/i,
  /retry/i,
  /token/i,
  /cost/i,
]

export function redactForValidator(bundle: Record<string, string>): RedactedEvidence {
  const redacted: Record<string, string> = {}
  const removed: string[] = []

  for (const [name, content] of Object.entries(bundle)) {
    if (FORBIDDEN_KEYS.some((re) => re.test(name)) || !ALLOWED.some((re) => re.test(name))) {
      removed.push(name)
      continue
    }
    let clean = content
    for (const pattern of SECRET_PATTERNS) {
      clean = clean.replace(pattern, '[redacted-secret]=')
    }
    redacted[name] = clean
  }

  return { bundle: redacted, removed }
}
