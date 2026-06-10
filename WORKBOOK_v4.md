# WORKBOOK v4 · Simple Cowork — 24/7 待命工程团队（v1 → v1.5）

> **本文件是新的唯一事实源 (SoT)。** 取代 `WORKBOOK_v3.md`（v1 已完成；由本计划 P0 归档进 `archive/`）。
> 叙事一律进 `docs/SESSION_LOG_v3.md`（沿用同一日志，倒序）；本文件 §0 保持机器可读小状态块。
>
> **产品论点（一句话）：** 在 v1 已验证的对话式座舱（Claude 澄清/规划 · Codex 编码 · 隔离 Gemini
> 终局裁判）之上，补四块拼图：**Agent SDK credit 成本护栏**（应对 2026-06-15 `claude -p` 计费新政）、
> **跨引擎 review**（Claude 审 Codex 的 diff）、**24/7 watchdog 待命调度**、以及在一个限定安全 repo 上
> 打开真实 Draft-PR 出口——让"一个需求 → 一个真 PR"第一次真正出门。

---

## §0 · STATE (机器可读 · 硬上限 25 行 · 不许写叙事)

```yaml
schema_version: 4
product: simple-cowork
version_target: standby-team-v1.5
current_phase: P4            # P0..P4，见 §3
current_substep: impl_complete_real_e2e_pending
last_session_id: s_0012
open_holds: 0
blocked_on: operator_real_e2e
# next_action 硬上限 2 行：
next_action: |
  P4 代码侧已完成（per-repo 白名单双闸+回归测试，闸全绿）。剩真实 E2E：
  操作员按 docs/operations/P4-first-real-draft-pr.md 在 Mac 上产出第一个真 Draft PR。
```

---

## §1 · 与 v3 的差异（一屏讲清）

- **引擎分工不变（操作员已确认）：** Claude = 澄清官 + 规划官 + **reviewer/debugger**；Codex = coder；
  Gemini = 完全隔离的终局裁判。曾讨论的"Claude=coder / Codex=planner"翻转方案**已否决**（v1 P1 的
  服务端约束、测试与 evidence 协议保持不变）。
- **成本模型修正（外部现实）：** 2026-06-15 起 `claude -p` / `--print` headless 调用消耗独立的
  **Agent SDK monthly credit**（per-user、不可滚存），不再吃普通订阅额度。GR#1 的精神不变
  （构建环节不走 per-token API 计费），但"headless 零边际成本"的假设作废 → P1 装护栏。
- **保持 headless，不改交互式/Computer-Use 驱动：** 95% 门槛依赖 planner 的结构化 JSON 输出；
  抓取交互式 TTY/GUI 不可靠、不可溯源、难审计。已评估并否决。
- **Gemini CLI 2026-06-18 停服不影响本系统：** validator 走 `generativelanguage.googleapis.com`
  REST API（`gemini-validator.ts`），非 CLI。Antigravity 迁移停泊（§6）。
- **24/7 = 待命 watcher，不是空转 token burner：** tick 本身零 LLM 调用；只有"有明确下一步"
  才推进一次，且受 P1 预算约束。
- **闭环真正出门：** v1 所有 E2E 都终止在 `REMOTE_WRITES_DISABLED`；v1.5 在一个限定安全 repo
  上产出第一个真实 Draft PR。merge 永远人工。

---

## §2 · GROUND RULES（沿用 v3 八条 + 两条修订 · 改本节须操作员书面批准）

v3 §2 的 8 条全部继续有效（构建不烧付费 API / 95% 门槛 / 远程写默认关 / validator 只看 evidence /
先 event 后 view / phase 由验收闸控 / 证据诚实 / §0 永远小）。修订与补充：

- **GR#1 修订（credit 计量）：** headless `claude --print` 调用自 2026-06-15 起视为**计量资源**。
  每次调用必须记 `cost.headless_call` 事件；超出预算（§3-P1）→ `HOLD-BUDGET` + 通知，
  **绝不静默 fallback 到 API key**（GR#6 不变）。
- **GR#3 修订（白名单写出口）：** `allow_remote_writes` 升级为 **per-repo 白名单**语义：
  全局开关 + repo 白名单双条件满足才允许 Draft PR；白名单外的 repo 行为与 v3 完全一致（全挡）。
  PR merge / auto-merge 永远不自动执行。
- **新增 GR#9（review ≠ 裁判）：** Claude review（P2）是**过程内质检**，Gemini 仍是唯一终局裁判。
  review 不读 Codex 对话/思维链，只读 diff + PRD/roadmap + failing logs。两者不互替。

---

## §3 · PHASES（P0–P4）

> 每个 phase：**目标 / 交付（含路径）/ L1 验收（可跑的检查）/ 退出条件**。
> 通用闸（每个 phase 退出都要过）：`pnpm typecheck` 0 err · `pnpm lint` 0 err · `pnpm test` 0 fail ·
> 无付费 API 守卫测试绿。

### P0 — 文档收口（把 v3 攒下的漂移修干净）
- **目标** 消灭双/三 SoT；module map 对上 25 个真实包；清理 v3 P3/P6 遗留。
- **交付**
  - 归档 `WORKBOOK_v3.md` → `archive/`（顶部加 SUPERSEDED 头指向本文件）。
  - 归档 `PRODUCTION_WORKBOOK.md` → `archive/`（它仍自称 canonical、引用已归档文件、含机器特定路径）。
  - `docs/roadmap.md`、`docs/aedev-prototype-status.md` 加 OBSOLETE 头或归档
    （后者描述的 Python 双内核与 CLAUDE.md "do not import archive/" 直接矛盾）。
  - 重建 `CLAUDE.md` module map：从真实 `packages/` 树生成，25 包全列、分"产品包/停泊包"两组
    （`packages/memory` 是产品关键包，必须显式列出）；修掉 `aedev` vs `claude247` CLI 名矛盾。
  - `docs/PARKED.md` 补列 6 个漏网孤儿：claude247-bridge / cost-meter / event-log / preview /
    roadmap-agent / secrets（cost-meter 标注 "P1 拟复活"）。
  - 删 `packages/daemon/src/routes/operator.ts:1304-1311` 与 P6 实现矛盾的过时注释；
    清 `apps/dashboard/src/pages/cockpit/` 未被引用的死组件（Sidebar / Observation /
    CommandPalette / ExecutionTimeline）及其孤儿测试。
- **L1 验收** `grep -ril "canonical\|source of truth" --include="*.md"` 根目录只命中本文件；
  CLAUDE.md module map 与 `ls packages/` 完全一致；通用闸绿。
- **退出 → P1** 单一 SoT，文档对得上树。

### P1 — Agent SDK credit 成本护栏（优先级最高：06-15 生效）
- **目标** headless 调用可计量、可设限、超限 hold 而非烧穿或偷跑 API。
- **交付**
  - 复活 `packages/cost-meter`（自 PARKED 移出，按 GR 流程记录）：每次 headless `claude --print`
    调用 append `cost.headless_call` 事件（engine / role / missionId / token 数如可得）。
  - 预算配置（`config/default.yaml`）：`budget.max_headless_calls_per_mission`（默认 15）、
    `budget.max_headless_calls_per_day`（默认 60）、`budget.max_review_cycles`（默认 2，P2 用）。
  - 超限 → `HOLD-BUDGET` + ntfy 通知；守卫测试证明超限请求被 hold 且无 API fallback。
  - 状态条显示当日 headless 调用计数（复用 overview/SSE）。
- **L1 验收** 注入超限 fixture → mission 进 `HOLD-BUDGET` 且事件可见；当日计数可从事件重建
  （GR#5）；新增预算单测；通用闸绿。
- **退出 → P2** 06-15 后任何 headless 消耗都有表、有闸、有通知。

### P2 — 跨引擎 review（Claude 审 Codex 的 diff）
- **目标** worker 产出后、Gemini 终审前，加一道过程内质检与返工回合。
- **交付**
  - worker 完成（或失败）后：Claude headless 读 **diff + PRD/roadmap + failing logs**
    （不读 Codex 对话），输出结构化 `{verdict: "approve"|"rework", findings[], confidence}`。
  - `rework` → 判词渲染为对话气泡，Codex 进返工回合；循环上限 `budget.max_review_cycles`，
    超限 → `HOLD-REVIEW-LOOP`。
  - review 调用计入 P1 计数；evidence 写 `claude-review-<n>.json` 入 mission evidence 目录。
  - 事件：`review.requested` / `review.verdict` / `review.rework_started`。
- **L1 验收** 故意造坏 diff 的 fixture → rework 判词在 UI 可见且触发返工；正常 diff → approve
  直通 Gemini；循环上限测试绿；通用闸绿。
- **退出 → P3** 烂 diff 在到达 Gemini 之前就被便宜地拦一道。

### P3 — 24/7 watchdog（待命调度，不是无限跑 agent）
- **目标** 机器常开、系统待命：定时巡检、有事推进、无事静默、blocker 叫人。
- **交付**
  - daemon 内 tick 调度器（默认 30 min，可配 `watchdog.tick_minutes`）：检查活动 mission 状态 /
    open holds / 超时 worker；**有明确下一步才推进一次**；无事 → 静默（不发通知、不调 LLM）。
  - **每晚 Memory Compiler 定时任务**（修复 v3-P5 偏差：现在只在 Gemini 拒绝时触发，无夜间调度）。
  - hold 新增/变化 → ntfy 通知（接上现有 hold-on-blocker 协议）。
  - tick 本身零 LLM 调用；推进动作产生的 headless 调用受 P1 预算约束。
- **L1 验收** 模拟时钟单测：无事 tick 不产生任何 LLM/通知事件；注入 hold → 通知事件出现；
  夜间 compiler 跑了且 Tier1 文件更新；通用闸绿。
- **退出 → P4** 系统能整夜待命而 credit 计数为零（无任务时）。

### P4 — 真实远程写出口（限定一个安全 repo · 收口）
- **目标** 在白名单 repo 上走完第一个产出**真实 Draft PR** 的完整闭环。
- **交付**
  - `allow_remote_writes` per-repo 白名单实现（GR#3 修订）；白名单初始只含操作员指定的安全 repo
    （默认 `hermus-agent`，操作员可改）。
  - 完整真实 E2E：澄清 ≥95% → roadmap → Codex 编码 → Claude review → Gemini PASS →
    **Draft PR 创建成功（真实 URL）**；merge 不自动执行。
  - evidence：PR URL + 全链路事件 + 截图入 `evidence/`；一段短 soak（≥3 个 watchdog tick 周期）。
- **L1 验收** 真实 Draft PR URL 可访问且为 draft 状态；白名单外 repo 的 create-pr 仍被挡
  （回归测试）；Gemini 非 PASS 仍挡 create-pr（回归测试）；通用闸绿。
- **退出 → done** v1.5 成立：24/7 待命、成本有护栏、有跨引擎 review、闭环真正出门。

---

## §4 · CROSS-CUTTING（每会话退出必跑）
- `pnpm typecheck`（0）· `pnpm lint`（0）· `pnpm test`（0 fail）。
- 无付费 API 守卫测试绿（GR#1）；P1 起预算守卫测试绿。
- 事件一致性：overview 与 cost 计数能从事件重建（GR#5）。
- 不引入 lockfile 漂移。

## §5 · SESSION PROTOCOL（沿用 v3）
- **BOOT**：`git status` clean；读 §0 三行；`open_holds>0` 则本会话只处理 holds。
- **WORK**：只推进 `current_phase`；小步，每过一个 L1 criterion 立刻跑对应 test。
- **EXIT**：跑该 phase L1 + §4；更新 §0（≤25 行）；`docs/SESSION_LOG_v3.md` 追加一条（倒序）；
  commit message 带 `[P<n>] + 验收状态`。

## §6 · PARKED（明确不在 v1.5 范围）
- **Antigravity CLI 迁移**：validator 走 REST API，不受 2026-06-18 Gemini CLI 停服影响；
  若未来需要 CLI 形态 validator，先 ADR。
- **引擎角色翻转**（Claude=coder / Codex=planner）：已评估并否决。
- **薄 `.ai/` 文件协议 + `aiw` 脚本方案**：已评估并否决（repo 已有更重且全绿的实现）；
  其思路保留为未来"朋友 BYO local worker"阶段的参考。
- **多用户 / BYO worker / Web SaaS**：阶段 2+，不在本计划。
- **OpenAI 双 validator**：保持 Gemini-only。
- 其余孤儿包维持 `docs/PARKED.md` 停泊（cost-meter 在 P1 复活除外）。
