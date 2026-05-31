# Cockpit Redesign Workbook — Direction A · "Codex Classic"

> Source design: [`source-redesign-explorations.html`](./source-redesign-explorations.html)
> (copied from `aedev cockpit redesign.html`). Locked direction: **A · Codex Classic**.
> Target: `apps/dashboard` (React 18 + Vite + hand-written CSS, served by the daemon).
> Scope is the **Operator Cockpit page only** — everything stays scoped under `.cockpit`
> so the other dashboard tabs (Missions / Tasks / Approvals / Memory) are untouched.

## 0. Why this redesign

The current cockpit is a fixed `sidebar | main | right` grid plus a `bottom` row, with
**all five right-hand panels and four bottom panels rendered at once**. The header is a
large `cockpit-top` block + a `health-strip`. It works, but it's busy: the operator sees
everything all the time and the big TOKENS & COST block dominates.

The redesign rebuilds it "Codex-clean": a quiet top strip, a collapsible history sidebar
grouped by repo, a single right **inspector** with a tab strip (one dock at a time), and a
real conversation thread with a collapsed "Worked for…" process block. **No behavior
changes** — every API action (brainstorm → roadmap → approve → start → pause/resume →
draft-PR) keeps its exact wiring; this is a shell + design-system change.

## 1. The four principles (from the design doc) → how we deliver them

| # | Principle (was → becomes) | Implementation |
|---|---------------------------|----------------|
| 1 | **Collapsible history, grouped by repo** (was: always-on flat list) | `Sidebar` groups sessions under their repo; one click folds it to a thin 56px rail. |
| 2 | **Right side = docks you choose** (was: 5 fixed cards) | Single right **inspector** with a tab strip; one dock visible at a time (Direction A). Bottom row is removed — its panels become tabs. |
| 3 | **Compact top bar, no giant tokens block** (was: oversized TOKENS & COST + cockpit-top) | One quiet ~52px `.ck-topstrip`: daemon · provider · runs · tokens · cost · repo · approvals. |
| 4 | **A real Codex-style thread** (was: loose buttons/chips) | Prompts, replies, inline clarification chips, and a collapsed **"Worked for…"** process block you can expand. |

Direction-A extras locked in: **⌘K command palette** and the **collapsible sidebar**.
(Directions B "dock rail" and C "floating draggable docks + pipeline rail" are explicitly
out of scope.)

## 2. Shared design system (ported from `prototypes/base.css`, scoped to `.cockpit`)

System fonts only — `system-ui` + `ui-monospace`, no web fonts.

| Token | Value | Role |
|-------|-------|------|
| `--bg` | `#ffffff` | canvas |
| `--bg-sub` | `#f7f7f8` | sub surface |
| `--bg-inset` | `#f3f3f5` | inset / wells |
| `--ink` | `#18181b` | dark fill / text |
| `--accent` | `#2f6df6` | accent (was `#0071e3`) |
| `--accent-soft` | `#eef4ff` | accent tint |
| `--fg-2 / --fg-3 / --fg-muted` | `#3f3f46 / #52525b / #86868b` | text ramp |
| `--hair` | `1px solid #e8e8ec` | hairline border |
| `--r-md / --r-lg / --r-xl` | `8 / 12 / 16px` | radii |
| `--sh-1 / --sh-2 / --sh-pop` | soft → pop | shadows |

Status vocabulary (badges + `.bdot`): `running · approved · done · pending · failed · draft · paused`.

## 3. Layout spec (Direction A)

```
┌─ .ck-topstrip (≈52px) · daemon · provider · runs · tokens · cost · repo · [approvals] ─┐
├──────────┬───────────────────────────────────┬───────────────────────────────────────┤
│ Sidebar  │ ck-main                            │ ck-inspector                          │
│ (or 56px │  coach line (kicker/title/body)   │  [Roadmap][Activity][Diff&PR]         │
│  rail)   │  ck-thread (conversation)         │  [Monitor][Approvals]   tab strip     │
│ grouped  │   …turns… + "Worked for…" block   │  ── active dock body ──               │
│ by repo  │  composer                         │  (Roadmap dock also holds the         │
│          │                                   │   approve/start/pause/draft buttons)  │
└──────────┴───────────────────────────────────┴───────────────────────────────────────┘
```

CSS grid: `grid-template-columns: var(--sidebar-w) minmax(0,1fr) var(--inspector-w)`,
single row, areas `"sidebar main inspector"`. `--sidebar-w` toggles 248px ↔ 56px (rail);
`--inspector-w` toggles 384px ↔ 0 (hidden). Responsive (<1100px): single column.

### Inspector tab → existing component map (nothing is dropped)

| Tab | Holds (existing components) |
|-----|-----------------------------|
| **Roadmap** | `ExecutionTimeline` + action buttons (Approve/Start/Pause/Resume/Draft PR) + `MissionSnapshot` + draft-PR status |
| **Activity** | `AgentActivity` |
| **Diff & PR** | `DocumentPreview` + `ArtifactList` + PR url / draft-PR status |
| **Monitor** | `ExecutionMonitor` + `RunPanel` (tokens/validators) + `EventLog` (raw) |
| **Approvals** | `ApprovalCard` |

## 4. Work items

- [ ] **W1 — Design tokens.** Add the `--bg/--accent/--hair/--r-*/--sh-*` token block on `.cockpit`; swap cockpit-scoped `#0071e3` → `var(--accent)`. Add `.bdot` to badges.
- [ ] **W2 — Top strip.** Replace `cockpit-top` + `health-strip` with `.ck-topstrip`. Keep the approvals `<button>` (name contains "approvals", calls `onNavigate('approvals')`).
- [ ] **W3 — Shell.** Drop the `bottom` grid row; new 3-column grid with rail + hideable inspector.
- [ ] **W4 — Inspector tabs.** One dock visible at a time; remember last tab in `localStorage`.
- [ ] **W5 — Sidebar.** Group sessions by repo (pass `repos`); collapse to a 56px rail.
- [ ] **W6 — Codex thread.** Add a collapsed **"Worked for…"** process block (`ProcessBlock`) fed by `overview.runProgress` + `overview.events`, rendered at the tail of the thread.
- [ ] **W7 — ⌘K palette.** `CommandPalette` (⌘K / Ctrl+K, Esc, ↑/↓, Enter): new mission, toggle sidebar/inspector, jump to a tab, approve/start/pause/resume/draft-PR (only when applicable), open approvals, switch recent session.
- [ ] **W8 — Verify.** Keep all 22 dashboard tests green + dashboard typecheck clean; Vite preview screenshots (full sidebar, rail, each tab, ⌘K, narrow).

## 5. Acceptance criteria

1. `npx vitest run apps/dashboard` → **22/22 green** (no test weakened; update only assertions whose DOM legitimately moved).
2. `apps/dashboard` `tsc --noEmit` → clean.
3. Exactly one "Start Brainstorm" button; approvals counter still navigates.
4. Sidebar collapses to a rail and groups missions by repo; inspector shows one dock at a time and remembers the choice; ⌘K opens a working palette; thread shows a collapsable "Worked for…" block when a run is active/recent.
5. No global styles changed — other tabs render identically. Accent is `#2f6df6` inside the cockpit only.

## 6. Non-goals

- No API / daemon / event-schema changes.
- No Direction B (icon rail) or C (floating/draggable docks, pipeline rail).
- No new data sources — `uptime` / git `branch` / a real git-diff viewer are **not** invented; the strip and Diff&PR tab show only fields the API already returns.
