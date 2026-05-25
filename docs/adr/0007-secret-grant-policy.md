# ADR-0007: Secret Grant Policy

**Status:** Accepted  
**Date:** 2026-05-25

---

## Context

Some tasks legitimately require credentials to complete. Examples:

- Running integration tests that call a real external API
- Pushing a build artifact to a package registry
- Running a database migration against a staging environment
- Authenticating to a private Docker registry to pull a base image

At the same time, aedev workers are autonomous agents running arbitrary code.
Giving all workers ambient access to all available secrets would mean that a
single compromised or misbehaving task could exfiltrate credentials from
unrelated services.

We need a model for secret access that is:
- Auditable: every secret access is recorded with why it was granted
- Minimal: workers get only the specific secret(s) they need for their task
- Time-limited: access expires so a leaked secret has a short window of usefulness
- Revocable: access can be ended before expiry if something goes wrong

We evaluated three models: ambient injection, secret-less, and explicit grants.

---

## Decision

Use an explicit secret grant model. To give a worker access to a credential,
an operator must create a `secret_grant` record before the worker starts.
The record specifies the exact secret name, the specific task it applies to,
a TTL (time-to-live in seconds), and a reason.

### Grant Lifecycle

1. **Creation:** Operator runs `aedev secret grant <task_id> <secret_name> --ttl <seconds> --reason "<text>"`. This creates a `secret_grants` row in SQLite and an `events` row for auditability.

2. **Validation at launch:** When the runner prepares a Docker container for a task, it queries `secret_grants` for that task. If a grant exists and is within its TTL and not revoked, the runner reads the secret value from macOS Keychain using the `security` CLI and injects it as an environment variable into the container. The secret value is never logged; only the secret name and grant ID are.

3. **Expiry check:** The daemon checks grant TTLs every 60 seconds. If a grant expires while a task is still running, the daemon marks the grant as `expired` in SQLite. The worker's container is not killed mid-run (stopping a running container is disruptive and could leave the repo in a partially-modified state), but any subsequent container launch for a retry of the same task will not receive the expired grant.

4. **Revocation at completion:** When a task moves to `done`, `failed`, or `cancelled`, the daemon immediately revokes all remaining grants for that task by setting `revoked_at`. This ensures that a task that finishes before its TTL does not leave an active grant that could be reused in a replay.

5. **Replay behavior:** When an operator replays a task with `aedev task replay <task_id>`, a new grant must be created for the replay run. The original grant is not reused, because it may be revoked or expired.

### Secret Name Convention

Secret names are strings that identify a named credential in macOS Keychain.
The convention is: `<service>/<key>` (e.g., `stripe/test_key`,
`npm/publish_token`, `anthropic/api_key`). This matches the Keychain service
and account naming convention.

### CLI Command

```
aedev secret grant <task_id> <secret_name> --ttl <seconds> --reason "<text>"
aedev secret revoke <grant_id>
aedev secret list [--task <task_id>]
```

### secret_grants Schema

```sql
CREATE TABLE secret_grants (
  id          TEXT PRIMARY KEY,  -- ULID
  task_id     TEXT NOT NULL REFERENCES tasks(id),
  secret_name TEXT NOT NULL,
  ttl_seconds INTEGER NOT NULL,
  granted_by  TEXT NOT NULL,
  granted_at  TEXT NOT NULL,     -- ISO-8601 UTC
  expires_at  TEXT NOT NULL,     -- ISO-8601 UTC
  reason      TEXT NOT NULL,
  used_at     TEXT,              -- when first injected into a container
  revoked_at  TEXT,              -- when revoked (null if still active)
  expired_at  TEXT               -- when TTL expired (null if not yet)
);
```

---

## Alternatives Considered

### 1. Ambient Secrets (All Workers Get All Secrets)

**Pros:**
- Zero operator friction; workers can do anything that needs credentials
  without any setup
- Simpler implementation: inject all secrets from a config file at container
  launch time

**Cons:**
- A single task that behaves unexpectedly (due to prompt injection, a bug in
  the worker code, or a misconfigured task spec) can exfiltrate any credential
  the system has access to
- There is no audit trail of which task used which credential and when
- Workers that do not need any credentials (the majority) unnecessarily receive
  all credentials, widening the blast radius of any single worker failure
- If a secret is rotated, there is no way to know which tasks were using the
  old value

This approach violates the principle of least privilege at a fundamental level.

### 2. Secret-Less (No Worker Ever Gets Credentials)

**Pros:**
- Simplest possible security model: no secrets, no risk
- No grant management overhead

**Cons:**
- Prevents any integration testing that requires real credentials
- Prevents any task that involves deploying, publishing, or authenticating to
  external services
- In practice, this would mean a significant class of real-world engineering
  tasks cannot be automated by aedev, limiting its utility

### 3. HashiCorp Vault

**Pros:**
- Industry-standard secret management with robust TTL, lease, and revocation
  support
- Fine-grained policies (which service account can access which secret path)
- Audit logging built into the product
- Dynamic secrets (e.g., generates short-lived database credentials on demand)

**Cons:**
- Requires running a separate Vault server, adding significant operational
  overhead for a single-user local tool
- Vault's architecture is designed for multi-tenant, multi-team environments;
  its complexity is not warranted for a single-user local development tool
- Vault tokens (used to authenticate workers to Vault) are themselves secrets
  that need to be managed — this shifts the problem rather than solving it
- Integration requires: a running Vault server, TLS certificates, a secrets
  engine configured, policies written, and a token-issuing mechanism. This
  is weeks of work for marginal security benefit over the explicit grant model
  in a local single-user deployment.

---

## Consequences

### Positive

- **Principle of least privilege:** Each worker gets exactly the secrets it
  needs for its task, for exactly the duration it needs them. Nothing more.
- **Full audit trail:** Every grant creation, use, expiry, and revocation is
  recorded in the `events` table and `daemon.jsonl`. After an incident, it is
  possible to reconstruct exactly which tasks had access to which credentials
  and when.
- **Short blast radius:** A compromised worker can only use the secrets it was
  explicitly granted. If a worker is somehow tricked into exfiltrating a
  secret, the exfiltrated value is a specific, named credential (not "all
  credentials"), and the incident is recorded (grant used at time T).
- **Revocable:** If an operator suspects a task is misbehaving, they can
  revoke its grants immediately with `aedev secret revoke <grant_id>`. The
  next TTL check will not inject the secret into any new container.
- **Rotation-friendly:** When a secret is rotated in Keychain, the new value
  is automatically used for all future grants (since the daemon reads from
  Keychain at container launch time, not at grant-creation time).

### Negative

- **Operator friction:** Before running a task that needs credentials, the
  operator must remember to create a grant. If they forget, the task will fail
  with a `missing_credential` error. This is a UX tradeoff for security.
  Mitigation: tasks that need credentials declare this in their task plan;
  the daemon can detect credential-requiring tasks and prompt the operator to
  create a grant before dispatch.
- **TTL estimation:** The operator must estimate how long the task will need
  the secret when creating the grant. Setting a TTL that is too short causes
  the task to fail mid-run (the container continues running, but a retry will
  not receive the expired grant). Setting a TTL that is too long leaves the
  grant active longer than necessary. The `aedev secret grant` command
  suggests a default TTL of 3600 seconds (1 hour) which is reasonable for
  most tasks; the operator can override this.
- **macOS Keychain dependency:** The secrets store is macOS Keychain, which
  is specific to macOS. This is consistent with the local-first Mac daemon
  design (ADR-0001) but means the system cannot be ported to Linux without
  changing the secrets backend.
