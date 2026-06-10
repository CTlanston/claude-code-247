/** Shared ntfy push transport (P1 HOLD-BUDGET, P3 watchdog).
 *
 * Sends a push through ntfy when `AEDEV_NTFY_TOPIC` is configured
 * (`AEDEV_NTFY_URL` overrides the default https://ntfy.sh server).
 * Network failure is swallowed — a notification must never block the
 * state change it announces; callers emit their own event-sourced
 * `*_notified` / `notify_requested` events regardless.
 */
export async function sendNtfy(title: string, body: string, priority: 'default' | 'high' = 'default'): Promise<boolean> {
  const topic = process.env['AEDEV_NTFY_TOPIC']
  if (!topic) return false
  const base = process.env['AEDEV_NTFY_URL'] ?? 'https://ntfy.sh'
  try {
    await fetch(`${base.replace(/\/$/, '')}/${topic}`, {
      method: 'POST',
      headers: { Title: title, Priority: priority },
      body,
    })
    return true
  } catch {
    return false
  }
}
