# OPERATOR HANDOFF — 剩余 10%（量规 18/20 → 20/20 + soak）

> 这份文件是给**你（操作员）在 Mac 上**和**本地 Codex CLI** 用的执行手册。
> 云端自主循环已在 18/20=90% 终止；剩下的项目都需要真实订阅 CLI / 真实
> GitHub 写 / 真实多机，云容器做不了。三种用法任选：
> A) 你手动按命令跑；B) 把 §4 的 prompt 贴给 Codex 让它驱动；
> C) 用 §5 的 `aiw-handoff.sh` 半自动循环。

适用 commit：本文件所在的 main（cc7d058 或更新）。

---

## §0 一次性环境检查（每个任务前都先跑）

```bash
cd ~/projects/claude-code-247
git switch main && git pull origin main
pnpm install --frozen-lockfile

# 成本安全闸：绝不能有付费 API key 串进来
for k in OPENAI_API_KEY ANTHROPIC_API_KEY; do
  if [ -n "${!k:-}" ]; then echo "ABORT: $k is set — unset it first"; exit 1; fi
done

# 订阅 CLI 必须就绪
claude --version            # Claude Code 订阅登录
codex --version             # Codex 订阅登录（ChatGPT 账号，不是 API key）
gh auth status              # GitHub CLI 已登录

# validator key（只给 validator，planner/coder 拿不到）
grep -q AEDEV_GEMINI_API_KEY .env && echo "gemini key present" || echo "ADD AEDEV_GEMINI_API_KEY to .env"

# 全闸基线（必须全绿才往下走）
pnpm typecheck && pnpm lint && pnpm test
```

---

## §1 任务 A — 推送本地 smoke 补丁（量规 #13 的前置，最先做）

你之前在 Mac 上改过 `scripts/operator-cockpit-real-smoke.ts`
（Gemini verdict 写进主报告 + 持久化 `validator-summary.json`），那个补丁
**还没进 main**。先把它推上来，否则 main 的 real-smoke 缺这层证据。

```bash
cd ~/projects/claude-code-247
git switch -c handoff/smoke-validator-summary
git status                       # 确认那两处改动还在；若已 stash 则 git stash pop
git add scripts/operator-cockpit-real-smoke.ts
git commit -m "test(smoke): persist Gemini verdict + validator-summary.json (operator patch)"
git push -u origin handoff/smoke-validator-summary
gh pr create --fill --draft
# CI 绿后：gh pr merge --merge --auto
```

若改动已丢失：跳过本任务，real-smoke 仍可跑，只是证据靠 strict 逻辑推断。

---

## §2 任务 B — 真订阅 CLI 全链 E2E（量规 #13，闭闸）

remote writes 保持**关闭**，验证 planner→coder→Gemini→闸 全链在当前 main 工作。

```bash
cd ~/projects/claude-code-247
unset AEDEV_ALLOW_REMOTE_WRITES          # 确保闭闸
AEDEV_COCKPIT_REAL_SMOKE_REQUIRE_P1=1 \
AEDEV_COCKPIT_REAL_SMOKE_REQUIRE_GEMINI=1 \
pnpm test:cockpit:real-smoke
```

期望（PASS 判据）：
- planner = `claude-cli` / `local_claude_code`
- coder = `codex-cli` / `local_codex`
- Gemini verdict = `pass`（看 `evidence/launch/*-evidence/validator-summary.json`）
- Draft PR gate = `blocked code=REMOTE_WRITES_DISABLED`（闭闸正确）
- 报告落在 `evidence/launch/operator-cockpit-real-smoke-<ts>.md`

记录：把报告路径贴回会话，或 commit 进 `evidence/launch/`。

---

## §3 任务 C — 真实 Draft PR 出口（量规 #12，开闸，v1.5 正式收口）

**这是"一个需求 → 一个真 PR"闭环第一次真正出门。** 只对一个安全 repo 开闸。

```bash
cd ~/projects/claude-code-247
# 1) 确认 hermus-agent（或你选的安全 repo）在注册表 enabled:true
cat ~/.aedev/repos.yaml 2>/dev/null | grep -A3 hermus-agent

# 2) 开双闸（全局 + 白名单），只含这一个 repo
export AEDEV_ALLOW_REMOTE_WRITES=1
export AEDEV_REMOTE_WRITE_WHITELIST=hermus-agent

# 3) 启动 daemon + cockpit
pnpm tsx scripts/dev-operator-cockpit.ts     # 或你的 launchd 服务

# 4) 浏览器开 cockpit，提一个小而真实的需求（针对 hermus-agent）
#    走完整链：澄清≥95% → roadmap → Codex 编码 → Claude review 气泡
#    → Gemini PASS → 点 create-pr
```

PASS 判据（L1）：
- [ ] 返回**真实 Draft PR URL**，且为 draft 状态（不是 example.invalid）
- [ ] 对话里出现 **Claude review 气泡**（P2 跨引擎 review 生效）
- [ ] 白名单外随便挑个 repo 试 create-pr → `REPO_NOT_WHITELISTED`（双闸验证）
- [ ] **merge 由你人工点**，系统从不自动 merge
- [ ] evidence + 截图进 `evidence/`

收口：编辑 `WORKBOOK_v4.md` §0 把 `blocked_on: operator_real_e2e` 改成
`done`，commit 一条 `[P4] real exit done`，并更新
`docs/E2E_ACCEPTANCE_RUBRIC.md` 第 12、13 项打勾 → 20/20。

回滚：`unset AEDEV_ALLOW_REMOTE_WRITES`（或清空白名单）→ 行为立刻回到全挡；
PR 侧直接 close draft 即可，没 merge 就没副作用。

---

## §4 任务 D — v5-P4 五 worker soak（量规 #19，可模拟）

最低限度（MVP 退出）：5 个隔离 worker（同机不同 `AEDEV_HOME` 即可模拟）
跑 ≥1 周，每 worker ≥1 真 Draft PR，零 token 泄漏、零越权写、空闲零 credit，
**至少注入一次伪证演练**确认 `HOLD-EVIDENCE-MISMATCH` 触发。

fleet 协议已就绪（`packages/daemon/src/routes/fleet.ts`）：register/claim/
heartbeat/events/evidence + Ed25519 签名 + 冻结。需要写的是 worker-side agent
（ADR-0023 §5 标注为 soak 阶段交付）——这一步可以交给 Codex（见 §5 prompt）。

---

## §5 给 Codex 的启动 prompt（直接粘贴）

把下面整段贴进你 Mac 上 hermus-agent 或本 repo 的 Codex CLI（`codex` 交互式
或 `codex exec`），它会按手册自驱：

```
你是这个仓库的本地自主开发助手，运行在操作员的 Mac 上，拥有真实订阅 CLI
和 GitHub 写权限。读 docs/operations/OPERATOR_HANDOFF_REMAINING_10PCT.md，
按它的 §1→§2→§3→§4 顺序，一次只做一个有界任务，每步遵守：

1. 动手前先跑 §0 环境检查；任一项红就停下报告，绝不带病前进。
2. 绝不设置或使用 OPENAI_API_KEY / ANTHROPIC_API_KEY（只用订阅 CLI）。
3. 每个任务结束跑该任务的 PASS 判据；FAIL 也如实提交证据，不掩盖（GR#7）。
4. 远程写只在 §3 明确开闸时启用，且只对白名单单一 repo；merge 永远等操作员。
5. 每完成一项就更新 docs/E2E_ACCEPTANCE_RUBRIC.md 的对应行（要有证据才打勾），
   commit 并开 draft PR；CI 绿后可 auto-merge，但 §3 的真实 Draft PR 本身
   交给操作员 review。
6. §4 需要写 worker-side agent 时，wrap packages/runner 的 CLI 适配层接到
   fleet claim API（ADR-0023 §5），TDD，遵守 GROUND RULE 8。

终止条件：量规 20/20 且 v5-P4 soak 报告落盘。完不成就按上述循环继续改。
开始前先回报你的执行计划。
```

---

## §6 安全红线（任何模式都不可破）

- 不读/复制/转发 `~/.codex/auth.json`、Claude 凭证、`.env`、`secrets/**`。
- 不把任何人的订阅 token 放上云或共享。
- 不用 API key 跑 Codex/Claude（订阅 CLI only）。
- 不自动 merge main、不自动 deploy production。
- forbidden_paths（`.env*` `secrets/**` `.github/**` `CLAUDE.md` `AGENTS.md`）
  永不改动，除非操作员显式批准。
