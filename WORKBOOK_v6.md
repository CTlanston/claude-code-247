# WORKBOOK v6 · Ordinary-User Loop OS（普通用户闭环操作系统）

> **本文件是当前唯一事实源 (SoT)。** 取代 `WORKBOOK_v4.md`（v1.5 P0–P4 已完成；该文件原地保留并加
> SUPERSEDED 头）。立项依据与差距评估见
> [docs/assessments/ordinary-user-loop-gap-assessment.md](docs/assessments/ordinary-user-loop-gap-assessment.md)
> （操作员已批准其 §4 阶段计划）。叙事一律进 `docs/SESSION_LOG_v3.md`（倒序）；本文件 §0 保持机器可读小状态块。
>
> **产品论点（一句话）：** 在已验证的单操作员 24/7 待命团队之上，把整个闭环翻译成**普通用户只看
> 五种卡片**（understanding / plan / progress / blocker / pr_ready）就能跟完"一个需求 → 一个真
> Draft PR"的产品；merge 永远由人执行。

---

## §0 · STATE (机器可读 · 硬上限 25 行 · 不许写叙事)

```yaml
schema_version: 6
product: ordinary-user-loop-os
version_target: loop-os-v1
current_phase: V6-P3          # V6-P0..P6，见 §3；P2 卡片化座舱随本 PR 落地
current_substep: p3_real_proof_closeout_pending
last_session_id: s_v6_0002
open_holds: 0
blocked_on: none
test_baseline: 864            # main 基线，0 fail；本周期任何回归即闸红
merge_policy: human_only      # 系统永不 merge；auto-merge 本周期禁用
# next_action 硬上限 2 行：
next_action: |
  V6-P2 已交付：LoopCard 五卡主表面 + 浏览器 E2E 每步断言卡型与 next_step（证据入库）。
  下一步 V6-P3：真实证明收口——真 Draft PR、库内真实 Gemini 判词、fail-closed 回归。
```

---

## §1 · 与 v4/v5 的关系（一屏讲清）

- **v4（standby-team-v1.5）已完成并被本文件取代：** credit 护栏、跨引擎 review、watchdog、
  per-repo 白名单双闸全部在 main；其 P4 的"真实 Draft PR 出口"残留收口并入 V6-P3。
- **v5（BYO fleet）未转正：** `proposals/WORKBOOK_v5_PROPOSAL.md` 仍是提案；其 fleet 协议 /
  worker / soak 装置已以模拟执行器形态合入 main（5/5 PASS）。fleet **规模化不在 v6 范围**，
  但 v5 的 token 隔离等硬规则全额继承（§2）。
- **v6 的新增量：** 普通用户通信协议（5 卡）、卡片化座舱、真实证明收口、最小安全递归 planner、
  soak 运营化、普通用户验收。优先级全程：**安全证据 > 普通用户 UX > 自动化 > fleet 规模 > 打磨**。

---

## §2 · GROUND RULES（改本节须操作员书面批准）

**继承 v4 全部 8 条 + 修订**（构建不烧付费 API / 95% 理解门槛 / 远程写默认关 + per-repo 白名单双闸 /
validator 只看 evidence / 先 event 后 view / phase 由验收闸控 / 证据诚实（real·simulated·unproven
显式分类）/ §0 永远小 / GR#1 credit 计量（headless 调用记 `cost.headless_call`，超预算 →
`HOLD-BUDGET`，绝不静默 API fallback）/ GR#9 review ≠ 裁判（Claude review 是过程内质检，Gemini
是唯一终局 evidence-only 裁判））。

**继承 v5 提案的不可动摇条款：**
- Token 永不共享/上云/代理；每 worker 用自己的订阅 CLI；协调器永不触碰任何人的凭证。
- 每 worker 各自的 credit 护栏；BYO 自报证据默认不可信，GitHub CI-on-PR 是信任锚。

**v6 新增硬规则：**
- **GR#10（human merge only）：** **系统永不 merge；auto-merge 本周期禁用。** Draft PR 是机器
  出口的终点；merge 按钮只属于人。任何与此冲突的旧文档/旧 PR（如 #28-F4）一律不合入。
- **GR#11（五卡心智模型）：** 普通用户在座舱里**只看到五种卡片**：`understanding` / `plan` /
  `progress` / `blocker` / `pr_ready`。原始机器码（HOLD-* / 409 / validator code）只存在于
  data 层（卡片的 `machine` 子对象与事件流），永不出现在用户可见文案里；每张卡都必须回答
  "下一步是什么"。契约：[docs/product/LOOP_COMMUNICATION_PROTOCOL.md](docs/product/LOOP_COMMUNICATION_PROTOCOL.md)。

---

## §3 · PHASES（V6-P0 – V6-P6，对齐评估 §4）

> 每个 phase：**目标 / 交付（含路径）/ L1 验收（可跑的检查）/ 退出条件**。通用闸见 §4。

### V6-P0 — 收口对齐（文档与现实对齐；v6 成为 SoT）
- **目标** 关闭 PR #27/#28（superseded，残留并入 V6-P0/P3）；README 全文与 TS 现实对齐
  （#27-H3 残留：删除把已删 Python 双内核/Agent-Mesh 当 production 描述的下半身）；v6 成为唯一 SoT。
- **交付** 本文件；`WORKBOOK_v4.md` 顶部 SUPERSEDED 头；`CLAUDE.md` 横幅 v4→v6（仅横幅块）；
  README 下半身重写为简短准确的 TS 架构摘要并指向本文件。#27/#28 的 close 由操作员执行或授权执行。
- **L1 验收** 根目录 `grep -ril "source of truth" *.md` 的现行指向只命中本文件；README 无
  "Python kernel as production / auto-merge" 残留；通用闸绿。
- **退出 → V6-P1** 单一 SoT，文档对得上树。文档部分随本 PR 落地；#27/#28 close 为操作员动作。

### V6-P1 — 通信协议（5 卡字段契约 + daemon 卡片派生）
- **目标** 把 userState（10 态）正式升级为普通用户可消费的 5 卡协议；机器码保留在 data 层。
- **交付** `docs/product/LOOP_COMMUNICATION_PROTOCOL.md`（5 卡精确字段表）；
  `packages/daemon/src/loop-cards.ts`（纯函数 `deriveLoopCard`，从既有 operator view 字段派生
  **恰好一张**卡）；`OperatorMissionView.card` 接线 + `apps/dashboard/src/api.ts` 类型镜像。
- **L1 验收** 单测矩阵：10 个 userState 每个映射到恰好一种卡；BlockerCard 可见文案零原始码
  （复用 user-state 人话）；机器码只在 `machine` 子对象；通用闸绿、零回归（基线 818）。
- **退出 → V6-P2** 任何 mission overview 都自带一张可直接渲染的卡。随本 PR 落地。

### V6-P2 — 卡片化座舱（UI 只渲染 5 卡）
- **目标** 座舱主流程只渲染 5 卡；普通用户不读日志即知"现在在哪、下一步是什么"。
- **交付** `apps/dashboard` 卡片组件 + 主流程改造；浏览器 E2E（真 chromium）走完
  understanding→plan→progress→pr_ready/blocker 并断言每屏可见 next_step。
- **L1 验收** 浏览器 E2E 绿且 evidence 入库（截图 + 断言报告）；旧面板不再是默认主流程；通用闸绿。
- **退出 → V6-P3** "不读日志即知下一步"有浏览器级证据。

### V6-P3 — 真实证明收口（评估 §2 的 #12/#13 + #27-H2/#28-F0 吸收）
- **目标** 把"Real but 未入库 / Unproven"清零：真实 Draft PR、仓库内真实 Gemini 判词 artifact。
- **交付** evidence 目录契约（操作员 06-10 真链路证据入库路径）；真实 Gemini 判词 artifact 入
  `evidence/`；注册 repo 真 E2E（#27-H2）；操作员缺席 fail-closed 测试（#28-F0 吸收）；
  操作员按 `docs/operations/P4-first-real-draft-pr.md` 产出真实 Draft PR URL。
- **L1 验收** 真实 Draft PR URL 可访问且为 draft；真实 Gemini 判词文件在库且可追溯到 run；
  操作员缺席时全链 fail-closed（回归测试）；通用闸绿。
- **退出 → V6-P4** Real/Simulated/Unproven 表中 #12/#13 行翻为 Real（有库内证据路径）。

### V6-P4 — 递归 planner（最小安全自规划）
- **目标** 仓库驻留的自规划模块：读 SoT §0 → 提议下一步 → 在硬护栏内推进一个 cycle。
- **交付** planner 模块 + cycle ledger（事件可重建）；**拒绝条件**：脏工作树 / 红测试 / 超预算 /
  SoT 歧义（§0 不可解析或与现实冲突）→ 拒绝并 HOLD；产出**止于 Draft PR**（GR#10）。
- **L1 验收** 四个拒绝条件各有单测；一个完整 cycle 的 ledger 可从事件重建（GR#5）；通用闸绿。
- **退出 → V6-P5** planner 能安全地自己走一个 cycle 而不越任何闸。
> ⚠️ 架构边界：递归 planner 不得绕过审批/远程写双闸；其 headless 调用计入 P1 预算。

### V6-P5 — soak 运营化（一周真实 soak 的装置补完）
- **目标** 评估 #19 收口：launchd 常驻、崩溃恢复、挂起状态契约、ntfy 通知链。
- **交付** launchd 配置 + 恢复命令（`docs/operations/`）；`soak-pending` 状态 artifact 契约；
  hold 变化 → ntfy；soak 报告模板（real/simulated 显式分类）。
- **L1 验收** kill -9 后恢复命令一步回到待命；无任务整夜 credit 计数为零（重放既有 watchdog 测试）；
  soak-pending artifact 可从事件重建；通用闸绿。
- **退出 → V6-P6** 一周真实 soak 可以无人值守地开始并自证。

### V6-P6 — 普通用户验收（终评分）
- **目标** 用普通用户（非开发者）视角验收整个闭环。
- **交付** 可用性 E2E 脚本（5 卡流程 + 中断/blocker/返工路径）；对照评估 §1 的能力评分表逐项重评；
  终评分报告入 `docs/assessments/`（real/simulated/unproven 显式分类）。
- **L1 验收** 可用性 E2E 绿且 evidence 入库；终评分每项分数附库内证据路径（GR#7）；通用闸绿。
- **退出 → done** v6 成立：普通用户只靠 5 卡跟完一个真需求到真 Draft PR，merge 由人点。

---

## §4 · CROSS-CUTTING（每会话退出必跑）
- `pnpm typecheck`（0 err）· `pnpm lint`（0 err）·
  `GIT_CONFIG_GLOBAL=/tmp/test-gitconfig pnpm test`（0 fail；基线 818，零回归）。
- 无付费 API 守卫测试绿（GR#1）；预算守卫测试绿。
- 证据诚实（GR#7）：所有报告 real / simulated / unproven 显式分类，分数附库内证据路径。
- 事件一致性：overview / cost / 卡片派生输入能从事件重建（GR#5）。
- 不引入 lockfile 漂移；不碰 `.github/**`、secrets、`AGENTS.md`。

## §5 · SESSION PROTOCOL（镜像 v4 §5）
- **BOOT**：`git status` clean；读本文件 §0 三行；`open_holds>0` 则本会话只处理 holds。
- **WORK**：只推进 `current_phase`；小步，每过一个 L1 criterion 立刻跑对应 test。
- **EXIT**：跑该 phase L1 + §4；更新 §0（≤25 行）；`docs/SESSION_LOG_v3.md` 追加一条（倒序）；
  commit message 带 `[v6-p<n>] + 验收状态`。

## §6 · PARKED（明确不在 v6 范围）
- **auto-merge / 任何形式的系统 merge**：GR#10 硬禁；旧 PR #28-F4 路线不复活。
- **fleet 规模化（5 真人 BYO worker / 多机）**：v5 提案停泊；v6 只继承其硬规则。
- **Antigravity CLI 迁移 / OpenAI 双 validator / 引擎角色翻转**：维持 v4 §6 结论。
- 其余孤儿包维持 `docs/PARKED.md` 停泊；`archive/` 永不 import。
