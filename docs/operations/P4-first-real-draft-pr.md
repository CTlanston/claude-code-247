# P4 — First Real Draft PR (operator runbook)

WORKBOOK_v4 P4 的收口步骤。代码侧（per-repo 白名单双闸 + 回归测试）已合并；
这份 runbook 是操作员在 Mac 上跑真实 E2E 的清单。整个流程产出**一个真实的
Draft PR**；merge 永远人工。

## 0. 前置

- `claude` / `codex` CLI 已用订阅账号登录（`aedev doctor` 全绿）。
- `.env` 含 `AEDEV_GEMINI_API_KEY`（validator 专用；coder/planner 永远拿不到）。
- 安全 repo（默认 `hermus-agent`）已在 `repos.yaml` / 注册表中 `enabled: true`。
- 可选：`AEDEV_NTFY_TOPIC` 已配置（hold/budget 通知到手机）。

## 1. 打开双闸（只对一个 repo）

`~/.aedev/config.yaml`：

```yaml
allow_remote_writes: true
remote_write_whitelist:
  - hermus-agent
```

或环境变量（env 优先于 config）：

```bash
export AEDEV_ALLOW_REMOTE_WRITES=1
export AEDEV_REMOTE_WRITE_WHITELIST=hermus-agent
```

语义（GR#3 修订）：
- 全局开关 + 白名单**双条件**都满足才允许 push / Draft PR。
- 白名单为空 = 全部 repo 挡住（fail-closed），即使全局开关是 true。
- 白名单外的 repo 行为与 v3 完全一致：`REPO_NOT_WHITELISTED` 阻断。

## 1.5 Real smoke 的两种模式（CloudHull c1–c4，命令以脚本语义为准）

`scripts/operator-cockpit-real-smoke.ts` 的 PASS/FAIL 语义（纯函数实现在
`packages/daemon/src/real-smoke-policy.ts`，有单测）：

```bash
# STRICT（默认）：PASS 要求 planner=claude-cli/local_claude_code 且
# coder=codex-cli/local_codex。planner 走了 AEDEV_PLANNER_FALLBACK=codex
# 兜底 → 直接 FAIL（PLANNER_FALLBACK_NOT_ACCEPTED），不存在"宽松默认"。
pnpm test:cockpit:real-smoke

# FALLBACK-PROOF：显式接受 planner=codex-cli (fallback)。结果只会标
# `DEGRADED (planner fallback)`，永远不算 strict PASS；报告同时记录
# requested mode 和 achieved mode。
AEDEV_COCKPIT_REAL_SMOKE_ACCEPT_PLANNER_FALLBACK=1 pnpm test:cockpit:real-smoke

# Gemini 终态等待（默认 180000ms）：必须到 pass / fail / not_configured，
# 超时报 GEMINI_TIMEOUT（独立一行 + 非 PASS），绝不含糊地停在 "pending"。
# 每次运行都会写 validator-summary.json（verdicts 数组 + terminal 状态）。
AEDEV_COCKPIT_REAL_SMOKE_VALIDATOR_TIMEOUT_MS=240000 pnpm test:cockpit:real-smoke

# 强制要求 Gemini PASS（not_configured 也算失败）：
AEDEV_COCKPIT_REAL_SMOKE_REQUIRE_GEMINI=1 pnpm test:cockpit:real-smoke

# 针对一个已存在的真实 repo 跑（注册后在它的隔离 worktree clone 里执行；
# 路径必须是有 commit 的 git repo，否则是明确的 SETUP 错误，不会假跑）：
AEDEV_COCKPIT_REAL_SMOKE_SOURCE_REPO=~/projects/hermus-agent \
AEDEV_COCKPIT_REAL_SMOKE_REPO_NAME=hermus-agent \
pnpm test:cockpit:real-smoke
```

回归证据要求（两种模式相同）：evidence 里必须能解析出 ≥1 条真实执行过且
PASS 的测试命令（沙箱 fixture 自带 `npm test` 的 node 断言脚本），否则
FAIL（`REGRESSION_EVIDENCE_MISSING`）。旧的
`AEDEV_COCKPIT_REAL_SMOKE_REQUIRE_P1` 已废弃：STRICT 现在就是默认。

## 2. 跑完整闭环

1. 启动 daemon + cockpit（`scripts/dev-operator-cockpit.ts` 或 launchd）。
2. 在对话里提一个小而真实的需求（例如给 hermus-agent 加一个小功能）。
3. 走完整链：澄清 ≥95% → roadmap → Codex 编码 → **Claude review（P2）**
   → Gemini 终审 PASS → `create-pr`。
4. 期望结果：返回**真实 PR URL**（draft 状态）；mission 记录
   `operator.draft_pr_created` 事件。

## 3. 验收清单（L1）

- [ ] Draft PR URL 可访问且为 draft 状态。
- [ ] 白名单外 repo 的 create-pr 仍被 `REPO_NOT_WHITELISTED` 挡住（回归测试已覆盖）。
- [ ] Gemini 非 PASS 仍阻断 create-pr（回归测试已覆盖）。
- [ ] evidence 目录含全链路产物 + `claude-review-<n>.json`。
- [ ] 状态条 headless 调用计数符合预期（P1 计量在工作）。
- [ ] 短 soak：让 daemon 待机 ≥3 个 watchdog tick（默认 ≥90 分钟），
      确认空闲期间 `cost.headless_call` 计数为零。
- [ ] 截图 + evidence 入 `evidence/`，SESSION_LOG 记一条，§0 标 done。

## 4. 回滚

- 关闸：`allow_remote_writes: false`（或清空白名单）→ 行为立刻回到 v3 全挡。
- PR 侧：close draft PR 即可，系统从不自动 merge。
