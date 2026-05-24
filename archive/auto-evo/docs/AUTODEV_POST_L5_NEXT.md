# Post-L5 — what to optimize after AUTODEV_DONE.md appears

> Use this prompt ONLY after `reports/AUTODEV_DONE.md` exists AND you've
> uninstalled or paused launchd (`bash scripts/install_launchd_continuous.sh
> --uninstall` OR `touch reports/STOPSWITCH`). Running this in parallel with
> launchd will cause race conditions on SQLite + git tree.

## Mission
Overall L=5 is reached. M=S=R=T=E=7 max, C=5. The system is at MVP-complete.
The next phase is NOT another rubric chase — it's **production hardening +
real validation**.

Choose ONE track. Do not pick multiple in the same session.

---

## Track P5 — Real-world validation pilot (HIGHEST PRIORITY)

The whole point of the system was to handle real GitHub issues. Time to do that.

Goal: take 10 SMALL real-world issues (write them yourself or use existing
backlog from auto-travel or any project), let the system process them, measure
the outcome.

### Plan
1. File 10 issues on `CTlanston/auto-evo-playground` (small, well-spec'd,
   variety: 3 utility functions, 3 bug fixes, 2 test additions, 2 docs)
2. Re-enable launchd (`install_launchd_continuous.sh --install`)
3. Let it run for 24 hours, ingesting issues organically
4. Measure: completion rate, human-merge rate, blocker rate, cycle time
5. Write `reports/p5-real-world-pilot.md` with the verdict

### Success criteria
- Completion rate ≥ 70% (issues that reach `human_review` cleanly)
- Human-merge rate ≥ 50% (PRs you'd actually merge after review)
- Blocker rate ≤ 20% (issues that hit `reports/human-hold.md`)
- Median cycle time ≤ 60 min wall clock

If all 4 → system is production-grade for small tasks. Move to Track P6.
If any fail → diagnose, write a focused fix cycle, retry the pilot.

---

## Track P6 — auto-travel integration (after P5 PASS)

Hook the orchestrator into an actual project you want delivered.

### Plan
1. Create `~/Desktop/Claude Code/auto-travel/` (fresh repo, NOT this one)
2. Wire its `agent:auto`-labeled issues to be ingested by the orchestrator
3. Configure HUMAN_CONFIG for auto-travel as a second repo (or fork the
   orchestrator for it — preferred to avoid contention)
4. Start with PUBLIC scope only: utility functions, data adapters, test
   coverage. NEVER auth, payments, user data, deployment.
5. Track 30 days of stats; you stay the merge gate.

This is the moment of truth. Either the system delivers real ROI or it
doesn't.

---

## Track P7 — Production hardening (parallel to P5/P6)

Things that don't move the rubric but matter for sustained 24/7 operation.

### Sub-tracks
- **Log rotation**: `reports/runs/*.log` will accumulate; add weekly rotation
  via launchd cron-like
- **Old cycle dir cleanup**: `cycles/<id>/` will grow indefinitely; archive
  cycles older than 30 days to `cycles/archive/`
- **Codex cost monthly report**: `reports/codex-spend-monthly.md` written on
  the 1st of each month, summarizing per-day totals
- **Slack daily digest**: `scripts/send_daily_digest.sh` that runs once at
  09:00 local, summarizes last 24h cycles + sends to Slack via existing
  webhook
- **Health alert thresholds**: when health.json drops below 70, write
  `ALERT.md` BEFORE the existing < 50 hard-stop
- **OpenAI auth refresh detection**: when `codex_reviewer` gets HTTP 401,
  write ALERT.md asking operator to `codex login` again
- **launchd recovery from sleep**: macOS wake-from-sleep can leave launchd
  in a weird state; add a periodic self-check
- **C streak preservation across cycles**: ensure
  `reports/c-deadlock-streak.json` survives accidental rollbacks

Each sub-track = 1-2 cycles of TDD work. Pick the most painful one first.

---

## Track P8 — Tooling enhancements (the polish tier)

- **Real-time dashboard**: `scripts/autodev_tui.py` — curses-based or rich-
  based terminal UI that auto-refreshes every 10s with current state
- **Web dashboard**: small Flask app on localhost:5005 with the same data
- **Trend graphs**: plot Overall L, C streak, cycle time, cost over time
- **Failure pattern visualization**: auto-render `FAILURES.md` cluster
  similarity as a graph (matplotlib + networkx)

Lower priority. Do these only if you find yourself wanting them daily.

---

## Track L6/L7 — Continue the rubric chase

ONLY if you want Overall L > 5. Honest cost-benefit:

- **C → L6/L7**: requires ≥ 5 worktree streams + 30-cycle zero-deadlock at 5+
  streams. Probably 40-60 cycles of careful concurrency engineering. Most
  Mac hosts can't sustain 5 parallel Coder containers — RAM bottleneck.
- **R → already L7**
- **Other dims → already L7**

Practical answer: **L5 is good enough for production use**. L6+ is research,
not productization. Skip unless you have a specific need.

---

## Hard constraints (unchanged)

All §0 hard constraints from `AUTODEV_L7_MASTER_PROMPT.md` apply.
ADR-0008 codex budget guard applies to every codex call.
45-min wall-clock per cycle. Atomic commits. No push. No merge. No secrets.

## Termination

Each track has its own success criteria. When the chosen track's criteria
are met, write `reports/post-l5-<trackname>-done.md` with the verdict and
stop.

If a track's criteria can't be met within 5-7 cycles, write
`reports/post-l5-<trackname>-blocked.md` with the root cause and stop.

---

## Recommendation

Start with **Track P5** (real-world validation). The whole infrastructure
was built to do this. Until you've measured ROI on real issues, all the
rubric work is theory.

After P5 passes, P6 (auto-travel) is the natural next step.

P7 (hardening) is back-burner — only when you've used the system for 1+
month and feel specific pain.

Track L6/L7 is mostly vanity — skip unless you have a specific need.

---

## Begin

When the operator says go AND launchd is stopped AND `AUTODEV_DONE.md`
exists, read this entire file, pick ONE track, execute it per its plan.
Do not improvise. Do not pick two tracks. Do not skip the success criteria.

If the operator hasn't picked a track, ask: "Which post-L5 track: P5 (real-
world pilot), P6 (auto-travel), P7 (hardening), or P8 (tooling)?"
