# WORKBOOK v3 · Simple Cowork — 极简对话式编码座舱

> **本文件是新的唯一事实源 (SoT)。** 取代 `EXECUTION_WORKBOOK.md`(由 P0 归档进 `archive/`)。
> 设计目标:修掉旧 workbook 的失败模式——§0 是真·机器可读的小状态块,叙事一律进独立的
> `docs/SESSION_LOG_v3.md`,本文件不堆故事。
>
> **产品论点(一句话):** 一个傻白甜的对话式座舱,**借力操作员本地已有的 Claude Code + Codex
> 订阅**,在真正听懂需求(置信度 ≥95%)之前绝不动手;Claude 负责反复澄清+规划,Codex 负责写码,
> 一个**完全隔离的 Gemini** 当独立裁判把最终关。本地优先,构建环节不烧付费 API。

---

## §0 · STATE (机器可读 · 硬上限 25 行 · 不许写叙事)

```yaml
schema_version: 3
product: simple-cowork
version_target: conversational-cockpit-v1
current_phase: P7            # P0..P7,见 §3
current_substep: complete
last_session_id: s_0006
open_holds: 0
blocked_on: none
# next_action 硬上限 2 行,只写"下次会话只读这一句也够"的指令:
next_action: |
  P0-P7 已完成并通过 strict real-smoke、浏览器 quality smoke、真实浏览器检查与测试闸;
  下一步只做可选 hardening/产品化,不要再把 v1 phase 标成 blocked。
```

---

## §1 · 产品形态(一屏讲清)

- **对话即产品。** 纯对话流(Claude/ChatGPT 式)。澄清问答、进度、diff、Gemini 判词——全部内联成对话气泡/卡片。没有旧 cockpit 那堆面板/标签。
- **顶部一条极薄状态条(常驻)。** 仅三样:当前阶段 `澄清 → 编码 → 验证 → PR` · 此刻在跑什么 · 一个进度点。这是"一眼追踪项目到哪了"的全部 UI 重量。
- **引擎分工(都走本地订阅 CLI):**
  - **Claude Code** = 澄清官 + 规划官(那个反复追问、出 PRD/roadmap 的角色)。
  - **Codex** = coder(落地写码)。
  - **Gemini** = 完全隔离的独立裁判(只看成品 evidence,不知道过程)。
- **95% 理解门槛。** 服务端硬门槛:听懂到 ≥95% 之前,不许进规划/编码。UI 无法绕过。
- **团队记忆(Tier 1+2)。** 每个 repo 一份系统自维护的知识文件 + 全局操作员偏好(Tier 1);从事件日志派生的 mission 结果记忆(Tier 2);每晚 Memory Compiler 把 Tier2 教训晋升进 Tier1。多 mission 共享。

---

## §2 · GROUND RULES(8 条 · 改本节须操作员书面批准)

1. **构建环节不烧付费 API。** 澄清/规划/编码只能用本地 `claude` / `codex` 订阅 CLI。daemon 必须从 coder/planner 子进程环境里**剥除** `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`。唯一例外:Gemini validator 用它自己的 key。一个守卫测试强制本条。
2. **没到 95% 不许动手。** 进 roadmap/编码前必须通过服务端置信度门槛;门槛逻辑在服务端,UI 不能 bypass。
3. **远程写默认关。** `allow_remote_writes` 默认 `false`;Draft-PR gate 是唯一对外出口;**Gemini PASS 是 offer PR 的前置**。
4. **validator 只看 evidence。** 永不喂 coder 对话/思维链;缺 key = `not_configured`,**绝不当 pass**。
5. **先 event 后 view。** 任何状态变更先 append 一条事件,UI/overview 从事件派生。
6. **phase 由验收闸控。** L1 检查没全绿,phase 不算 done、不进下一 phase;一次 commit 只引用一个 phase,message 带 `[P<n>]`。
7. **证据诚实。** 不许把 mock 当真跑;用 `FORCE_MOCK` 的脚本必须自报家门;FAIL 也要提交,不许掩盖。
8. **§0 永远小且机器可读。** 叙事进 `docs/SESSION_LOG_v3.md`(倒序、可截断);本文件 §0 超过 25 行视为污染。

---

## §3 · PHASES(P0–P7)

> 每个 phase:**目标 / 交付(含路径)/ L1 验收(可跑的检查)/ 退出条件**。
> 全程沿用现有 daemon 后端(mission 生命周期、worktree worker、draft-PR 安全闸),只重写前端 + 补这几项能力。
> 通用闸(每个 phase 退出都要过):`pnpm typecheck` 0 err · `pnpm lint` 0 err · `pnpm test` 0 fail。

### P0 — 对齐现实 + 上锁(de-risk,先把地基弄诚实)
- **目标** 文档对上代码树;孤儿包显式停泊;锁死两条硬规则的物理开关。
- **交付**
  - 重写 `CLAUDE.md` 的 "Module map" + runtime 路径,匹配真实 TS monorepo + `~/.aedev/`(现描述的是已 `git rm` 的 Python 树)。
  - 归档 `EXECUTION_WORKBOOK.md` → `archive/`;本文件成为 SoT。
  - `docs/PARKED.md`:列出未接线的孤儿包(agent-mesh / sentinel / chaos / moves / shadow / supervisor / interrupt-bus / push-policy / approval-v2 / cli-robust / security),标注"实验性·未接入产品·可在 P6/后续复活"。
  - **无付费 API 守卫**:在 coder/planner 启动路径剥除 `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`(子进程 env);新增 `packages/daemon/src/no-paid-api-guard.ts` + 测试。
  - **Gemini 接电**:操作员把 `AEDEV_GEMINI_API_KEY` 加进 `.env`;`scripts/dev-operator-cockpit.ts` 与 daemon 把该 key 注入 validator 环境(coder/planner 拿不到)。
- **L1 验收** 通用闸绿;守卫测试证明 coder/planner 子进程 env 内无付费 key;`grep` 确认 CLAUDE.md 无任何 Python 路径;mission overview 里 validator 从 `not_configured` 变为 `gemini` 已配置(给 key 时)。
- **退出 → P1** 文档对得上树,两条硬规则有物理开关。

### P1 — 引擎分工落地(Claude 澄清/规划 · Codex 编码)
- **目标** 把"谁干什么"钉死,不再默认 Codex 当 planner。
- **交付** 改 `scripts/dev-operator-cockpit.ts:64` 与 `packages/daemon/src/routes/operator.ts` 路由:planner provider 固定 `claude`,coder 固定 `codex`(移除 operator.ts:~1487 那段"按是否双 validator 选 coder"的逻辑)。evidence 里记录 `planner=claude-cli` / `coder=codex-cli`。
- **L1 验收** 跑一个真实 mission(非 mock),evidence 显示 planner=claude-cli、coder=codex-cli,且二者均 subscription-local、无付费调用。
- **退出 → P2** 三引擎各司其职可见于证据。

### P2 — 95% 理解门槛(keystone 行为)
- **目标** 服务端强制:听懂到 ≥95% 之前不许进规划/编码。
- **交付**
  - Claude 澄清回合输出结构化 JSON:`{questions[], confidence:0-100, rationale}`(扩展现有 `parseClarifyQuestions`@operator.ts:568 与 ADR-0020 的 ClarificationGate)。
  - 服务端门槛:`confidence<95` 或仍有未答问题 → 阻断 `generate-roadmap`/`start`,继续追问;`≥95 且无 pending` → 解锁。回合与置信度事件溯源(`clarify.round` / `clarify.confidence` / `clarify.unlocked`)。
  - 散文但无结构化问题时沿用 `HOLD-CLARIFY-STRUCTURE`,不拿模板冒充。
- **L1 验收** 故意含糊的 fixture → ≥2 轮且在 ≥95% 前调用 `start`/`generate-roadmap` 被服务端拒(409/blocked);清晰 fixture → 快速解锁;新增针对门槛的单测。
- **退出 → P3** 含糊需求进不了编码,且无法从前端绕过。

### P3 — 对话式 UI 重写(Apple 时刻的那一屏)
- **目标** 推倒 `apps/dashboard/src/pages/Cockpit.tsx` + `pages/cockpit/*` 的多面板,换成纯对话流 + 极薄状态条。
- **交付** 新 chat shell:单 composer;一条对话线程把澄清问答、进度、diff、Gemini 判词都渲染成内联气泡/卡片;顶部常驻状态条(阶段 + 在跑什么 + 进度点);移除 Project Pulse/多标签。复用 daemon 的 overview/SSE 数据。
- **L1 验收** `pnpm test:cockpit:quality-smoke` 浏览器走查:整条流程呈现为**一条对话** + 状态条;旧面板不再存在;截图入 `evidence/`。
- **退出 → P4** 操作员能在一条对话里看完 澄清→编码→验证 全程。

### P4 — 隔离 Gemini 硬门槛(可见)
- **目标** 成品完成后 Gemini 独立裁决;不过就挡 PR,判词回灌对话驱动返工。
- **交付** 复用 `packages/daemon/src/validator-factory.ts` + `packages/validators/src/gemini-validator.ts`;仅 Gemini(去掉 OpenAI 双验证默认);裁决基于 evidence-only bundle;**HARD GATE**:非 PASS → 阻断 `create-pr` 并把判词作为对话气泡推回,进入 coder 返工回合;判词在 UI 显形。
- **L1 验收** 故意造坏 diff 的 mission 被 Gemini 以可见判词挡住(且 remote-write 闸也仍挡);正常 mission 过闸;针对"Gemini 非 PASS 阻断 create-pr"的单测绿。
- **退出 → P5** 你能亲眼看到 Gemini 工作,并且它真能拦住烂活。

### P5 — 团队记忆 Tier 1+2 + Compiler
- **目标** 让系统跨 mission 变聪明、不重蹈覆辙。
- **交付**
  - 新 `packages/memory/`(TS 树现无此包):
    - **Tier 1** 每 repo 一份系统自维护 `.<repo>/cowork-memory.md`(架构/约定/命令/雷区/上次为何被拒)+ 全局 `~/.aedev/operator-prefs.md`;每次 run 注入引擎上下文。
    - **Tier 2** 事件日志派生的 mission 情节 projection(SQLite,读 `core` 的 events;append-only、可回放)。
    - **Memory Compiler** 每晚把 Tier2 反复出现的教训蒸馏进 Tier1。
    - **Tier 3 seam** 只留接口 `SemanticMemory`(不实现);若实现须本地 embedding(守 GR#1)。
- **L1 验收** mission A 因原因 X 被 Gemini 拒后,同 repo 的 mission B 的引擎上下文里出现 X;repo 知识文件被自动更新;Tier2 可回放;新增记忆单测。
- **退出 → P6** "防重蹈覆辙"闭环可观测。

### P6 — 混合执行(小任务单 run · 大任务拆 DAG)
- **目标** 按 roadmap 规模自动选:小任务维持单 run;大任务拆 per-task DAG,coder/reviewer 按节点跑、fan-in。
- **交付** 一个极简 DAG runner(可考虑复活 `packages/moves` 的 saga 或 `agent-mesh` 的 fan-in,但须先按 GR#3 ADR 化);路由阈值(如 dag.length>6,见 operator.ts:~990 现有 `plan_scale` 警告);每节点独立 evidence;任一节点失败不许把整 mission 假装 pass。
- **L1 验收** 小任务走单 run;大 roadmap 逐节点执行且每节点有 evidence;注入一个节点失败 → mission 不 fake-pass;新增 DAG 单测。
- **退出 → P7** 大任务不再硬塞进一次 600s run。

### P7 — 真·端到端 + 短 soak(收口)
- **目标** 在一个安全 repo(如 `hermus-agent`)跑一条完整 gated E2E,全程在对话 UI 可见。
- **交付** Claude 澄清到 95% → Codex 编码 → Gemini 硬门槛 → (remote-write 仍关的)Draft-PR gate;记忆被更新;evidence + 截图入 `evidence/`;一段短 soak。
- **L1 验收** 一条真实 gated E2E 有完整 evidence(planner=claude / coder=codex / validator=gemini 判词 / PR 被安全闸挡或在批准后才 draft);通用闸绿。
- **退出 → done** v1 产品成立:简单、会反问、借力本地订阅、有独立裁判、有记忆。

---

## §4 · CROSS-CUTTING(每会话退出必跑)
- `pnpm typecheck`(0)· `pnpm lint`(0)· `pnpm test`(0 fail)。
- 无付费 API 守卫测试绿(GR#1)。
- 事件一致性:overview 能从事件重建(GR#5)。
- 不引入 lockfile 漂移。

## §5 · SESSION PROTOCOL(精简版)
- **BOOT**:`git status` 必须 clean;读 §0 STATE 三行(phase/substep/next_action);若 `open_holds>0` 本会话只处理 holds。
- **WORK**:只推进 §0 标注的 `current_phase`;小步,每过一个 L1 criterion 立刻跑对应 test。
- **EXIT**:跑该 phase 的 L1 + §4;更新 §0(≤25 行);在 `docs/SESSION_LOG_v3.md` 追加一条(倒序);commit message 带 `[P<n>] + 验收状态`。

## §6 · PARKED(明确不在本计划范围)
旧 v2.1/v2.2 宏大蓝图的孤儿包(见 `docs/PARKED.md`)默认**不接入、不扩展**。`moves`/`agent-mesh` 可能在 **P6** 经 ADR 后被复活用于 DAG;其余(sentinel/chaos/supervisor/interrupt-bus/push-policy/approval-v2/cli-robust/security)保持停泊,直到有明确 phase 需要。事件溯源:现实是 SQLite `events` 表为 SoT(非 ADR-0010 的 NDJSON ledger);本计划沿用 SQLite,不追 NDJSON 迁移。
