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
  // Destructive filesystem
  { name: 'rm_rf_root', re: /\brm\s+-rf\s+\/(?!tmp|var\/folders)/ },

  // Destructive git
  { name: 'git_push_force_main', re: /git push.*--force.*\b(main|master)\b/ },
  { name: 'git_reset_hard', re: /\bgit\s+reset\s+--hard\b/ },
  { name: 'git_force_then_push', re: /git push.*--force/ },

  // Destructive DB
  { name: 'drop_table', re: /\bDROP\s+TABLE\b/i },
  { name: 'truncate_table', re: /\bTRUNCATE\s+TABLE\b/i },
  { name: 'mass_delete_db', re: /\bDELETE\s+FROM\s+\w+\s+WHERE\s+1\s*=\s*1\b/i },

  // Network egress to dangerous endpoints
  { name: 'curl_metadata_server', re: /\b169\.254\.169\.254|metadata\.google\.internal/ },
  { name: 'reverse_shell', re: /\bnc\b.*-e\b|bash\s+-i\s*>&\s*\/dev\/tcp/ },

  // Secret exfil
  { name: 'env_or_secrets_read', re: /\b(cat|less|more|head|tail|bat|jq)\s+\.env[\w.]*|\b(cat|less|more|head|tail|bat)\s+[\w~./-]*\.ssh\/id_(rsa|ed25519|ecdsa)|\b(cat|less|more|head|tail|bat)\s+secrets\/|\b(cat|less|more|head|tail|bat)\s+[\w~./-]*\.aws\/credentials|\b(cat|less|more|head|tail|bat)\s+[\w~./-]*\.npmrc/ },
  { name: 'secret_path_copy', re: /\b(cp|mv|scp|rsync)\s+[\w~./-]*(\.env[\w.]*|\.ssh\/id_(rsa|ed25519|ecdsa)|secrets\/|\.aws\/credentials)/ },
  { name: 'env_redirect_out', re: /(>>\s*\.env[\w.]*|>\s*\.env[\w.]*)/ },
  { name: 'base64_secret_exfil', re: /\$\(base64\s+(-i\s+)?\.env|base64\s+(-i\s+)?\.env[\w.]*\s*(>>|>|\|)/ },

  // eval with secrets
  { name: 'eval_with_env', re: /eval\s*\(.*\.env|\$\(\s*cat\s+\.env|\beval\s+\$\(\s*cat\s+\.env/ },

  // Forbidden-path edits (CLAUDE.md / AGENTS.md / .github/* / approval surfaces)
  { name: 'forbidden_path_edit', re: /\b(sed\s+-i|tee|echo)[^|;&\n]*(CLAUDE\.md|AGENTS\.md|\.github\/workflows\/[\w.-]+)|>\s*(CLAUDE\.md|AGENTS\.md|\.github\/)|>>\s*(CLAUDE\.md|AGENTS\.md|\.github\/)/ },
  { name: 'aws_key_inject', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'approval_bypass_edit', re: /\bsed\s+-i[^|;&\n]*\b(approval|always_approve|skip_approval|disable_approval)\b|\bsed\s+-i[^|;&\n]*\breturn\s+verify\b|\bsed\s+-i[^|;&\n]*\bgateway\.ts\b|\bsed\s+-i[^|;&\n]*packages\/approval/ },
  { name: 'auth_yaml_flip', re: /\b(always_approve|skip_approval|disable_approval)\s*:\s*true/ },
  { name: 'bash_history_exfil', re: /\b(curl|wget|nc|http)[^|;&\n]*[~/]\.(bash|zsh|fish)_history|\.(bash|zsh|fish)_history\s*\|.*?(curl|wget|nc)/ },
  { name: 'claude_md_modify_any', re: /\b(sed|awk|perl|ruby|python|node)\s+[^|;&\n]*CLAUDE\.md\b/ },
  { name: 'github_workflow_write', re: /\b(echo|cat|printf|tee)\s+[^|;&\n]*>>\s*\.github\/workflows\// },

  // Supply-chain
  { name: 'malware_package', re: /\bnpm\s+i(nstall)?\s+(--global\s+|-g\s+)?(crypto-mining|coin-miner|coinhive|node-ipc@.*malicious)/ },
  { name: 'known_cve_lodash', re: /\blodash@(\^?)?4\.17\.(1[5-9]|20)\b/ },

  // Sentinel evasion / privileged container
  { name: 'base64_pipe_sh', re: /base64\s+(-d|-D|--decode).*\|\s*(sh|bash)|echo\s+[A-Za-z0-9+/=]+\s*\|\s*base64\s+(-d|-D|--decode)\s*\|\s*(sh|bash)/ },
  { name: 'docker_privileged', re: /docker\s+(run|create).*--privileged/ },
  { name: 'docker_sock_mount', re: /\/var\/run\/docker\.sock/ },

  // Skip hooks / no-verify (workbook forbids)
  { name: 'git_no_verify', re: /git\s+(commit|push)\s+[^|;&\n]*--no-verify/ },

  // Secret exfil via PR / gist
  { name: 'gh_gist_secret', re: /\bgh\s+gist\s+create\s+[^|;&\n]*(secrets\/|\.env|\.ssh\/id_)/ },

  // ssh-key copy / mv (caught by secret_path_copy already, but also bare)
  { name: 'ssh_key_steal', re: /\b(cp|mv|scp|rsync)\s+[\w~./-]*\.ssh\/id_(rsa|ed25519|ecdsa)/ },

  // Admin/root credential reads via cat anywhere
  { name: 'admin_password_read', re: /\b(cat|less)\s+[\w./-]*(admin-?password|admin-?creds|root-?password)[\w./-]*\b/i },
]

/** Soft-block: warn + require operator confirm via ApprovalGateway. */
const SOFT: Array<{ name: string; re: RegExp }> = [
  { name: 'sudo', re: /\bsudo\b/ },
  { name: 'npm_install_global', re: /npm\s+i(nstall)?\s+-g\b/ },
  { name: 'curl_pipe_sh', re: /curl[^|]+\|\s*(sh|bash)/ },
  { name: 'large_delete', re: /\brm\s+-rf\s+[^/].*\*/ },
  // Targeted rm of well-known repo dirs (node_modules etc) — likely safe but worth a soft check
  { name: 'rm_node_modules', re: /\brm\s+-rf\s+node_modules\b/ },
  // sqlite3 mutating commands generally
  { name: 'sqlite3_mutation', re: /\bsqlite3\s+[^"]*"[^"]*(DROP|DELETE|TRUNCATE|UPDATE)\b/i },
  // sed -i in src/ tree — could be legit or could be auth bypass
  { name: 'sed_inplace_src', re: /\bsed\s+-i\s+["']?[^"']*["']?\s+[\w./-]*packages\// },
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
