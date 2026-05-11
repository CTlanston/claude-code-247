"""AutoDev v3 outer loop — supervisor / state / recovery / cost / reports.

Wraps the existing Auto-Evo inner engine in `orchestrator/` so that:
  * Sessions can die and the supervisor restarts cleanly from disk state
  * Tasks are file-managed (`tasks/backlog.md`, `current.md`, `done.md`)
  * Commands are file-managed (`commands/inbox.md`)
  * Cost mode is enforced (`cheap` / `balanced` / `premium`)
  * Hold items are recorded instead of crashing the loop

Entry point: `python3 -m autodev.supervisor --once` or `--supervisor`.
"""

__version__ = "3.0.0"
