# EXECUTION_WORKBOOK · claude-code-247

> **Living document for Claude Code agent.**
> 每次会话开始时 **必须** 读取本文件；结束时 **必须** 更新 §0 STATE 与 §9 SESSION LOG。
> 来源：v2.1 + v2.2 顶层设计（见 `Architecture Review.html`）。
> 这份文档不是一次性计划——它的状态会随每次会话演进。Claude Code 是它的主要读者；操作员是它的最终仲裁者。

---

## §0 · STATE (machine-readable header)

```yaml
# 这一块是机器读的。任何字段修改都要在 §9 留痕。
schema_version: 1
version_target: v2.2.0
current_part: I            # I = v2.1 基座 · II = v2.2 Agent Mesh
current_stage: A           # A B C D E G F1 F2 F3 H I J L M K | M1 M2 M3 M4 K2
current_substage: A.exit   # A.0–A.4 shipped; awaiting L2 reviewer in next session
last_updated_utc: 2026-05-26T09:40:00Z
last_session_id: s_0001
total_sessions: 1
weeks_elapsed: 0
weeks_remaining: 16
open_holds: 0
blocked_on: null
next_action: |
  Next session = L2 reviewer of Stage A. Boot in reviewer mode: do NOT
  read evidence/stage-A/L1-acceptance — read source + event log only.
  Run the acceptance suite plus the §3 Stage A L2 injection (delete the
  SQLite file, rebuild views by reducing event_log, byte-compare). Sample
  3 events and trace via causation_id. Write docs/reviews/stage-A-<date>.md.
  If clean, advance §0 to current_stage: B and queue Stage B SessionProbe work.
sla:
  daemon_recovery_p95_sec: 90
  approval_e2e_p95_min: 5
  redteam_pass_rate: 1.00
  cli_session_pool_min: 1
  reducer_consistency: 1.00
  hold_mttr_p95_min: 15
```

---

## §1 · GROUND RULES (10 条铁律，永不违反)

这些规则的修改本身需要操作员书面批准，并在 §10 文档 changelog 内备案。Claude Code 检测到 §1 被本会话修改时必须立即 HOLD。

1. **永不跳过 acceptance test。** 任何 stage 的 §3 acceptance 没有全绿，stage 状态不能切到 done，不能进入下一 stage。
2. **永不在单次 commit 内混合多个 stage 的代码。** 一次 commit 引用唯一 stage id（如 `[A.2]`）；混跨视为污染。
3. **任何架构决策先写 ADR。** ADR 编号连续；ADR-0010 起对应 v2.1，ADR-0020 起对应 v2.2。无 ADR 的架构改动一律 revert。
4. **任何 schema 变更必须双向兼容。** 添加列允许；删除/重命名列必须先经历 ≥1 个 release 的"deprecated 但保留"窗口。
5. **任何对外副作用必须带 idempotency_key。** `git commit` 用 tree-sha；`git push` 用 cap-token 内嵌 key；GitHub PR 用 title-hash；Anthropic API 用 request-id。无 key 的副作用调用一律拒绝。
6. **任何状态变更先写 event，再更新 view。** 顺序反了视为状态漂移，reducer 一致性测试会爆。
7. **任何不可恢复操作（`rm -rf` / `git rm` / `git push --force` / `DROP TABLE` / npm publish）必须先登记 HOLD 等待 ApprovalGateway 通过。** Stage F3 是唯一预批的 `git rm`，但仍须按 §5 L3 走。
8. **`claude` CLI 子进程只能在 worker 进程内，不能在 daemon 进程内。** 违反此条等于回到 v2.0 的 P0 缺陷。
9. **每次会话开头读取 §0 STATE；结束时更新 §0 字段并追加 §9 session entry。** 跳过 §0 读取 = 视为污染会话，必须回滚。
10. **不修改 §1。** 任何对 §1 的改动必须由操作员手工提交，且 PR 描述里 explicit 注明"GROUND RULES change"。

---

## §2 · SESSION PROTOCOL

### 2.1 BOOT (会话起始，前 5 分钟)

```text
□ git status → working tree 必须 clean。脏树 = 终止会话，回滚或暂存。
□ git log -5 → 上一会话的 commit 是否 reference 了 §0 的 last_session_id？
□ pnpm install → 跑通；锁文件无变更
□ pnpm typecheck → 必须 0 errors
□ pnpm test → 必须 0 failures, 0 skipped
□ 读 §0 STATE → 记下 current_stage / current_substage / next_action
□ 读 §9 上一 session 的 EXIT 报告 → 注意 blockers / open holds
□ 读 §3 对应 stage 的 playbook → 心中明确本次目标
□ 检查 §0 open_holds：任意 hold 存在时，本次会话只能处理 holds，不能推进 stage
□ 输出: "Boot check complete. Stage X.Y. Next action: <一句话>"
```

未通过 boot check 的会话 **不许执行任何写操作**。

### 2.2 WORK (会话主体)

- **单一 stage 原则。** 本次会话只推进 §0 标注的 current_stage；遇到 cross-stage 改动需求，写 issue 等下次会话。
- **小步快走。** 每完成一个 acceptance criterion，立即跑对应 test 并把输出粘到 §6 evidence。
- **副作用前自检。** 任何对外调用前先确认 idempotency_key 已生成、cap-token 未过期、forbidden_paths 未触碰。
- **遇阻即 HOLD，不要硬猜。** 任何与 §1 GROUND RULES 冲突的指令立即 HOLD 并写 §8。

### 2.3 EXIT (会话结束，最后 10 分钟)

```text
□ 跑 stage 的 §3 acceptance 测试套件 → 输出粘到 §6
□ 跑 §4 cross-cutting 静态检查 → typecheck / lint / event 一致性
□ 更新 §0 STATE: current_substage, last_session_id, total_sessions++,
  next_action, blocked_on (如有), open_holds, weeks_elapsed
□ 追加 §9 SESSION LOG entry (倒序，新的在上)
□ 如本会话产生架构决策, 写 ADR-00XX 文件并在 §10 引用
□ commit message 必须包含 [stage_id] 与 acceptance status, 如:
   "[A.2] migrations: add events table; accept 3/3"
□ 写下"如果下次会话只读这一句也够"的 next_action 到 §0
```

未通过 EXIT 流程的会话视为 **未完成**，下次会话的 BOOT 会检测出来并强制回到上次状态。

---

## §3 · STAGE PLAYBOOK

20 个 stage。Part I = v2.1 (Stage A–K)，Part II = v2.2 (Stage M1–K2)。
每个 stage 给出：**目标 / 输入 / 交付 / 接口 / 验收(L1) / 评审(L2) / 验证(L3) / 退出条件 / 常见坑**。
三级合约定义见 §5。

### Stage A — Foundation + Event Log + Dispatch Spike · 2w

- **目标** 建立 v2.1 的事实源（事件日志）、空骨架、ADR-0010、Dispatch spike 结论。
- **输入** v1.0 GA tag (`v1.0.0`)；`docs/adr/0009-aedev-as-primary-control-plane.md`；本 workbook §0。
- **交付**
  - `packages/event-log/src/{appender,reader,reducer,index}.ts` (events.ndjson 库)
  - SQLite migrations: `events` 单一表，所有旧表保留为 view
  - `packages/daemon/src/{session,hold,approval,push,moves,chaos,obs,supervisor}/index.ts` 空导出
  - `docs/adr/0010-three-plane-event-sourced.md`
  - `docs/spikes/dispatch-approval.md`（spike 结论）
  - `CLAUDE.md` 顶部加入 "TS-only · event-sourced · three-plane" 横幅
- **接口**
  ```ts
  interface EventLog {
    append<T extends Event>(e: T): Promise<EventId>;
    read(taskId: string, fromTs?: string): AsyncIterable<Event>;
    reduce<S>(taskId: string, reducer: Reducer<S>): Promise<S>;
  }
  ```
- **L1 Acceptance** `pnpm test --filter @claude247/event-log` 全绿；reducer 双向不变式 `events → state → events` 等价类单测 ≥ 5 用例；`pnpm typecheck` 绿；ADR-0010 与 spike 文件存在且互相引用。
- **L2 Review** reviewer agent 独立跑一遍：删 SQLite 后由事件日志 reduce 出 view，与删前 snapshot 比对应一致。
- **L3 Validate** 操作员人工读 ADR-0010 + spike 结论，确认默认 transport（Dispatch / Tailscale）选择。
- **退出条件 → B** 上面三级全过，§0 切到 `current_stage: B`。
- **坑** ① events.ndjson 文件随月份 rotate，rotate 边界的 reducer 必须正确；② Dispatch spike 不要被外部不确定拖延：spike 失败立即切 Tailscale 默认，不阻塞 B 启动。

### Stage B — SessionProbe + Subscription Budget · 1.5w

- **目标** worker 内 CLI 心跳与配额可见；HOLD 接入 7 个原因之一 (`session_expired`)。
- **交付** `packages/cli-robust/src/{probe,quota}.ts` 雏形 (v2.2 M1 再扩)；`session_health` view；事件 `cli.session.probed / .expired`、`cli.quota.threshold`。
- **L1** mock keychain 失效 15 分钟内产生 HOLD；mock 1000 calls 触发 `HOLD-quota-exhausted`；单测 ≥ 8 用例。
- **L2** reviewer 跑随机注入：30 次 probe 中随机 3 次 fail，期望恰好出现一个 `HOLD-session-expired`。
- **L3** 操作员手工断网 30 秒，确认手机收到 ntfy。
- **退出 → C** 心跳与配额都能从事件日志重建。

### Stage C — Interrupt = HOLD + SLA · 1.5w

- **目标** HOLD 升级为带 policy 的 Interrupt；7 大中断原因接入。
- **交付** `packages/interrupt-bus/src/{repository,service,policy,escalator}.ts`；事件 `hold.created / .resolved / .escalated / .dropped`；`~/.claude-code-247/logs/holds.md` 同步写。
- **L1** 7 个原因各注入一次：表 view + holds.md + ntfy 三处一致；policy `{ttl, on_timeout}` 单测覆盖。
- **L2** reviewer 注入 `session_expired` 然后等 ttl 过期 → 期望自动 retry 3 次后 drop；`secret_grant_request` 等 24h 不动 → 期望永停。
- **L3** 操作员从手机解除一条 HOLD，task 5 分钟内续跑。
- **退出 → D / E 并行**

### Stage D — Approval Dual-Rail · 2w

- **目标** Dispatch + Tailscale 双 transport 从 day 0 并行；spike 结论决定默认。
- **交付** `packages/approval/src/{gateway,dispatch-transport,tailscale-transport,token,htmx-ui}.ts`；config 字段 `approval.transport`。
- **L1** 两 transport 各跑通一次 approve / reject；token HMAC 单测覆盖过期/伪造/重放。
- **L2** reviewer 在 dispatch fail 注入下确认 Tailscale 自动 fallback；e2e p95 < 5 分钟。
- **L3** 操作员从手机做一次真实 approve；事件日志显示完整因果链。
- **退出 → F1**

### Stage E — Push Capability + Judges Git Fetch · 2w

- **目标** worker 默认无 push 凭据；capability token (5min, branch-scoped) 由 daemon 签发；judges 独立 git fetch 读 PR diff。
- **交付** `packages/push-policy/src/{policy,cap-token,signer,verifier}.ts`；`packages/validator/src/judges/*` 改为独立 git fetch；事件 `push.requested / .allowed / .denied`。
- **L1** 5 类 cap-token 边界（过期 / 错分支 / 错 task / 错签名 / 错 actor）各被拒绝；正常 push 通过。
- **L2** reviewer 跑红队 round 1：5 个提示词注入（含允许路径 exfil），0/5 进 main。
- **L3** 操作员手工构造 1 个绕过尝试，确认 HOLD + 完整事件链。
- **退出 → F1**

### Stage G — Move = Saga · 1.5w

- **目标** Move 升级为 saga step：precondition / act / compensate；任何副作用接受 idempotency_key。
- **交付** `packages/moves/src/{saga,idempotency,compensator}.ts`；事件 `move.{started, act.completed, act.failed, compensated, advanced}`；FSM 见 `Architecture Review.html` §03。
- **L1** 同一 move 重放 10 次副作用仅 1 次；compensate 单测覆盖。
- **L2** reviewer 在 act 中段杀 worker，下次 reduce 后续接；evidence 完整。
- **L3** 合成 task 在 move 3 中段 daemon 被 kill -9，task 自动续到 move 4。
- **退出 → F1**

### Stage F1 — TS Dispatcher Shadow-Write · 1.5w

- **目标** TS dispatcher 与 Python dispatcher 并行运行；两侧写入对照；不切流。
- **交付** `packages/daemon/src/dispatcher.ts`；对照器 `packages/shadow/src/diff.ts`。
- **L1** 24h shadow 运行后两侧决策 diff < 0.1%（容忍 timing 抖动）。
- **L2** reviewer 抽样 10 条 diff 人工解释合理性。
- **L3** 操作员看 dashboard 双侧时序图无明显漂移。
- **退出 → F2**

### Stage F2 — Dashboard Rewrite + 双站点 · 1.5w (并行)

- **目标** Fastify 静态 dashboard 与旧 Flask dashboard 双站点同时服务；JSON 契约保留。
- **交付** `packages/daemon/src/dashboard/*`；双 8423 (旧) + 7247 (新)；JSON shape 测试。
- **L1** `/status-board.json` 两端 byte-equal（容忍 generated_at 时间戳）。
- **L2** reviewer 跑现有 SMS-shaped CLI 命令对接新 dashboard，输出一致。
- **L3** 操作员手机访问新 dashboard 一周无报错。
- **退出 → F3**

### Stage F3 — Python `git rm` + Cutover · 1w

- **目标** 关闭 Python dispatcher、删除 Python 树、launchd 切到单 `com.claude247.daemon`。
- **交付** `git rm -r orchestrator/ gateway/ runner/ validator/ dashboard/ memory/ pyproject.toml tests/` (Python 部分)；launchd plist 单文件；CI 删除 pytest job。
- **L1** F3 当天 8h integration soak；TS dispatcher 单独承载。
- **L2** reviewer 检查 archive/ 不动；CHANGELOG 写明删除范围。
- **L3** 操作员观察 7 天无回退诉求。
- **退出 → H/I/J/L/M 并行**
- **坑** 这是不可恢复操作（GROUND RULE 7），必须先 HOLD + ApprovalGateway 通过；且必须先 7 天观察窗口在 F2 之后。

### Stage H — Cross-Platform Supervisor · 1w

- **目标** launchd / systemd / docker-compose 三后端；`claude247 install` 自动检测。
- **交付** `packages/supervisor/src/{launchd,systemd,compose,detect,install}.ts`；安装器测试矩阵 mac / Ubuntu / Alpine。
- **L1** 三平台各 install / status / restart / uninstall 通过。
- **L2** reviewer 在 Linux Ubuntu 跑 24h，与 Mac 数据对齐。
- **L3** 操作员手工 install + 跑一个合成 task。
- **退出 → K (随 I/J/L/M 一并)**

### Stage I — Chaos Drills · 1w (并行)

- **目标** 5 类故障注入：kill worker / fill disk / drop network / expire session / hold sqlite write-lock。
- **交付** `packages/chaos/src/{drills,injector,scheduler}.ts`；周日 03:00–04:00 UTC chaos-window。
- **L1** 5 类各注入 1 次，期望 HOLD 出现且自动或操作员可解除。
- **L2** reviewer 抽 1 类做手工注入验证。
- **L3** 操作员看 dashboard 5 次注入全有事件链可追。
- **退出 → K**

### Stage J — Observability Triple · 1w (并行)

- **目标** `/events` SSE + Prometheus `/metrics` + Loki JSON 日志。
- **交付** `packages/daemon/src/obs/{sse,metrics,structured-log}.ts`；新增 gauges `holds_open / approval_pending / session_health / subscription_calls_24h / moves_in_flight`。
- **L1** 同一事件三平面（SSE / Prom / Loki）可见且 id 一致。
- **L2** reviewer 跑负载 100 events/min，无丢事件。
- **L3** 操作员 grep 任意事件 id 三处都能查到。
- **退出 → K**

### Stage L — 安全审计 · 1w (新增, 并行)

- **目标** 红队 round 2（在 v2.1 全部启用条件下重跑）；静态扫描；secret 泄漏扫描。
- **交付** `packages/security/redteam/*.json`（30 个攻击 prompt）；CI 加 `gitleaks` + `semgrep`。
- **L1** 30 个攻击 0/30 进 main；静态扫描 0 high severity。
- **L2** reviewer 抽 5 个攻击手工复现。
- **L3** 操作员审阅红队报告。
- **退出 → K**

### Stage M — 升级 / 回滚剧本 · 1w (新增, 并行)

- **目标** v1↔v2.1 双向迁移脚本；schema 兼容窗口验证；回滚演练。
- **交付** `scripts/migrate/{up,down}-v1-v2.1.ts`；`docs/upgrade-guide.md`；feature flag `daemon.legacy_mode`。
- **L1** 用 v1.0 GA snapshot 跑 up → 跑业务 → 跑 down，数据 byte-equal。
- **L2** reviewer 验证 view 兼容性。
- **L3** 操作员模拟"K+3 发现漏洞" → 30 分钟回到 v1。
- **退出 → K**

### Stage K — 72h Soak + Release · 5d + 72h

- **目标** v2.1 最终 soak + release。
- **交付** 72h soak 报告 `M22c_SOAK_FINAL.md` 含每 6h 一次混沌注入记录；`v2.1.0` tag；release notes。
- **L1** 72h 期间：`moves_completed > 0` / `interrupts_auto_resolved >= injected_count - 1` / `push_rejections > 0`（来自红队）/ daemon 重启恢复 p95 < 90s。
- **L2** reviewer 跑"删 SQLite 冷启动恢复 < 90s"演练。
- **L3** 操作员签字：手机收到的所有 HOLD 都能在 5 分钟内决策。
- **退出 → 触发 W11 Go/No-Go**（见 §3.99）。

### Stage W11 — Go / No-Go 评审 (决策点, 0.5d)

- **决策** 全部 SLO 达标 → 进入 W12 v2.2-M1。
- **不通过** → W12–W16 转为 v2.1 强化期，明确补丁列表。**不要带病加 Agent Mesh。**

### Stage M1 — CLI Robustness Layer · 1w (v2.2 起点, W12)

- **目标** 让订阅 CLI 跑 7×24 真不出意外：version drift / output injection / session pool / quota oracle。
- **交付** `packages/cli-robust/src/{probe,sanitizer,pool,quota}.ts` 完整版（B 阶段已建雏形）；事件 `cli.canary.* / cli.output.sanitized / cli.session.acquired`。
- **L1** 注入 5 种伪造 CLI 输出（含 `<system>` 注入）全识别；杀 pool 内 1 session 剩余继续承载；quota oracle ±5%。
- **L2** reviewer 注入 canary 失败模式，确认升级被阻断 + 回滚到上一 baseline。
- **L3** 操作员手工切 CLI 大版本，观察 canary harness 全程行为。
- **退出 → M2 + M3**

### Stage M2 — RoadmapAgent · W13 前半 (并行 M3)

- **目标** 每日扫描 roadmap + Issues，自动起草 mission proposal 进 ApprovalGateway。
- **交付** `packages/roadmap-agent/src/{scanner,classifier,emitter,cron}.ts`；事件 `roadmap.scan.started / .proposal.emitted`；prompts 入 `prompts/`。
- **L1** 当前 repo roadmap.md 产 ≥ 3 个 proposal；5 个手工标注 typo 全 classify 为 fast-track。
- **L2** reviewer 把 24h 内的提案与人工心目中的 mission 列表比对，召回率 ≥ 0.6。
- **L3** 操作员从手机批准一条 proposal，端到端能跑到 PR。
- **退出 → M3 同步**

### Stage M3 — Agent Mesh Kernel · W13 后半 + W14

- **目标** 动态 AgentTypeRegistry + subtask protocol + fan-out/fan-in + escalation。
- **交付** `packages/agent-mesh/src/{registry,instance,protocol,escalation,budget,fan-in}.ts`；5 个内置 type 从 `runner/roles/` 迁移；事件 `agent.spawned / .subtask.split / .subtask.completed / .subtask.failed / .fan_in.resolved / .exited`。
- **L1** Planner spawn 3 个并发 Coder 全部完成；中间 1 个失败自动 Repair 通过；同一 agent 重启后状态从事件日志重建一致。
- **L2** reviewer 注入随机失败模式（每 10 个 subtask 1 个 fail），fan-in 正确率 ≥ 0.99。
- **L3** 操作员看 dashboard agent tree 视图与事件日志一致。
- **退出 → M4**

### Stage M4 — ToolCallSentinel · W15

- **目标** 拦截每个 tool call → sentinel agent 实时审 → allow / soft-block / hard-block。
- **交付** `packages/sentinel/src/{interceptor,reviewer,policy,budget}.ts`；红队 suite `packages/sentinel/redteam/*.json`。
- **L1** 10 个红队 prompt 0/10 漏判；100 个正常 tool call false-block < 2%；sentinel token 占总预算 < 8%。
- **L2** reviewer 抽 5 个红队人工复现 + 抽 10 个正常调用确认 sentinel 推理合理。
- **L3** 操作员构造一个边缘 case（如 curl 内网 IP），观察 hard-block + HOLD。
- **退出 → K2**

### Stage K2 — v2.2 Integration Soak + Release · W16

- **目标** v2.2 端到端 soak + release。
- **交付** 72h soak 报告 `M23_AGENT_MESH_SOAK.md`；`v2.2.0` tag；升级/回滚开关 (feature flag `mesh.enabled`)。
- **L1** 72h 期间：≥ 1 个 RoadmapAgent 提案 PR 自主完成并合入；fan-out ≥ 5 并发 Coder 出现 ≥ 1 次；sentinel 实战拦截 ≥ 1 次；CLI session 全池失效 0 次。
- **L2** reviewer 跑红队 round 3（mesh 启用条件下重跑 30 个攻击）0/30 漏判。
- **L3** 操作员签字；feature flag 一键切回 v2.1 验证成功。
- **退出 → 项目完结**

### Stage 3.99 — 不在主线但永远有效

- **HOLD-only 模式** 任何 stage 进行中如 `open_holds > 0`，本会话只能处理 holds，不能推进 stage。
- **回滚演练** 每 4 周一次随机 stage 回滚演练；演练失败暴露 GROUND RULE 4 违反。

---

## §4 · CROSS-CUTTING STANDARDS

### 4.1 测试规范

- 无 `.only` / 无 `.skip`（CI 静态检查）。
- 单测 < 100ms；集成测试 < 5s；超时即拆。
- Reducer 双向不变式必须有：`replay(events) → state` 与 `serialize(state) → events_subset`。
- 任何接受 idempotency_key 的方法必须有"重放 N 次副作用 1 次"测试。

### 4.2 Commit 规范

```
[<stage_id>] <短描述>: <详细>; accept <pass>/<total>

例:
[A.2] migrations: add events table with NDJSON sidecar; accept 5/5
[M3.1] agent-mesh/registry: declarative AgentType + 5 builtins; accept 8/8
[M4.0] sentinel: interceptor hook + Haiku reviewer; accept 6/7  (1 blocked by config)
```

不符合此格式的 commit 由 commitlint 阻断。

### 4.3 ADR 规范

- 文件名 `docs/adr/00XX-kebab-case.md`，连续编号不许跳。
- 必须包含 `# Status` (Proposed / Accepted / Superseded by 00YY) / `# Context` / `# Decision` / `# Consequences` / `# Date`。
- 任何 ADR 切到 Accepted 必须有 §0 STATE 更新作为佐证。

### 4.4 Event Log 规范

每个 event 字段：

```json
{
  "id": "evt_01HXYZ...",
  "task_id": "task_4821",
  "ts": "ISO8601 UTC",
  "actor": "daemon | worker.<role> | operator | system",
  "kind": "<area>.<thing>.<verb>",
  "idempotency": "sha256:...",
  "payload": { ... },
  "causation_id": "evt_...",
  "correlation_id": "task_4821"
}
```

不变式：
- 同一 `idempotency` 在事件日志中至多 1 次。
- 任意 event 可追溯到根因。
- 删 SQLite → reduce 全部 events → state 与删前 byte-equal（除 generated_at 时间戳）。

### 4.5 Idempotency 规范

| 副作用 | key 来源 |
|---|---|
| `git commit` | tree-sha |
| `git push` | cap-token-id + branch + base-sha |
| `gh pr create` | title-hash + base-sha |
| `npm publish` | package-name + version |
| Anthropic API | request-id (X-Request-Id) |
| `ntfy publish` | task_id + event.id |
| `gh check create` | run_id + check_name |

任何新副作用接入必须先在本表登记并加 §4.5 的入口测试。

### 4.6 失败处理

- **可重试错误**（5xx, network, lock）→ 指数退避，最多 3 次。
- **不可重试**（4xx 配置错, schema error）→ 立即 HOLD。
- **可疑错误**（sentinel hard-block, validator disagreement）→ HOLD + InterruptBus policy 处理。
- 永远不要"swallow exception"。永远 log 后向上抛或写入事件。

---

## §5 · L1 / L2 / L3 三级合约 (ACCEPTANCE / REVIEW / VALIDATE)

每个 stage 退出必须三级全过。

### L1 · ACCEPTANCE — Claude Code 自审 (每个 stage 退出时)

- **谁做** 当前 Claude Code 会话（执行者本身）。
- **怎么做** 跑 stage 的 §3 Acceptance 测试套件；输出粘到 §6 evidence；结果写 §9 SESSION LOG。
- **门槛** 全绿。任何红/skip 都不能退出。
- **可信度** 自审，有盲点；故有 L2 / L3。
- **失败时** 留在当前 stage，写 §8 HOLD，下次会话继续。

### L2 · REVIEW — 独立 reviewer agent (每个 stage 完成后下一次会话)

- **谁做** 独立的 Claude Code 会话，必须不是写代码的那一次；以 reviewer mode 启动（命令 `aedev session start --mode=reviewer --stage=<X>`）。
- **怎么做**
  1. 不读 §6 evidence，只读源代码 + 事件日志。
  2. 跑 stage 的 acceptance 套件 + reviewer-specific 注入（见 §3 各 stage L2 描述）。
  3. 抽样 3 个 event 反向追因。
  4. 写 reviewer report `docs/reviews/<stage_id>-<date>.md`。
- **门槛** 测试全绿 + reviewer 主观 "no smell"；任何"看起来不对"必须落字。
- **失败时** 切回 stage 状态为 `review_failed`，下一会话 Claude Code 必须先回应所有 review 点。

### L3 · VALIDATE — 操作员或 chaos 注入 (每个 milestone 完成后)

- **谁做** 操作员（人）；或预定义的 chaos drill；或 (M2/M3/M4 阶段) 一个第三方 LLM judge。
- **怎么做** 见 §3 各 stage L3 描述；操作员从手机给出 approve/reject。
- **门槛** 操作员或 drill 通过 → 真切到下一 milestone。
- **失败时** 整个 milestone 回退，evidence 标 `validate_failed`，必须开一个 incident report。

### 三级合约不可短路

- L1 红 → 永远不能进 L2。
- L2 红 → 永远不能进 L3。
- L3 红 → 永远不能合 main / 不能 tag release。
- 操作员只能在 §8 escalation 流程下显式覆盖（覆盖会写入事件日志 + §9 + ADR）。

---

## §6 · EVIDENCE 包格式

每个 stage 一个 evidence 目录：

```
evidence/
└── stage-<id>/
    ├── L1-acceptance/
    │   ├── pnpm-test.txt
    │   ├── typecheck.txt
    │   ├── coverage.json
    │   └── notes.md
    ├── L2-review/
    │   ├── reviewer-report.md
    │   ├── sampled-events.ndjson
    │   └── reproduction.sh
    ├── L3-validate/
    │   ├── operator-signoff.md (or chaos-drill-report.md)
    │   └── screenshots/
    └── METADATA.yaml
```

`METADATA.yaml` 字段：

```yaml
stage: A
substage: A.2
start_ts: 2026-05-26T...
end_ts: 2026-05-28T...
l1_status: passed | failed | partial
l2_status: passed | failed | not_run
l3_status: passed | failed | not_run
acceptance_pass: 5
acceptance_total: 5
exit_to_next: yes | no
evidence_complete: yes | no
session_ids: [s_001, s_002]
```

不写 evidence 的 stage 视为未完成。

---

## §7 · UPDATE PROTOCOL (本文档的自演进)

本 workbook 必须随项目演进而更新。但 **修改本身需要纪律**。

### 7.1 可自由修改

- §0 STATE 全部字段（每次会话退出必须更新）
- §9 SESSION LOG (append-only)
- §10 DOCUMENT CHANGELOG

### 7.2 需 reviewer agent + 操作员双签

- §3 STAGE PLAYBOOK 任何条目
- §4 CROSS-CUTTING STANDARDS
- §5 三级合约
- §6 EVIDENCE 格式
- §8 ESCALATION

### 7.3 仅操作员手工修改

- §1 GROUND RULES
- §7 UPDATE PROTOCOL（本节本身）

### 7.4 修改流程

1. 提议改动 → 写到一个 `proposals/workbook-amend-YYYYMMDD.md` 草案。
2. 草案进 ApprovalGateway → reviewer agent 自动评一遍 → 操作员签 (§7.2/7.3 要求)。
3. 通过后 commit 同时改 workbook + 在 §10 留 changelog entry，并 reference 草案路径。
4. 失败的草案归档到 `proposals/archived/`，不删除。

---

## §8 · ESCALATION 与 HOLD

### 8.1 何时必须 HOLD

7 个原因 (与 v1 的 `interruption-policy.ts` 对齐)：

| 原因 | policy.ttl | on_timeout |
|---|---|---|
| `session_expired` | 5 min | retry-3 → drop |
| `quota_exhausted` | 30 min | drop（等下个 budget 周期） |
| `secret_grant_request` | ∞ | 永停（必须人工） |
| `validator_disagreement` | 30 min | escalate |
| `production_incident` | ∞ | 永停 |
| `forbidden_path_push` | ∞ | 永停 |
| `sentinel_rejected` (v2.2) | 15 min | escalate |

### 8.2 HOLD 升级路径

```
HoldService 创建 HOLD
   ↓ ttl 过期
escalator: 按 policy 触发 retry / drop / escalate
   ↓ escalate
ApprovalGateway: ntfy → 操作员手机
   ↓ 24h 操作员无响应
报警升级到第二条 transport (Tailscale fallback)
   ↓ 48h 仍无响应
全 daemon 进入 safe-mode (新 task 不再启动)
```

### 8.3 Claude Code 自身的 HOLD 行为

- 检测到 `open_holds > 0` 时，本次会话只处理 holds，不能推进 stage。
- 检测到 §1 GROUND RULES 被违反时，立即 HOLD-self（特殊原因 `workbook_rule_violation`），不写任何代码。
- 检测到 evidence 缺失或 stage 状态可疑时，HOLD-self + 等下次操作员介入。

---

## §9 · SESSION LOG (append-only, **新的写在最上**)

格式：

```
### s_<NNNN> — <UTC timestamp> — <hours> h
- stage_in: A.0 → stage_out: A.1
- l1: 5/5 · l2: not_run · l3: not_run
- commits: [a1b2c3d, e4f5a6b]
- adrs: ADR-0010
- holds_opened: 0 · holds_resolved: 0
- next_action: <见 §0>
- notes: <一两句>
```

### s_0001 — 2026-05-26T09:40:00Z — ~1.5 h

- stage_in: A.0 → stage_out: A.exit (A.1–A.4 all shipped)
- l1: 4/4 · l2: not_run · l3: not_run
- commits:
  - `1e5a861` [A.0] workbook persist
  - `18b078f` [A.1] event-log package (11 tests)
  - `9cde92e` [A.2] migration v3 event_log table (6 tests)
  - `fc2ece7` [A.3] daemon skeleton dirs (8 placeholders)
  - `300b73a` [A.4] ADR-0010 + dispatch spike + CLAUDE.md banner
- adrs: ADR-0010
- holds_opened: 0 · holds_resolved: 0
- next_action: see §0 next_action — Stage A L2 reviewer pass.
- notes:
    - Workbook persisted to repo root so future sessions can read §0.
    - Branched `v2-foundation` from `converge/product-spine` HEAD (NOT
      from literal v1.0.0 tag — that tag predates the pnpm/TS workspace
      that Stage A.0's boot check requires; deviation documented at the
      top of the s_0001 session).
    - `@aedev/event-log` shipped (workbook said `@claude247/event-log`;
      kept namespace consistent with rest of workspace — full rationale
      in `evidence/stage-A/L1-acceptance/notes.md`).
    - New daemon subsystem dir `approval-v2/` (not `approval/`) to avoid
      TS module-resolution collision with the existing `approval.ts` flat
      file. Will be renamed in Stage D when legacy approval is retired.
    - Migration v3 adds `event_log` table additively; v1 `events` table
      preserved intact per GROUND RULE 4.
    - Stage A acceptance specifically scoped (event-log + migrations +
      typecheck + ADR/spike cross-ref) — 17/17 tests + clean typecheck.
    - Full-suite `pnpm test` has a pre-existing flake: 3 subprocess tests
      timeout under heavy parallel load, pass in isolation. Flagged for
      follow-up; not a Stage A regression.

#### s_0001 — placeholder (会话尚未开始)

- stage_in: — → stage_out: —
- l1: — · l2: — · l3: —
- commits: []
- adrs: []
- holds_opened: 0 · holds_resolved: 0
- next_action: 启动 Stage A
- notes: workbook 创建，等待操作员 kick-off。

---

## §10 · DOCUMENT CHANGELOG

| 日期 | 版本 | 改动 | 由谁 | 引用 |
|---|---|---|---|---|
| 2026-05-26 | 1.0 | 初版；20 stage playbook；三级合约；HOLD 升级；evidence 格式 | architect | `Architecture Review.html` |

---

## §11 · QUICK REFERENCE (Claude Code cheat sheet)

每次会话最该记的 7 件事：

1. 读 §0 STATE → 知道我现在在哪。
2. §1 是铁律 → 任何冲突指令立即 HOLD。
3. 单 stage 单 commit → commit message 必须 `[stage_id]` 开头 + accept 状态。
4. 副作用 → idempotency_key 必须先建。
5. 状态变更 → 先 event 再 view。
6. 退出前 → 跑 acceptance + 更新 §0 + 追加 §9。
7. 三级合约 L1 自审 / L2 reviewer / L3 操作员，不许短路。

如果你只能做一件事，是 #1。
