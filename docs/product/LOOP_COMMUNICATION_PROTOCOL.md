# Loop Communication Protocol — 五卡用户通信协议（v6-P1）

> SoT: [WORKBOOK_v6.md](../../WORKBOOK_v6.md) §2 GR#11。
> 普通用户在座舱主流程里**只看到五种卡片**。每个 mission overview 在任意时刻
> 派生出**恰好一张**卡（`OperatorMissionView.card`，由
> `packages/daemon/src/loop-cards.ts` 的纯函数 `deriveLoopCard` 从既有 view
> 字段派生）。原始机器码只存在于 data 层；可见文案平静、双语；每张卡都回答
> "下一步是什么"。

## 0. 三条铁律 · Three rules

1. **机器码留在 data 层 · Machine codes stay in the data layer.**
   HOLD-* / 409 / validator code / stage token 只出现在每张卡的 `machine`
   子对象（自动化与调试用），**永不**出现在用户可见文案字段里。
2. **可见文案平静、双语 · Visible text is calm and bilingual.**
   所有面向用户的字符串复用 `user-state.ts` 的人话词汇（中 · 英），不出现
   error/stack/code 式措辞；安全闸的暂停被解释为保护，不是故障。
3. **每张卡回答"下一步是什么" · Every card answers "what happens next".**
   五种卡都带非空的 `next_step` 字段；用户不读日志也知道现在该等、该答、
   该批，还是该去 GitHub 点 merge。

## 1. userState → 卡类型映射（10 态 → 5 卡）

| userState（10 态，data 层） | 卡类型 |
|---|---|
| `understanding` / `needs_more_context` | **UnderstandingCard** |
| `planning` / `waiting_for_approval`（roadmap 审批，即 stage ≠ `pr_ready`） | **PlanCard** |
| `ready_to_execute` / `executing` / `testing` / `evaluating` | **ProgressCard** |
| `blocked` | **BlockerCard** |
| `completed` / pr-ready（`waiting_for_approval` 且 stage = `pr_ready`） | **PrReadyCard** |

映射是全函数：任何 userState 都恰好落入一种卡（单测矩阵
`packages/daemon/src/loop-cards.test.ts` 钉死）。

## 2. 通用信封 · Common envelope

每张卡都携带：

```ts
type: 'understanding' | 'plan' | 'progress' | 'blocker' | 'pr_ready'
title: string        // 双语、平静（复用 user-state label）
next_step: string    // 非空；铁律 3
machine: {           // data 层；自动化/调试专用，UI 主文案不渲染
  user_state: string //   原始 10 态
  stage: string      //   原始 OperatorMissionStage
  hold_code: string | null      // 原始 HOLD-* / 闸码（仅 blocker 相关时非空）
  pr_gate_code: string | null   // 原始 PR 闸码
}
```

## 3. 卡片字段契约 · Card field contracts (EXACT)

### UnderstandingCard

| 字段 | 类型 | 来源（既有 view 字段） |
|---|---|---|
| `user_goal` | string | session prompt / mission title |
| `interpreted_goal` | string | view `summary` |
| `out_of_scope` | string[] | 已确认的范围排除；未确认时为空数组（不臆造） |
| `confidence` | number (0–100) | view `confidence`（澄清门当前置信度） |
| `questions[]` | `{ id, question }[]` | `understanding.questions`（待答澄清问题） |
| `default_assumptions[]` | string[] | 各问题的推荐选项："不回答时将采用 X" |

### PlanCard

| 字段 | 类型 | 来源 |
|---|---|---|
| `objective` | string | session prompt / view `summary` |
| `phases` | string[] | `projectPulse.progress` 的步骤标签 |
| `acceptance_criteria` | string[] | 已知验收检查（`loopSummary.testsRan`）；为空时给诚实占位 |
| `risk_level` | `'low' \| 'medium' \| 'high'` | 远程写关=low；远程写开=medium（确定性派生） |
| `estimated_calls` | number | per-mission headless 预算上限（默认 15，GR#1 计量） |
| `requires_approval` | boolean | 恒为 `true`：方案获批前不执行；merge 永远由人执行 |

### ProgressCard

| 字段 | 类型 | 来源 |
|---|---|---|
| `current_phase` | string | userState 双语 label |
| `current_action` | string | `loopSummary.whyStoppedOrContinuing` |
| `evidence_links` | string[] | `projectPulse.evidence[].path` |
| `tests_run` | string[] | `loopSummary.testsRan` |
| `next_step` | string | view `nextAction`（人话化） |

### BlockerCard

| 字段 | 类型 | 来源 |
|---|---|---|
| `hold_code` | string \| null | **data 层** — 实现中位于 `machine.hold_code`（铁律 1：码不进可见字段） |
| `human_explanation` | string | `userState.explanation`（`explainBlockingCode` 人话，零原始码） |
| `why_it_matters` | string | 按码类别的确定性双语解释（预算/返工/安全闸/默认） |
| `recovery_actions[]` | string[] | 按码类别的双语恢复动作（零原始码） |
| `recommended_action` | string | `recovery_actions[0]` |

### PrReadyCard

| 字段 | 类型 | 来源 |
|---|---|---|
| `pr_url` | string \| null | mission `githubPrUrl`（无真实 PR 时诚实为 null） |
| `summary` | string | view `summary` |
| `files_changed` | string[] | `loopSummary.whatChanged` |
| `tests` | string[] | `loopSummary.testsRan` |
| `validator_verdict` | string \| null | `loopSummary.validatorSaid`（无判词时 null，绝不臆造 pass） |
| `risk` | `'low' \| 'medium' \| 'high'` | 同 PlanCard 的确定性派生 |
| `merge_policy` | string | 固定文案：只有人能 merge；系统永不自动合并（GR#10） |
| `rework_button` | `{ enabled: boolean; label: string }` | 恒可用：不满意可让 AI 返工 |

## 4. 不变量（单测钉死） · Invariants pinned by tests

- 10 个 userState 全矩阵 → 恰好一种卡类型（含 `waiting_for_approval` 的
  roadmap/pr_ready 分叉）。
- BlockerCard 的全部可见文案字段（`human_explanation` / `why_it_matters` /
  `recovery_actions` / `recommended_action`）不含任何原始码（`HOLD-*` 等）；
  原始码只在 `machine` 子对象。
- 每张卡 `next_step` 非空。
- PrReadyCard 的 `merge_policy` 永远声明 human-merge-only；`pr_url` 与
  `validator_verdict` 缺失时为 null（证据诚实，GR#7）。

测试：`packages/daemon/src/loop-cards.test.ts`。
类型镜像：`apps/dashboard/src/api.ts`（`ApiLoopCard`）。
