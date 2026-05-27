/** Stage M1 — output sanitizer.
 *
 * The subscription CLI can return output that includes adversarial
 * tokens (e.g. `<system>` re-injection, fake JSON envelopes, base64
 * trampolines). The sanitizer's job is to detect and either redact or
 * surface a `cli.output.sanitized` event so the daemon can refuse to
 * propagate the line further.
 */

export interface SanitizeResult {
  clean: string
  redactions: Array<{ kind: string; matched: string; at: number }>
  rejected: boolean
}

const PATTERNS: Array<{ kind: string; re: RegExp }> = [
  { kind: 'system_tag', re: /<\/?system[^>]*>/gi },
  { kind: 'instruction_tag', re: /<\/?instruction[^>]*>/gi },
  { kind: 'jailbreak_marker', re: /\b(DAN mode|ignore (your )?(previous )?(instructions|rules)|disable safeties)\b/gi },
  { kind: 'shell_pipeline', re: /\$\(.*?\)|`[^`]+`|\beval\s*\(/g },
  { kind: 'base64_blob', re: /[A-Za-z0-9+/]{200,}={0,2}/g },
  { kind: 'cli_role_swap', re: /\bI am now (the )?(?:system|root|admin|operator)\b/gi },
]

/** Sanitize a single CLI output line. */
export function sanitize(line: string): SanitizeResult {
  const redactions: SanitizeResult['redactions'] = []
  let clean = line
  for (const { kind, re } of PATTERNS) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(line)) !== null) {
      redactions.push({ kind, matched: m[0], at: m.index })
      clean = clean.replace(m[0], `[redacted:${kind}]`)
      if (!re.global) break
    }
  }
  return { clean, redactions, rejected: redactions.length > 0 }
}
