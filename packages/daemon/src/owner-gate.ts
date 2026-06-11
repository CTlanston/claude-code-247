/**
 * cloudhull-c5 — trusted-local multi-user identity helpers.
 *
 * One shared Mac, trusted-local users only (Tailscale LAN), NO SaaS auth.
 * `x-aedev-user` is a PLAIN display-name header set by the dashboard so the
 * system can attribute submissions/answers and route owner-only actions.
 * It is explicitly NOT authentication — any local user can set any name.
 * The safety model stays unchanged: remote writes are gated elsewhere
 * (allow_remote_writes), merges are human-only, and the owner gate only
 * decides WHO presses approve/start/create-pr on the shared cockpit.
 *
 * Backward compat: an absent header means the request comes from the owner
 * (all pre-c5 cockpit calls and tests send no header).
 */
import type { FastifyRequest } from 'fastify'

export const AEDEV_USER_HEADER = 'x-aedev-user'

/** Calm bilingual refusal — rendered by mapErrorToHuman, never as a raw 403. */
export const OWNER_GATE_GUIDANCE =
  '这一步需要 Owner 执行，请让 Owner 在控制台确认 · This step belongs to the owner — ask the owner to confirm it in the cockpit. 你的提交和回答都已保留 · Your submissions and answers are kept.'

/** The configured owner display name (env AEDEV_OWNER_NAME, default 'owner'). */
export function configuredOwnerName(): string {
  return (process.env['AEDEV_OWNER_NAME'] ?? 'owner').trim() || 'owner'
}

/** The acting display name from the trusted-local header, or undefined. */
export function actingUserName(req: Pick<FastifyRequest, 'headers'>): string | undefined {
  const raw = req.headers[AEDEV_USER_HEADER]
  const value = Array.isArray(raw) ? raw[0] : raw
  const name = typeof value === 'string' ? value.trim() : ''
  return name || undefined
}

/** Absent header = owner (backward compat); otherwise the names must match. */
export function isOwnerRequest(req: Pick<FastifyRequest, 'headers'>): boolean {
  const actor = actingUserName(req)
  return !actor || actor === configuredOwnerName()
}
