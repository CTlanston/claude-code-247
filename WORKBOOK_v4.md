# WORKBOOK v4 · 24/7 Autonomous Dev Fleet

> **续 [WORKBOOK_v3.md](WORKBOOK_v3.md)**(产品基线:对话式座舱,P0–P7 已在 `origin/main @ a7d400f`)。
> **取代 WORKBOOK_v3.1 / PR #27** —— v3.1 的 H1–H2(闭合真实缺口)被吸收为本簿 **F0**,#27 可关闭。
>
> **目标:** 把系统从"单操作员、人在环、一次一 mission 的座舱",推进到"**连续、并发、多 agent 的
> 7×24 自治开发团队**"——对标 Anthropic 内部 24/7 开发团队。
>
> **诚实前提(operator 选择直接上 fleet,我据此规划,但坚守一条底线):** 一个会**自动合并代码**的
> 7×24 fleet,若其 Gemini 闸 / E2E 从没真跑过,那是危险而非自治。因此 **F0 先把两个被独立验证出来的
> 真实缺口钉死**(2026-06-03 审计:P4 真 Gemini 从没判过真 diff、P7 跑在 /tmp 无真判词),fleet 才在其
> 上生长。**复活任何 parked 包(agent-mesh / moves / cli-robust / sentinel / chaos / interrupt-bus)
> 必须先写 ADR**(承 v3 GR#3),否则 revert。

---

## §0 · STATE (机器可读 · ≤25 行 · 不许写叙事)

```yaml
schema_version: 4
parent_workbook: WORKBOOK_v3.md
supersedes: WORKBOOK_v3.1.md        # 其 H1-H2 == 本簿 F0
cycle: autonomous-dev-fleet
current_phase: F0                   # F0..F6,见 §3
current_substep: not-started
last_session_id: s_0000
open_holds: 0
blocked_on: none
next_action: |
  启动 F0:让真 Gemini 对真 diff 出 PASS+FAIL、在注册 repo(hermus-agent)跑通真 E2E,并把"无人值守时
  缺 Gemini PASS / 缺 flag / 超 risk 一律不合并"写成 fail-closed 测试。然后 F1 起 PR-by-PR 逐阶段推进。
```

---

## §1 · 愿景(一屏讲清)

从"座舱"到"团队":一个**连续自驱的 daemon**,从 backlog(roadmap / issues)拉取工作 → **多 mission 并发执行**
(planner 扇出并发 coder/reviewer)→ **真 Gemini 独立裁判** → **按风险自动合并**(低险自动、中险手机批、
高险拦)→ 全程**崩溃可恢复、配额可控、安全 fail-closed、手机可控**。操作员只在**闸口**出现(批准/拒绝/
暂停),不再点每一步。已有地基:对话座舱(P3)、95% 门槛(P2)、引擎分工(P1)、团队记忆 Tier1+2(P5)、
混合 DAG(P6)、remote-write 安全闸——本簿把它们接成**无人值守的闭环**,并复活 parked 包补齐并发/恢复/安全。

---

## §2 · GROUND RULES(继承 + fleet 新增)

> 继承 [WORKBOOK_v3 §2](WORKBOOK_v3.md)(8 条:不烧付费 API、95% 门槛、远程写默认关、validator 只看
> evidence、先 event 后 view、证据诚实、§0 保持小)+ v3.1 §2(每 phase 一 commit 一 PR 真推、无真 Gemini
> 判词不许说 "passed"、PR 流程不直推 main)。本簿另加 5 条:

- **GF1 · 无人值守合并 fail-closed。** 自动合并必须**同时**满足:Gemini `PASS` ∧ risk ≤ 阈值 ∧
  `allow_remote_writes` ∧ `repo.enabled` ∧ 无 forbidden path。缺任一 → 不合并(降级为 HOLD 或手机批)。
- **GF2 · 复活 parked 包先写 ADR。** 每个 stage 列出它复活的包及对应新 ADR(顺接 0021 之后);无 ADR 的接线一律 revert。
- **GF3 · 并发/预算硬上限 + 配额感知。** 超并发、超每 repo 预算、订阅配额耗尽 → **HOLD**,绝不崩、**绝不回退付费 API**。
- **GF4 · 幂等 + 可恢复。** 每个对外副作用带 idempotency key;mission 可从事件日志恢复;合并 **exactly-once**。
- **GF5 · 闸口路由手机,无自批。** 中/高险闸经 ntfy/Tailscale 推手机 approve/reject;无 self-approve;
  单 mission 的 HOLD **不得阻塞整个 fleet**。

---

## §3 · STAGES(F0–F6)

> 每个 stage:**目标 / 复活的包+ADR / 交付(含路径) / L1 验收(可跑) / 退出(commit+PR+真推)**。
> 通用闸(每 stage 退出都要过):`pnpm typecheck` 0 · `pnpm lint` 0 · `pnpm test` 0 fail · no-paid-API 守卫绿 · 无人值守 fail-closed 测试绿。

### F0 — 真闸地基(吸收 v3.1 H1–H2,fleet 的前置)
- **目标** 自动合并所依赖的闸必须先真:真 Gemini 判真 diff + 真 E2E + 无人值守 fail-closed。
- **交付** `AEDEV_GEMINI_API_KEY` 注进常驻 daemon(仅 validator;coder/planner 仍剥离);真 Gemini 对**坏 diff→FAIL、好 diff→PASS**,判词落 `evidence/`(model+verdict+理由);在注册 repo `hermus-agent` 跑通真 E2E;新增 **"operator 缺席时,缺 Gemini PASS / 缺 flag / 超 risk → 一律不合并"** 的 fail-closed 测试(GF1)。
- **L1** `evidence/` 有真 Gemini **PASS+FAIL**;`hermus-agent` 真 E2E 报告(planner=claude/coder=codex 真 token/validator=gemini 真判词);GF1 fail-closed 测试绿。
- **退出 → F1** PR 合入。

### F1 — 单道自治闭环(先让一条 mission 零点击跑通)
- **复活 + ADR** roadmap-agent 接线(终结 dead-end NDJSON);**新 ADR**:autonomous-intake-loop。
- **目标** daemon 自驱跑通一条 mission,happy path **零操作员点击**;clarify 达不到 95% → 升级为**手机异步问答** + 该 mission HOLD,**fleet 继续跑别的**。
- **交付** roadmap-agent proposals → `ApprovalGateway` → 自治 mission 队列;`MissionScheduler` 拉取并跑 `MissionRunner`;`operator.ts` 95% 门槛在自治模式下:不达标 → 路由手机 + HOLD(不阻塞其他 mission)。
- **L1** 一条 mission 从 队列 → clarify(必要时升级手机)→ code → Gemini → risk → (gated)merge 全程零点击(除答闸);daemon 重启后该 mission 从事件日志恢复续完。
- **退出 → F2** PR 合入。

### F2 — 并发成队(fleet 的心脏)
- **复活 + ADR** `agent-mesh`(扇出/扇入)、`cli-robust`(session pool + quota oracle);**新 ADR** 各一。
- **目标** 多 mission 跨 repo 并发;planner 扇出并发 coder/reviewer 并 fan-in;CLI 会话池限并发 + 配额感知。
- **交付** `agent-mesh` registry/protocol/fan-in 接进 `MissionRunner`(替/扩 `runDagNodes` 的顺序执行为并发);`cli-robust` 会话池(N 个并发 mission 共享/限本地 claude/codex 会话)+ quota oracle 耗尽 → HOLD;并发上限 + 每 repo 预算(GF3)。
- **L1** ≥3 mission 跨 repo 并发,不耗尽会话/预算;扇出 ≥2 并发 coder 且 fan-in 正确;配额耗尽 → HOLD 非崩、非付费回退。
- **退出 → F3** PR 合入。

### F3 — 持久编排:崩溃恢复 + 幂等
- **复活 + ADR** `moves`(saga / compensator);**新 ADR**:durable-mission-saga。
- **目标** `kill -9` 中段可恢复,对外副作用 exactly-once。
- **交付** 副作用 saga 化(precondition/act/compensate)+ idempotency key(commit=tree-sha / push=cap-token / PR=title-hash);mission 从事件日志续接;无重复 push/merge(GF4)。
- **L1** mission 中段杀 daemon → 重启续完且**恰好一次**;事件 replay 无重复副作用;新增恢复单测。
- **退出 → F4** PR 合入。

### F4 — 自治合并策略 + 手机控制
- **复活 + ADR** `interrupt-bus`(HOLD policy/escalation);可选 `approval-v2`(双轨);**新 ADR**:risk-gated-autonomous-merge。
- **目标** Gemini PASS + risk → 合并决策:**低险自动合并**(仅 flag 开 + repo enabled)、**中险手机批**、**高险拦 + HOLD**。
- **交付** `risk-scorer`(packages/validators)+ Gemini 判词 + `DraftPrGate` 串成 merge 决策(GF1);ntfy/Tailscale 手机 approve/reject/pause/stop,无自批(GF5);interrupt-bus 管 HOLD ttl/升级。
- **L1** 低险 mission **自动合并**(且仅当 flag 开)、中险等手机批准、高险被拦,全 gated、全留证;高险注入 → HOLD + 手机通知。
- **退出 → F5** PR 合入。

### F5 — fleet 可观测 + 无人值守安全(sentinel)
- **复活 + ADR** `sentinel`(tool-call 拦截);**新 ADR**:unattended-toolcall-sentinel。
- **目标** 一眼看全队 + 无人值守下拦危险调用。
- **交付** 简洁 **fleet 视图**(所有活动 mission/agent/hold/cost,可下钻进单对话座舱——守住傻白甜,不回到多面板);`sentinel` 实时审 tool call → allow/soft-block/hard-block + 红队 suite。
- **L1** fleet 视图实时显 N 并发 mission/hold/cost;`sentinel` 在一个无人值守 run 里 hard-block 一个红队调用(如内网 curl)+ HOLD;正常调用 false-block < 2%。
- **退出 → F6** PR 合入。

### F6 — 连续 7×24 soak + chaos(证明它真是 24/7)
- **复活 + ADR** `chaos`(故障注入);**新 ADR**:continuous-soak-chaos。
- **目标** 真连续跑一段窗口,用证据证明它是 24/7 自治,而非演示。
- **交付** `chaos` 定时注入(kill worker / drop network / expire session / fill disk / quota exhaust);连续 soak(operator 定窗口,如 24–72h)。
- **L1** soak 报告(真指标):missions 完成数 > 0、自动合并数(gated)、holds 自动解决/升级数、**0 安全违规**、从 ≥3 次 chaos 注入恢复、预算/配额未超。
- **退出 → done** 真·7×24 自治开发 fleet。

---

## §4 · DONE 定义(本愿景达成)
- **F0–F6 各自 PR 合入 `origin/main`**(PR 流程、非直推);每 stage 复活的包都有对应**新 ADR**。
- `evidence/` 有:真 Gemini **PASS+FAIL** + 真 E2E(注册 repo)+ 连续 **soak 报告(0 安全违规)**。
- 在 `origin/main` 最新 HEAD 可复跑 `pnpm test` 全绿、`pnpm typecheck` 0、no-paid-API + GF1 fail-closed 测试绿。
- **对标达成**:多 mission 并发自驱 · 按风险自动合并(gated)· 崩溃可恢复 · 手机可控 · 连续运行不违反安全。
- §0 STATE 更新 `current_phase: done`;next_action 指向运营期(扩 repo、调阈值、长 soak)。
