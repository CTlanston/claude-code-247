# E2E Real-Loop — Plan & Optimized Prompt

> **Authoring pass (operator-directed, Cowork architect).** Source of truth for
> the next phase: connect and PROVE the core value loop once, end-to-end, on a
> real target repo. This file is the clobber-proof canonical copy; the same
> Stage blocks + §0 next_action are also inserted into `EXECUTION_WORKBOOK.md`.
>
> **Operator note:** an automated hold-recheck loop is rewriting
> `EXECUTION_WORKBOOK.md` ~every 30 min (see §9 s_0025–s_0027). Pause it while
> applying workbook edits, or treat THIS file as canonical and re-apply.

---

## 0 · Evidence-based assessment (verified this pass, repo-level)

The prior "muscle not connected" verdict is **mostly right but imprecise**. Sharper truth:

| Capability | Status | Evidence (repo) |
|---|---|---|
| Coder path into pipeline | **WIRED, runs mock** | `mission-runner.ts` routes `coder` → `RunnerManager` (L118/139); default `mode: mock` (L308). |
| Real coder engines | **CODE EXISTS, unused live** | `runner/{claude-adapter,codex-adapter,cli-runner,docker-runner}.ts`; `RunnerManager.getRunner` maps `claude-cli/docker/...`. |
| Dual-family validation | **CODE EXISTS, never runs** | real `openai-validator.ts` + `gemini-validator.ts`; `merge-policy.ts`+`family-enforce.ts` enforce 2 independent families. BUT `mission-runner` `validators` defaults to `[]` (L186) → `validator_results=0`. |
| Token / `model_usage` accounting | **MISSING wiring** | `cost-meter` (CostRoller/CostTagger) exists, but no usage event in `event-log`, no record in mission seam → `model_usage=0`. |
| Anti-slop evidence gate | **REAL** | `evidence-prompt.ts` requires `plan.md`/`done-report.md`/`risk-report.md`, returns `inconclusive` on incomplete; `hasScreenshotEvidence` rejects stubs. |
| Live draft PR (remote write) | **REAL (new, P3)** | `remote-write-gh.ts` `GhGitRemoteWriter`+`GhDraftPrCreator`, draft-only, idempotent, gated by `allow_remote_writes`+forbidden-path. |
| Roles (architect/builder/qa/...) | **TEMPLATE/STUB** | self-describe "template-based MVP", "only stubs and types", "ADR stub", "screenshot stub". |
| Docker worker isolation (ADR-0004) | **CODE EXISTS, unverified live** | `docker-runner.ts` present; no `claude-in-docker` combined mode yet. |
| Secrets | **grant types only** | `packages/secrets` = `SecretGrant` TTL types; key resolution is via operator's secrets-mcp at runtime. |

**Bottom line:** this is a *connect-and-prove* job, not a *build-from-scratch* job. The
real gap is the config/integration seam: live missions run `mock`, validators default `[]`,
`model_usage` is never persisted — so the loop has never produced real tokens + real
dual-family verdicts + a real draft PR even once.

**Cannot verify from this sandbox:** runtime DB numbers (`~/.aedev/state.db`) — `model_usage=0`,
`validator_results=0`, `runs`, dual-DB split, `launchd` exit 254. These rely on the prior
runtime audit; re-confirm on the Mac if needed.

**Decisions locked with operator (this pass):** north star = wire the real E2E loop first;
coder = subscription Claude CLI; isolation = Docker now (one-step dockerize, mount auth);
target = `CTlanston/multi-agent-brainstorm`; first task = intake/roadmap proposal + operator
confirm, med-risk cap (multi-file, med-risk via ApprovalGateway); dual-family = real OpenAI +
Gemini via secrets; safety = temporarily open `allow_remote_writes` for that repo only,
draft-only, never merge; blockers = built-in Stage 0; prompt shape = workbook §3 + §0; detail
Stage 1 + Stage 2 (clarification gate); pre-research deferred to §0 backlog.

---

## 1 · KICKOFF SESSION PROMPT  (paste this to the implementing Claude Code session)

```
你是在 `claude-code-247` 仓库内、遵守 EXECUTION_WORKBOOK 协议运行的 Claude Code 会话。
铁律:证据优先 —— 没有运行时证据，绝不报告 "done / works"。基调:这套系统的核心价值闭环
从未在真实 LLM 工作上端到端跑通过一次；你的任务是把它接通并**证明一次**。

BOOT(先做，§2.1):git status 必须 clean；pnpm install；pnpm typecheck；pnpm test；
读 §0 STATE；读 §9 顶部条目；读 §3 新增的 Stage E2E-0 / E2E-1 / E2E-2。输出一行 boot 摘要。

已核实的精确缺口(不要重新发现，直接接线):
 - coder 路径已接进 RunnerManager，但默认 mode: mock(mission-runner.ts L118/139/308)。
 - mission-runner 的 validators 默认是 [](L186) → 这才是 validator_results=0 的真因。
 - model_usage 在 mission seam 完全没记;cost-meter 有 CostRoller/CostTagger 但无 usage 事件。
 - 真 adapters / 真 OpenAI+Gemini validators / docker-runner / remote-write-gh / anti-slop
   证据闸都已有代码 —— 是"接线+证明"，不是"从零造"。

OPEN HOLDS(必须先清；§3.99 HOLD-only):HOLD-LOCAL-DEPS-RESTORE、HOLD-P2-LIVE-SMOKE-GATE-AUTH。
在 holds 清零前不得改任何产品代码。先做 Stage E2E-0。

目标:按序执行 §3 的 Stage E2E-0 → E2E-1 → E2E-2。
 - 一次 commit 只引用一个 stage id,前缀 [E2E-x] + accept x/total(GR#2)。
 - 架构改动先写 ADR(GR#3):E2E-1 前写 ADR-0019，E2E-2 前写 ADR-0020。
 - 任何副作用带 idempotency_key(GR#5);先写 event 再更新 view(GR#6)。
 - claude CLI 子进程只能在 Docker worker 容器内,绝不在 daemon(GR#8)。

E2E-1 真实目标:repo `https://github.com/CTlanston/multi-agent-brainstorm.git`
(只读保护副本 `/Users/lanston/Desktop/MCPs/muti-agent comm` 仅供参考)。
 - coder = 订阅 Claude CLI **跑在 Docker 容器内**:扩展 DockerRunner，把 claude 订阅 auth
   以**只读**挂进容器,容器内 `claude --print --output-format json` 真写代码。
 - validators = 真 OpenAI + 真 Gemini(独立家族);key 经 SecretGrant + 操作员 secrets-mcp 解析,
   **不写死 env**。coderFamily=anthropic 时,OpenAI(openai)+Gemini(google) 才算两家族。
 - model_usage 落库:解析 claude JSON 的 usage → CostRoller.record → 新事件
   `model.usage.recorded` + model_usage view(GR#4 加表/列双向兼容)。
 - draft PR:复用 remote-write-gh,draft-only、永不 merge、title-hash 幂等,经 DraftPrGate。
 - 首任务:roadmap-agent/intake 扫该 repo 产候选 → 操作员确认一个(med-risk 上限)。
 - 安全:仅对该 repo 临时把 allow_remote_writes 置 true,run 后**复位 false**;forbidden_paths 强制。

DONE 的定义(E2E-1 L1,全绿才算):一次真实 run 满足 runs≥1、validator_results≥2(家族
∈{openai,google} 各一)、model_usage≥1 且 in/out tokens 非零、一条 draft PR(URL 存在、
mergedAt=null);evidence 含真实 plan.md/done-report.md/risk-report.md(非桩);指定测试 + typecheck 绿。
若容器内 claude 无法用订阅鉴权 → 立即 HOLD-CLAUDE-AUTH-IN-DOCKER,**不得静默改用付费 API**
(CLAUDE.md no-silent-API-fallback)。

每个 stage 退出:跑 §3 acceptance → 输出粘到 §6 evidence → 更新 §0(current_stage/next_action/holds)
→ §9 追加 session 条目(新的写最上)→ 若改了文档则写 §10 changelog。

ANTI-SLOP:validators 只看 evidence(不看 coder 上下文);要求两个独立家族;拒绝桩报告;
证据不全时判 inconclusive。绝不伪造绿。
```

---

## 2 · §3 Stage blocks  (insert into `EXECUTION_WORKBOOK.md` before `### Stage 3.99`)

### Stage E2E-0 — Unblock & Baseline Green (前置, HOLD-clearing)

- **目标** 清掉当前 2 个 open hold,把 baseline gate 跑绿,让真实闭环可启动。属 §3.99 HOLD-only 允许的工作。
- **输入** §0 STATE(open_holds=2);§9 s_0025–s_0027 hold recheck;`HOLD-LOCAL-DEPS-RESTORE` / `HOLD-P2-LIVE-SMOKE-GATE-AUTH`。
- **交付**
  - 恢复本地依赖:联网安装或补全 pnpm store(当前缺 `@eslint/config-array@0.21.2` 等 tarball);`eslint/tsc/vitest/tsx` 二进制可用,锁文件无变更。
  - 操作员恢复 `~/.Codex-247/config.yaml`、`~/.Codex-247/repos.yaml`,把 `CTlanston/multi-agent-brainstorm` 注册为 `enabled: true`(`allow_remote_writes` 暂保持 false)。
  - 修复 `gh auth`(有效 CTlanston token,具备对目标 repo 开 draft PR 的权限)。
  - evidence: `evidence/e2e/s0-unblock/`(install 日志、`gh auth status`、test/typecheck/lint 输出)。
- **L1 Acceptance** `pnpm install --frozen-lockfile` PASS;`pnpm typecheck` PASS(0 err);`pnpm lint` PASS;`pnpm test` PASS(0 fail/0 skip);`gh auth status` 有效;目标 repo 在 `repos.yaml` 已 enabled。
- **L2 Review** 独立 reviewer 复跑 `pnpm test`+`pnpm typecheck` 全绿;确认无为过 gate 而 `.skip/.only`。
- **L3 Validate** 操作员确认 `~/.Codex-247/{config.yaml,repos.yaml}` 就位且 `gh` 能访问目标 repo。
- **退出条件 → E2E-1** open_holds=0 且 baseline 全绿;§0 切 `current_stage: E2E-1`。
- **坑** holds 清零前不得改产品代码(GR#2 / §3.99);依赖恢复优先用完整 pnpm store,避免引入 lockfile 变更。

### Stage E2E-1 — Real End-to-End Loop (dockerized Claude coder → dual-family → live draft PR → model_usage)

- **目标** 在 `CTlanston/multi-agent-brainstorm` 上把"真 coder→证据→双家族验证→真 draft PR→token 核算"端到端**真实**跑通一次。coder=订阅 Claude CLI 跑在 Docker 容器内;验证=真 OpenAI+真 Gemini(独立家族);PR=draft-only 绝不 merge;model_usage 真实落库。
- **输入** ADR-0019(本 stage 先写);ADR-0017;目标 repo `https://github.com/CTlanston/multi-agent-brainstorm.git`;只读副本 `/Users/lanston/Desktop/MCPs/muti-agent comm`;已有代码 `runner/{docker-runner,cli-runner,claude-adapter}.ts`、`validators/{openai,gemini}-validator.ts`+`merge-policy`/`family-enforce`、`cost-meter/*`、`daemon/src/remote-write-gh.ts`、`mission-runner.ts` seam。
- **交付**
  - `docs/adr/0019-real-e2e-loop-docker-claude-dual-family.md`。
  - **Docker×Claude 接通**:扩展 `DockerRunner` 在容器内跑订阅 `claude` CLI;claude auth/session 以**只读**挂进容器;`claude --print --output-format json` 真写代码(GR#8:CLI 在 worker 容器内)。
  - **mission-runner 接线**:`buildRunnerConfig`/`providerToRunnerMode` 把 coder route 映射到 claude-in-docker(不再默认 mock);`validators` 默认注入真 `OpenAIValidator`+`GeminiValidator`,key 经 SecretGrant + secrets-mcp,不写死 env。
  - **model_usage 落库**:解析 claude JSON usage(in/out tokens)→ `CostRoller.record`+`CostTagger` 计价 → 新事件 `model.usage.recorded` + `model_usage` view(GR#6 event→view;GR#4 双向兼容)。
  - **dual-family 真验证**:coderFamily=anthropic;`MergePolicy` 要两个独立家族通过 → openai+google;冲突走已有 `HOLD-FAMILY-CONFLICT`。
  - **live draft PR**:复用 `remote-write-gh.ts`,draft-only、title-hash 幂等(GR#5)、`mergedAt=null`、经 `DraftPrGate`。
  - **首任务来源**:roadmap-agent/intake 扫 `multi-agent-brainstorm` 产候选 → 操作员确认一个(med-risk 上限,多文件可,med-risk 经 ApprovalGateway)。
  - evidence: `evidence/e2e/s1/`(真实 plan.md/done-report.md/risk-report.md;真实 diff;两份独立家族 verdict;model_usage 数值;draft PR URL + mergedAt=null 证明;route-decision.json)。
- **安全姿态** 仅对该 repo 临时 `allow_remote_writes=true`(单次,run 后复位 false);draft-only、永不 auto-merge;`forbidden_paths`(`.env*` `secrets/**` `.github/**` `CLAUDE.md` `AGENTS.md`)强制;med/high risk 经 ApprovalGateway。
- **L1 Acceptance**(客观)
  - `pnpm test` PASS,含 `runner/docker-runner.test.ts`(claude-in-docker)、`daemon/remote-write-gh.test.ts`、`validators/merge-policy.test.ts`(双家族独立)、`mission-runner.test.ts`(真 validators 非空)、新 model_usage 测试;`pnpm typecheck` PASS。
  - 一次真实 run:`runs≥1`、`validator_results≥2`(family∈{openai,google} 各一)、`model_usage≥1`(in/out tokens 非零)、一条 draft PR(URL 存在、`mergedAt=null`)。
  - anti-slop:evidence 含真实 `plan.md`/`done-report.md`/`risk-report.md`(非 "Status: Pending" 桩);verdict∈{pass,fail}(非全 inconclusive)。
- **L2 Review** 独立 reviewer(非同家族)读 ADR-0019 + evidence + diff;独立 `git fetch` 复核 PR diff;确认未 merge、未碰 forbidden_paths、两份 verdict 来自独立家族;复算 model_usage 非桩。
- **L3 Validate** 操作员在 cockpit/手机看 route→coder→validators→draft PR 全因果链;确认 draft PR 真存在于 `multi-agent-brainstorm` 且未合并;确认 `allow_remote_writes` 已复位 false。
- **退出条件 → E2E-2** L1/L2/L3 全过,且系统**首次**记录到 `model_usage>0` 且双家族 `validator_results`;§0 记录里程碑。
- **坑** ① claude auth 进容器务必**只读**、run 后不持久化;容器内无法订阅鉴权 → `HOLD-CLAUDE-AUTH-IN-DOCKER`,**不得静默改 API**。② coder=anthropic 时 openai+google 才算两家族。③ draft PR 用 title-hash 幂等,重跑复用不新建。④ 一次 commit 只引用 `[E2E-1]`;先写 ADR-0019。⑤ run 后必须复位 `allow_remote_writes=false`。

### Stage E2E-2 — Structured Clarification Gate (AI-initiated, before coder)

- **目标** coder 动手前,系统**主动**发起结构化多轮澄清(类 AskUserQuestion),把模糊 mission 收敛成**可验证 spec**,作为 PRD/coder 输入,降低返工与 slop。
- **输入** ADR-0020(先写);E2E-1 闭环;现有 `lead-agent.ts`("Clarify mission intent" 任务但无强制 gate)、cockpit Conversation/Brainstorm。
- **交付**
  - `docs/adr/0020-structured-clarification-gate.md`。
  - `ClarificationGate`:intake 后、role-pipeline 前插入;mission 模糊度/风险超阈值 → 生成 N 个结构化问题(选项式,operator 可多选/自填)→ 收集答复 → 落 `clarified-spec.md`(可验证验收点)→ 才放行 coder。
  - 事件 `mission.clarification.{requested,answered,resolved}`;cockpit 渲染问题卡片 + 答复回流入 evidence;阈值策略入 `config/policies.yaml`。
- **L1 Acceptance** 模糊 mission(缺验收点)被拦下并产 ≥1 组结构化问题;答复后产含可验证验收点的 `clarified-spec.md`;清晰 mission 不被无谓拦截(false-gate 率单测覆盖);`pnpm test`+`typecheck` 绿。
- **L2 Review** reviewer 注入 3 模糊+3 清晰 mission,确认召回/精确合理,且澄清答复真实进入 PRD/coder 输入。
- **L3 Validate** 操作员在 cockpit 走一次真实多轮澄清,确认问题质量与 spec 落地。
- **退出条件 → §0 backlog** 通过后,pre-research(预研阶段, ADR-0021)作为下一排定 stage。
- **坑** 问题"少而关键"(每轮 ≤4 问);不得无限提问阻塞;仅超阈值触发,清晰任务直通。

---

## 3 · §0 next_action replacement text

```
next_action: |
  Real E2E loop is specced as Stages E2E-0/1/2 in §3 (target repo
  CTlanston/multi-agent-brainstorm; coder = subscription Claude CLI inside Docker;
  real OpenAI + Gemini dual-family; live draft PR draft-only; model_usage persisted).
  FIRST clear the 2 open holds via Stage E2E-0: restore offline deps (missing
  @eslint/config-array@0.21.2 tarball + tsc/vitest/tsx/eslint binaries); operator
  restores ~/.Codex-247/config.yaml + repos.yaml with multi-agent-brainstorm enabled;
  repair gh auth. THEN Stage E2E-1: write ADR-0019, wire claude-in-docker + default
  dual-family validators (keys via SecretGrant/secrets-mcp) + persist model_usage +
  reuse remote-write-gh draft PR; prove ONE real run with model_usage>0, two
  independent-family validator verdicts, and an unmerged draft PR; reset
  allow_remote_writes=false after. THEN Stage E2E-2: structured clarification gate
  (ADR-0020). Pre-research deferred to a later stage (ADR-0021). open_holds must
  reach 0 before E2E-1 per §3.99.
```

---

## 4 · §10 changelog line to add (top of §10)

```
- 2026-05-29 (operator-directed planning pass): Added §3 Stages E2E-0 (unblock/baseline),
  E2E-1 (real end-to-end loop: dockerized subscription-Claude coder + default OpenAI+Gemini
  dual-family validators + persisted model_usage + live draft-only PR to
  CTlanston/multi-agent-brainstorm), E2E-2 (structured clarification gate). Updated §0
  next_action to point at E2E-0→1→2. Requires new ADR-0019 (real-e2e-loop) + ADR-0020
  (clarification-gate); pre-research deferred to ADR-0021. NOTE: §1 rule-3 ADR-numbering
  note ("0020=v2.2") already diverged from actual usage (0018=v2.4 hardening) — continue
  sequential 0019+ WITHOUT renumbering existing ADRs (GR#4). Housekeeping flagged: duplicate
  ADR-0013 filename collision; version drift (package.json 0.0.1 / status-route v2.4 /
  RELEASE_NOTES_GA v1.0.0).
```

---

## 5 · ADR outlines to write (ADR-first, GR#3)

**ADR-0019 — Real E2E Loop (docker-claude · dual-family · model_usage · live draft PR).**
Context: loop never run on real LLM work; coder defaults mock, validators default [], no
model_usage. Decision: run subscription Claude CLI inside a Docker worker (auth mounted
read-only); default-inject real OpenAI+Gemini validators (keys via SecretGrant/secrets-mcp);
persist model_usage as event+view; exercise existing remote-write-gh draft-PR path against
the real target with allow_remote_writes temporarily on; never merge. Consequences: first
real token + dual-family verdict + draft PR; auth-in-container risk → HOLD path, no silent
API fallback.

**ADR-0020 — Structured Clarification Gate.** Context: no AI-initiated requirement
elicitation before coder; ambiguous missions cause rework/slop. Decision: insert a
ClarificationGate between intake and role-pipeline that, above an ambiguity/risk threshold,
asks ≤4 structured questions, collects operator answers, and emits a verifiable
clarified-spec.md before coder runs. Consequences: higher mission quality; must avoid
over-gating clear tasks.

---

## 6 · §0 backlog (deferred, not in E2E-0/1/2)

- **Pre-research stage (ADR-0021):** codebase / issue / failing-test investigation → `research.md` as PRD/ADR input, before coder.
- **State de-split:** unify the two `state.db` (`~/.aedev` vs `~/.claude-code-247/aedev-daemon`) into one authoritative store.
- **Version-truth:** reconcile `package.json` 0.0.1 / status-route v2.4 / RELEASE_NOTES_GA v1.0.0 / workbook `production-usable-24x7` into one source of truth.
- **launchd 24/7:** fix `com.claude247.daemon` exit 254 (port 7247 held by manual `cockpit:dev`); make the managed boot path the real server.
- **Doc archaeology:** prune/freeze the 32 root MD files (superseded BETA/GA/M19–M22 reports) so the committed narrative matches reality.
- **ADR-0013 collision:** two `0013-*.md` files — resolve numbering (record, don't silently renumber).
