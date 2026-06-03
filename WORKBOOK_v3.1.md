# WORKBOOK v3.1 · Real-Loop Hardening & Ship

> **续 [WORKBOOK_v3.md](WORKBOOK_v3.md)。** P0–P7 已并入 `origin/main @ a7d400f`(已核实在远端)。
> 本轮**不再造新功能**,只做一件事:把上一轮独立验证出的**真实缺口**补上,把文档对齐现实,
> 并且**按 PR 流程真正推上 GitHub**(上一轮是单提交直推 main、且关键能力只在 mock 下验证过)。
>
> **验证依据(2026-06-03 证据复审,file:line 落地):** 8 个 phase 里 6 个扎实做实(no-paid-API 守卫、
> 95% 门槛、引擎分工、对话 UI、记忆接线、混合 DAG 都真实且有测试)。**两个真实缺口:**
> ① **P4** Gemini 硬门槛代码强制且 fail-closed,但只对**手插的 mock verdict** 验证过——
>    `git`-提交的 real-smoke 里 Gemini 要么 `GEMINI_NOT_CONFIGURED`(FAIL),要么"未提供未运行";
>    **真 Gemini 从没对一个真 diff 出过 PASS/FAIL**。
> ② **P7** E2E 的 planner(claude)/coder(codex,真 token)/worktree diff 都真,但跑在 `/tmp` 一次性
>    repo、且没有真 Gemini 判词。README 因此**夸大**了 "external Gemini validator … all passed"。

---

## §0 · STATE (机器可读 · ≤25 行 · 不许写叙事)

```yaml
schema_version: 3
parent_workbook: WORKBOOK_v3.md
cycle: real-loop-hardening
current_phase: H1          # H1..H4,见 §3
current_substep: not-started
last_session_id: s_0000
open_holds: 0
blocked_on: none
# next_action 硬上限 2 行:
next_action: |
  启动 H1:把 AEDEV_GEMINI_API_KEY 注进 daemon 进程(仅 validator;coder/planner 仍剥离),
  让真 Gemini 对真 diff 出一次 FAIL + 一次 PASS,判词落 evidence/,然后 [H1] 一个 commit + 一个 PR 推上 GitHub。
```

---

## §1 · 本轮目标(一句话)

让那个隔离的 **Gemini 裁判真的跑一次**(操作员两次想看、却始终没见到的事),在**真实注册 repo**(非 `/tmp`)上跑通完整闭环,把 **README/文档对齐现实**,并且**每个 phase 独立 commit + 独立 PR + 真推上 GitHub**。

---

## §2 · GROUND RULES(本轮新增/强化;其余继承 v3 §2)

> 继承 [WORKBOOK_v3.md §2](WORKBOOK_v3.md) 全部 8 条(不烧付费 API、95% 门槛、远程写默认关、
> validator 只看 evidence、先 event 后 view、证据诚实、§0 保持小)。本轮另加 4 条硬规则:

- **G1 · 每 phase 一 commit 一 PR,真推远端。** 一个 phase = 一个 commit(message 带 `[H<n>]`)+ 推到
  feature 分支 + 开/更新一个 PR。退出条件**未达成**,除非 `git branch -r --contains <sha>` 证明该提交
  已在 `origin`。(直接修上一轮"工作没 push" + "8 个 phase 挤进 1 个 `[P7]` 提交、违反 GR#6" 两个毛病。)
- **G2 · 没有真 Gemini 判词,不许说 "validator passed"。** 任何"通过验证"的声称,必须由 `evidence/` 里
  一份**真 Gemini 判词产物**(PASS 与 FAIL 各一份,含 model 名 `gemini-2.5-pro` + verdict + 理由)背书。
  手插的 `insertValidatorResult` fixture **不算**证据。
- **G3 · key 只给 validator。** `AEDEV_GEMINI_API_KEY` 注进 daemon 进程供 validator 用;coder/planner
  子进程 env 仍被 `buildLocalCliEnv`/`buildPlannerCoderEnv` 剥离(守 v3 GR#1)。
- **G4 · PR 流程,不直推 main。** 本轮所有改动经 feature 分支 + PR 合入(纠正 a7d400f 直推 main)。

---

## §3 · PHASES(H1–H4)

> 每个 phase:**目标 / 交付(含路径)/ L1 验收 / 退出(commit + push + PR)**。
> 通用闸(每个 phase 退出都要过):`pnpm typecheck` 0 · `pnpm lint` 0 · `pnpm test` 0 fail · no-paid-API 守卫测试绿。

### H1 — 真 Gemini 裁判跑通(本轮核心,close P4/P7 最大缺口)
- **目标** 让真 Gemini 对真 diff 出判决——一次 FAIL、一次 PASS,可见、可复核。
- **交付**
  - 把 `AEDEV_GEMINI_API_KEY` 注进**常驻 daemon** 进程 env(`scripts/dev-operator-cockpit.ts` 已注入;
    还要确保 launchd / `packages/daemon` 启动路径也拿到),且**不**进 coder/planner env。
  - 在一个注册的安全 repo 上跑两条真实 mission:
    - **坏/不完整 diff** → 真 Gemini verdict `FAIL` → `/create-pr` 被 `GEMINI_NOT_PASS` 挡 + 对话里出现判词气泡;
    - **达标 diff** → 真 Gemini verdict `PASS` → PR 被 offer(仍受 remote-write 闸)。
  - 真 Gemini 判词产物落 `evidence/`(`validator-gemini.md`:model + verdict + 理由 + 它看到的 evidence 清单)。
  - 测试:① 一个 opt-in **live Gemini smoke**(gated on key,默认 skip 但标注);② 一份**录制的真实 Gemini 响应** fixture 单测(证明对真实形状响应解析正确,替代手插 verdict)。
- **L1 验收** `evidence/` 里有真 Gemini **PASS 与 FAIL 各一**(带理由);keyed run 的 `validatorStatus` 不再 `not_configured`;新增测试绿;通用闸绿。
- **退出 → H2** `[H1]` 单 commit + push + PR;`git branch -r --contains` 已证在 origin。

### H2 — 真 E2E on 注册 repo(不再 /tmp)
- **目标** 完整闭环跑在真实注册 repo(如 `hermus-agent`),全程在对话 UI 可见。
- **交付** Claude 澄清≥95% → Codex 在 repo-bound worktree 编码 → **真 Gemini 硬门槛** → draft-PR 闸
  (remote-write 关 → blocked;若操作员显式批准 → 真 draft PR)。`evidence/` 记录 `planner=claude-cli` /
  `coder=codex-cli`(真 token)/ `validator=gemini` 真判词 / `repo=hermus-agent`(非 `/tmp`)。
- **L1 验收** `hermus-agent` 上的 real-smoke 报告带**真 Gemini 判词**;`scripts/operator-cockpit-real-smoke.ts`
  在严格模式(`AEDEV_COCKPIT_REAL_SMOKE_REQUIRE_GEMINI`)下通过;通用闸绿。
- **退出 → H3** `[H2]` 单 commit + push + PR。

### H3 — README + 文档对齐现实(close 夸大 + 旧叙事)
- **目标** 消除"已通过验证"的夸大,清掉与现实矛盾的旧 Python/Agent-Mesh 叙事。
- **交付**
  - 改 README 顶部 "P0-P7 complete … external Gemini … all passed" → **据实**:Gemini 门槛现已真实跑通,
    链接 H1 的 `evidence/` 判词;删除"merged/passed"式未经证据的措辞。
  - 把 README 下 2/3 的 **Python dual-kernel "current state"** 段、`v2.2.0-rc2` 的
    **"Agent Mesh / RoadmapAgent / Sentinel … production grade"** 段,移入明确标注的 **history/archive** 区或删除,
    与 [docs/PARKED.md](docs/PARKED.md)(说这些是孤儿)对齐;conversational-cockpit 段成为**唯一**的产品描述。
- **L1 验收** README 与 `docs/PARKED.md` **零矛盾**;无任何"current"的 Python dual-kernel 描述;`grep` 确认无 Python 路径被当作现状。
- **退出 → H4** `[H3]` 单 commit + push + PR。

### H4 — 小修 + 流程收口
- **目标** 清理上一轮遗留的小问题,确认 PR 流程闭环。
- **交付**
  - 删 `packages/daemon/src/routes/operator.ts:~1303` 那句过时 `plan_scale` 注释("taskDag is not yet executed per-task" —— 现已被 `runDagNodes` 执行,注释在说谎)。
  - 记忆也注入 **planner brainstorm**(`operator.ts:runPlannerBrainstorm`),不只 coder。
  - `compileTier2LessonsToTier1` 按**语义 key dedup**(治 `.aedev/cowork-memory.md` 那 9 条重复 "缺回归测试" 噪声)。
- **L1 验收** 绿套件(676+);`.aedev/cowork-memory.md` 无重复噪声;planner 上下文含记忆;通用闸绿。
- **退出 → done** `[H4]` 单 commit + push + PR。

---

## §4 · 本轮完成定义(DONE)
- **H1–H4 四个 PR 全部经 review 合入 `origin/main`**(非直推);每个是独立 commit。
- `evidence/` 里有**真 Gemini PASS 与 FAIL** 判词产物(G2)。
- README 与 `docs/PARKED.md` 无矛盾;无"current"Python dual-kernel 叙事。
- 在 `origin/main` 最新 HEAD 上可复跑 `pnpm test` 全绿(676+ passed)、`pnpm typecheck` 0、no-paid-API 守卫绿。
- §0 STATE 更新为 `current_phase: done`;一句话 next_action 指向可选的下一轮(如复活 agent-mesh 走真·多 agent fleet,对标 7×24 团队)。
