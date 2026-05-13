# Session log

Append-only timestamped record of every supervisor cycle, phase transition,
test/CI/Guardian run, and blocker event. Latest entries at bottom.

---

## 2026-05-11 — Bootstrap session: AutoDev v3 outer-loop implementation

### Phase 0 — Preflight

- Working dir: `/Users/lanston/Desktop/Claude Code/claude-code-247`
- Existing Auto-Evo inner engine present at `orchestrator/`, `runner/`
- Tools present: python3 3.9, docker 29.4.2, gh 2.91.0, git
- Tools missing: `tmux`, `claude` (CLI on host PATH — Docker container has it)
- `HUMAN_CONFIG.md` missing → wrote `HUMAN_CONFIG.template.md`, opened HOLD-1
- `CLAUDE.md` missing → created with repo policy summary
- Created directory tree: `reports/ tasks/ commands/ .claude/{agents,hooks} autodev/executors`
- Initialised `reports/state.json` at version=1, mode=cheap, paused=false, live_allowed=false
- Cost mode default: **cheap** (no API spend allowed)
- Git state at start of session: clean (two commits from prior session — hotfix + baseline)

Outcome: ready for Phase 1.

- 2026-05-11T06:58:35Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-11T06:58:35Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-11T06:58:35Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-11T06:58:35Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-11T06:58:41Z  cycle.ok  task=-  mode=premium  summary=report-only cycle
  notes: action=report_only reason=explicit /report request
- 2026-05-11T07:00:10Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-11T07:00:10Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-11T07:00:10Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-11T07:00:10Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-11T07:00:11Z  cycle.ok  task=TASK-001  mode=cheap  summary=[dry-run] inner engine ok (0.0s)
  notes: action=select_new_task reason=no current task and not paused; selecting from backlog
- 2026-05-11T08:47:35Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-11T08:47:35Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-11T08:47:35Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-11T08:47:35Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-11T08:48:01Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-11T08:48:01Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-11T08:48:01Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-11T08:48:01Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-11T08:48:52Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-11T08:48:52Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-11T08:48:52Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-11T08:48:52Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-11T08:52:33Z  cycle.warn  task=TASK-001  mode=cheap  summary=inner engine blocked: inner engine exit 1
  notes: action=continue_current_task reason=task TASK-001 is active
- 2026-05-11T08:53:28Z  cycle.warn  task=TASK-002  mode=cheap  summary=inner engine blocked: inner engine exit 2
  notes: action=select_new_task reason=no current task and not paused; selecting from backlog
- 2026-05-11T08:53:50Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-11T08:53:50Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-11T08:53:50Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-11T08:53:50Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-11T09:16:39Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-11T09:16:39Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-11T09:16:39Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-11T09:16:39Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-11T09:18:03Z  cycle.warn  task=TASK-003  mode=cheap  summary=inner engine blocked: inner engine exit 4
  notes: action=select_new_task reason=no current task and not paused; selecting from backlog
- 2026-05-11T09:19:05Z  cycle.warn  task=TASK-004  mode=cheap  summary=inner engine blocked: inner engine exit 4
  notes: action=select_new_task reason=no current task and not paused; selecting from backlog
- 2026-05-11T09:31:13Z  cycle.warn  task=TASK-005  mode=cheap  summary=inner engine blocked: inner engine exit -15
  notes: action=select_new_task reason=no current task and not paused; selecting from backlog
- 2026-05-11T09:40:44Z  cycle.warn  task=TASK-006  mode=cheap  summary=inner engine blocked: inner engine exit 4
  notes: action=select_new_task reason=no current task and not paused; selecting from backlog
- 2026-05-11T09:41:49Z  cycle.warn  task=TASK-007  mode=cheap  summary=inner engine blocked: inner engine exit 4
  notes: action=select_new_task reason=no current task and not paused; selecting from backlog
- 2026-05-11T09:42:51Z  cycle.ok  task=TASK-007  mode=cheap  summary=no work in backlog
  notes: action=select_new_task reason=no current task and not paused; selecting from backlog
- 2026-05-11T09:43:52Z  cycle.ok  task=TASK-007  mode=cheap  summary=no work in backlog
  notes: action=select_new_task reason=no current task and not paused; selecting from backlog
- 2026-05-11T09:44:54Z  cycle.ok  task=TASK-007  mode=cheap  summary=no work in backlog
  notes: action=select_new_task reason=no current task and not paused; selecting from backlog
- 2026-05-11T09:45:56Z  cycle.ok  task=TASK-007  mode=cheap  summary=no work in backlog
  notes: action=select_new_task reason=no current task and not paused; selecting from backlog
- 2026-05-11T09:46:57Z  cycle.ok  task=TASK-007  mode=cheap  summary=no work in backlog
  notes: action=select_new_task reason=no current task and not paused; selecting from backlog
- 2026-05-11T09:47:58Z  cycle.ok  task=TASK-007  mode=cheap  summary=no work in backlog
  notes: action=select_new_task reason=no current task and not paused; selecting from backlog
- 2026-05-11T09:49:00Z  cycle.ok  task=TASK-007  mode=cheap  summary=no work in backlog
  notes: action=select_new_task reason=no current task and not paused; selecting from backlog
- 2026-05-11T09:50:01Z  cycle.ok  task=TASK-007  mode=cheap  summary=no work in backlog
  notes: action=select_new_task reason=no current task and not paused; selecting from backlog
- 2026-05-11T09:51:03Z  cycle.ok  task=TASK-007  mode=cheap  summary=no work in backlog
  notes: action=select_new_task reason=no current task and not paused; selecting from backlog
- 2026-05-11T09:52:05Z  cycle.ok  task=TASK-007  mode=cheap  summary=no work in backlog
  notes: action=select_new_task reason=no current task and not paused; selecting from backlog
- 2026-05-11T09:53:06Z  cycle.ok  task=TASK-007  mode=cheap  summary=no work in backlog
  notes: action=select_new_task reason=no current task and not paused; selecting from backlog
- 2026-05-11T09:54:08Z  cycle.ok  task=TASK-007  mode=cheap  summary=no work in backlog
  notes: action=select_new_task reason=no current task and not paused; selecting from backlog
- 2026-05-11T09:55:09Z  cycle.ok  task=TASK-007  mode=cheap  summary=no work in backlog
  notes: action=select_new_task reason=no current task and not paused; selecting from backlog
- 2026-05-11T09:56:11Z  cycle.ok  task=TASK-007  mode=cheap  summary=no work in backlog
  notes: action=select_new_task reason=no current task and not paused; selecting from backlog
- 2026-05-11T09:57:12Z  cycle.ok  task=TASK-007  mode=cheap  summary=no work in backlog
  notes: action=select_new_task reason=no current task and not paused; selecting from backlog
- 2026-05-11T09:58:13Z  cycle.ok  task=TASK-007  mode=cheap  summary=no work in backlog
  notes: action=select_new_task reason=no current task and not paused; selecting from backlog
- 2026-05-11T09:59:15Z  cycle.ok  task=TASK-007  mode=cheap  summary=no work in backlog
  notes: action=select_new_task reason=no current task and not paused; selecting from backlog
- 2026-05-11T10:00:22Z  cycle.warn  task=TASK-E2E-001  mode=cheap  summary=inner engine blocked: inner engine exit 4
  notes: action=select_new_task reason=no current task and not paused; selecting from backlog
- 2026-05-11T10:01:28Z  cycle.warn  task=TASK-E2E-002  mode=cheap  summary=inner engine blocked: inner engine exit 4
  notes: action=select_new_task reason=no current task and not paused; selecting from backlog
- 2026-05-11T10:02:35Z  cycle.warn  task=TASK-E2E-003  mode=cheap  summary=inner engine blocked: inner engine exit 4
  notes: action=select_new_task reason=no current task and not paused; selecting from backlog
- 2026-05-11T10:03:41Z  cycle.warn  task=TASK-E2E-004  mode=cheap  summary=inner engine blocked: inner engine exit 4
  notes: action=select_new_task reason=no current task and not paused; selecting from backlog
- 2026-05-11T10:04:47Z  cycle.warn  task=TASK-E2E-005  mode=cheap  summary=inner engine blocked: inner engine exit 4
  notes: action=select_new_task reason=no current task and not paused; selecting from backlog
- 2026-05-11T10:05:53Z  cycle.warn  task=TASK-E2E-006  mode=cheap  summary=inner engine blocked: inner engine exit 4
  notes: action=select_new_task reason=no current task and not paused; selecting from backlog
- 2026-05-11T10:06:59Z  cycle.warn  task=TASK-E2E-007  mode=cheap  summary=inner engine blocked: inner engine exit 4
  notes: action=select_new_task reason=no current task and not paused; selecting from backlog
- 2026-05-11T10:08:07Z  cycle.warn  task=TASK-E2E-008  mode=cheap  summary=inner engine blocked: inner engine exit 4
  notes: action=select_new_task reason=no current task and not paused; selecting from backlog
- 2026-05-11T10:10:45Z  cycle.ok  task=TASK-E2E-008  mode=cheap  summary=no work in backlog
  notes: action=select_new_task reason=no current task and not paused; selecting from backlog
- 2026-05-11T10:11:46Z  cycle.ok  task=TASK-E2E-008  mode=cheap  summary=no work in backlog
  notes: action=select_new_task reason=no current task and not paused; selecting from backlog
- 2026-05-11T10:12:47Z  cycle.ok  task=TASK-E2E-008  mode=cheap  summary=no work in backlog
  notes: action=select_new_task reason=no current task and not paused; selecting from backlog
- 2026-05-11T10:13:49Z  cycle.ok  task=TASK-E2E-008  mode=cheap  summary=no work in backlog
  notes: action=select_new_task reason=no current task and not paused; selecting from backlog
- 2026-05-11T10:14:50Z  cycle.ok  task=TASK-E2E-008  mode=cheap  summary=no work in backlog
  notes: action=select_new_task reason=no current task and not paused; selecting from backlog
- 2026-05-11T10:15:51Z  cycle.ok  task=TASK-E2E-008  mode=cheap  summary=no work in backlog
  notes: action=select_new_task reason=no current task and not paused; selecting from backlog
- 2026-05-11T10:16:53Z  cycle.ok  task=TASK-E2E-008  mode=cheap  summary=no work in backlog
  notes: action=select_new_task reason=no current task and not paused; selecting from backlog
- 2026-05-11T10:17:54Z  cycle.ok  task=TASK-E2E-008  mode=cheap  summary=no work in backlog
  notes: action=select_new_task reason=no current task and not paused; selecting from backlog
- 2026-05-11T10:18:56Z  cycle.ok  task=TASK-E2E-008  mode=cheap  summary=no work in backlog
  notes: action=select_new_task reason=no current task and not paused; selecting from backlog
- 2026-05-11T10:19:57Z  cycle.ok  task=TASK-E2E-008  mode=cheap  summary=no work in backlog
  notes: action=select_new_task reason=no current task and not paused; selecting from backlog
- 2026-05-11T10:20:58Z  cycle.ok  task=TASK-E2E-008  mode=cheap  summary=no work in backlog
  notes: action=select_new_task reason=no current task and not paused; selecting from backlog
- 2026-05-11T10:22:00Z  cycle.ok  task=TASK-E2E-008  mode=cheap  summary=no work in backlog
  notes: action=select_new_task reason=no current task and not paused; selecting from backlog
- 2026-05-11T10:46:08Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-11T10:46:08Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-11T10:46:08Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-11T10:46:08Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-11T10:48:27Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-11T10:48:27Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-11T10:48:27Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-11T10:48:27Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-11T10:49:15Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-11T10:49:15Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-11T10:49:15Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-11T10:49:15Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-11T11:12:10Z  cycle.warn  task=TASK-V3-1778496611  mode=cheap  summary=inner engine blocked: inner engine exit 3
  notes: action=select_new_task reason=no current task and not paused; selecting from backlog
- 2026-05-11T14:48:12Z  cycle.ok  task=TASK-V3-1778496611  mode=cheap  summary=no work in backlog
  notes: action=select_new_task reason=no current task and not paused; selecting from backlog
- 2026-05-11T14:49:14Z  cycle.ok  task=TASK-V3-1778496611  mode=cheap  summary=no work in backlog
  notes: action=select_new_task reason=no current task and not paused; selecting from backlog
- 2026-05-11T14:50:15Z  cycle.ok  task=TASK-V3-1778496611  mode=cheap  summary=no work in backlog
  notes: action=select_new_task reason=no current task and not paused; selecting from backlog
- 2026-05-11T22:56:25Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-11T22:56:25Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-11T22:56:25Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-11T22:56:25Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-11T23:07:52Z  cycle.warn  task=TASK-V3-1778496611  mode=cheap  summary=inner engine blocked: inner engine exit 3
  notes: action=continue_current_task reason=task TASK-V3-1778496611 is active
- 2026-05-11T23:09:08Z  cycle.warn  task=TASK-V3-1778496611  mode=cheap  summary=inner engine blocked: inner engine exit 3
  notes: action=continue_current_task reason=task TASK-V3-1778496611 is active
- 2026-05-11T23:24:33Z  cycle.warn  task=TASK-V3-1778496611  mode=cheap  summary=inner engine blocked: inner engine exit 3
  notes: action=continue_current_task reason=task TASK-V3-1778496611 is active
- 2026-05-12T03:01:05Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-12T03:01:05Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-12T03:01:05Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-12T03:01:05Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-12T03:01:51Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-12T03:01:51Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-12T03:01:51Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-12T03:01:51Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-12T03:02:36Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-12T03:02:36Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-12T03:02:36Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-12T03:02:36Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-12T03:03:05Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-12T03:03:05Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-12T03:03:05Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-12T03:03:05Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-12T04:36:10Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-12T04:36:10Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-12T04:36:10Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-12T04:36:10Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-12T04:36:20Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-12T04:36:20Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-12T04:36:20Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-12T04:36:20Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-12T04:40:36Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-12T04:40:36Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-12T04:40:36Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-12T04:40:36Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-12T04:42:16Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-12T04:42:16Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-12T04:42:16Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-12T04:42:16Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-12T04:46:50Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-12T04:46:50Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-12T04:46:50Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-12T04:46:50Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-12T04:47:05Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-12T04:47:05Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-12T04:47:05Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-12T04:47:05Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-12T04:51:10Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-12T04:51:10Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-12T04:51:10Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-12T04:51:10Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-12T04:51:55Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-12T04:51:55Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-12T04:51:55Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-12T04:51:55Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-12T04:54:52Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-12T04:54:52Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-12T04:54:52Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-12T04:54:52Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-12T04:55:19Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-12T04:55:19Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-12T04:55:19Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-12T04:55:19Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-12T04:57:41Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-12T04:57:41Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-12T04:57:41Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-12T04:57:41Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-12T04:57:47Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-12T04:57:47Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-12T04:57:47Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-12T04:57:47Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-12T05:00:00Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-12T05:00:00Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-12T05:00:00Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-12T05:00:00Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-12T05:00:12Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-12T05:00:12Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-12T05:00:12Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-12T05:00:12Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-12T05:04:07Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-12T05:04:07Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-12T05:04:07Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-12T05:04:07Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-12T05:04:42Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-12T05:04:42Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-12T05:04:42Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-12T05:04:42Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-12T05:07:27Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-12T05:07:27Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-12T05:07:27Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-12T05:07:27Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-12T05:07:35Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-12T05:07:35Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-12T05:07:35Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-12T05:07:35Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-12T05:10:07Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-12T05:10:07Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-12T05:10:07Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-12T05:10:07Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-12T05:10:15Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-12T05:10:15Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-12T05:10:15Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-12T05:10:15Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-12T05:12:41Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-12T05:12:41Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-12T05:12:41Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-12T05:12:41Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-12T05:12:49Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-12T05:12:49Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-12T05:12:49Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-12T05:12:49Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-12T05:15:17Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-12T05:15:17Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-12T05:15:17Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-12T05:15:17Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-12T05:15:50Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-12T05:15:50Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-12T05:15:50Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-12T05:15:50Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-12T05:15:57Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-12T05:15:57Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-12T05:15:57Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-12T05:15:57Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-12T05:18:06Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-12T05:18:06Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-12T05:18:06Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-12T05:18:06Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-12T05:18:58Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-12T05:18:58Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-12T05:18:58Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-12T05:18:58Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-12T05:23:29Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-12T05:23:29Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-12T05:23:29Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-12T05:23:29Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-12T05:23:37Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-12T05:23:37Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-12T05:23:37Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-12T05:23:37Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-12T05:27:17Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-12T05:27:17Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-12T05:27:17Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-12T05:27:17Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-12T07:37:05Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-12T07:37:05Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-12T07:37:05Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-12T07:37:05Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-12T07:37:28Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-12T07:37:28Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-12T07:37:28Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-12T07:37:28Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-12T07:42:02Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-12T07:42:02Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-12T07:42:02Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-12T07:42:02Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-12T07:42:17Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-12T07:42:17Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-12T07:42:17Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-12T07:42:17Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-12T07:45:22Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-12T07:45:22Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-12T07:45:22Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-12T07:45:22Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-12T07:46:12Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-12T07:46:12Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-12T07:46:12Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-12T07:46:12Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-12T08:10:07Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-12T08:10:07Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-12T08:10:07Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-12T08:10:07Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-12T08:10:32Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-12T08:10:32Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-12T08:10:32Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-12T08:10:32Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-12T08:15:12Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-12T08:15:12Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-12T08:15:12Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-12T08:15:12Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-12T08:15:29Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-12T08:15:29Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-12T08:15:29Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-12T08:15:29Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-12T08:19:41Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-12T08:19:41Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-12T08:19:41Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-12T08:19:41Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-12T08:20:00Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-12T08:20:00Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-12T08:20:00Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-12T08:20:00Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-12T08:22:45Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-12T08:22:45Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-12T08:22:45Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-12T08:22:45Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-12T08:23:06Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-12T08:23:06Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-12T08:23:06Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-12T08:23:06Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-13T04:55:07Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-13T04:55:07Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-13T04:55:07Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-13T04:55:07Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-13T04:55:24Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-13T04:55:24Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-13T04:55:24Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-13T04:55:24Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-13T04:59:13Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-13T04:59:13Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-13T04:59:13Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-13T04:59:13Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-13T04:59:29Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-13T04:59:29Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-13T04:59:29Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-13T04:59:29Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-13T05:04:10Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-13T05:04:10Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-13T05:04:10Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-13T05:04:10Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out
- 2026-05-13T05:04:47Z  cli.execution  classify=rate_limited  exit=0  duration=0.0s  cost~$0.0000  summary=Rate limit exceeded
- 2026-05-13T05:04:47Z  cli.execution  classify=permission_needed  exit=0  duration=0.0s  cost~$0.0000  summary=permission denied
- 2026-05-13T05:04:47Z  cli.execution  classify=success  exit=0  duration=0.0s  cost~$0.0000  summary=all good
- 2026-05-13T05:04:47Z  cli.timeout  classify=timeout  exit=None  duration=0.0s  cost~$0.0000  summary=CLI timed out