/** Stage M4 — sentinel policy. */

export type SentinelVerdict = 'allow' | 'soft_block' | 'hard_block'

export interface ToolCall {
  tool: string
  /** Stringified args; the sentinel inspects this for unsafe patterns. */
  args: string
  /** Optional context — env tags, repo, branch. */
  context?: Record<string, string>
}

export interface VerdictWithReason {
  verdict: SentinelVerdict
  reason: string
  matched?: string
}

/** Hard-block patterns: never let through. */
const HARD: Array<{ name: string; re: RegExp }> = [
  { name: 'rm_rf_root', re: /\brm\s+-rf\s+\/(?!tmp|var\/folders)/ },
  { name: 'git_push_force_main', re: /git push.*--force.*\b(main|master)\b/ },
  { name: 'drop_table', re: /\bDROP\s+TABLE\b/i },
  { name: 'curl_metadata_server', re: /\b169\.254\.169\.254|metadata\.google\.internal/ },
  { name: 'reverse_shell', re: /\bnc\b.*-e\b|bash\s+-i\s*>&\s*\/dev\/tcp/ },
  { name: 'env_or_secrets', re: /\bcat\s+\.env[\w.]*|cat\s+[\w~./-]*\.ssh\/id_(rsa|ed25519|ecdsa)|cat\s+secrets\// },
  { name: 'eval_with_env', re: /eval\s*\(.*\.env|\$\(\s*cat\s+\.env/ },
]

/** Soft-block: warn + require operator confirm via ApprovalGateway. */
const SOFT: Array<{ name: string; re: RegExp }> = [
  { name: 'sudo', re: /\bsudo\b/ },
  { name: 'npm_install_global', re: /npm\s+i(nstall)?\s+-g\b/ },
  { name: 'curl_pipe_sh', re: /curl[^|]+\|\s*(sh|bash)/ },
  { name: 'large_delete', re: /\brm\s+-rf\s+[^/].*\*/ },
]

export function classify(call: ToolCall): VerdictWithReason {
  const target = `${call.tool} ${call.args}`
  for (const h of HARD) {
    if (h.re.test(target)) return { verdict: 'hard_block', reason: h.name, matched: target.match(h.re)?.[0] }
  }
  for (const s of SOFT) {
    if (s.re.test(target)) return { verdict: 'soft_block', reason: s.name, matched: target.match(s.re)?.[0] }
  }
  return { verdict: 'allow', reason: 'no_match' }
}
