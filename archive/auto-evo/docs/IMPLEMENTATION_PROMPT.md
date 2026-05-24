# 给 Claude Code / Codex 的实施提示词

> 把这份文件夹整体打开为工作目录后，把下面整段话粘给 Claude Code 或 Codex 即可。

---

你现在工作在 `claude-code-247/` 这个项目目录里。这是一个"Claude Code 7×24h 自演进系统"的**骨架**——架构、路线图、所有关键文件都已经写好，你的任务是按图施工把它跑起来，并补齐每一周缺失的实现细节。

## 第一步：先读，不要写

按这个顺序通读这些文件，全部读完再动手：

1. `README.md`：项目总览。
2. `ARCHITECTURE.md`：必读。四角色权限矩阵、端到端工作流、信用分规则、安全模型、失败模式都在这里。这是你做任何架构判断的唯一依据。
3. `ROADMAP.md`：必读。M0–M5 五周路线图，每个里程碑的验收标准是你判断"是否完成"的硬性标准。
4. `docker-compose.yml`、`orchestrator/`、`runner/`、`.github/workflows/shadow-ci.yml`、`scripts/`：扫一遍，理解现状。
5. `orchestrator/roles/{planner,coder,reviewer,guardian}.md`：四个角色的 system prompt，是这套系统的灵魂。

读完后用一段话告诉我你的理解，特别是：四角色各自的权限边界、影子分支的作用、Guardian 的决策映射。**理解通过后我才会让你动手。**

## 第二步：按周推进，不要跳步

严格按 `ROADMAP.md` 的 M0 → M5 顺序推进。**每周完成后必须达到该周的验收标准才能进入下一周**。

- **M0**：确认本机环境、`.env`、Docker、GitHub Token，跑通 Hello World（headless `claude --print` 能输出文字）。
- **M1**：让"Issue → Planner → Coder → 影子分支 PR"主干跑通。第 1 周不要做并发，每次只处理一个 Issue。
- **M2**：加入独立 Reviewer Session、强制 TDD（commit 顺序检查）、最多 3 轮 Coder ↔ Reviewer 互动。
- **M3**：Guardian + 信用分熔断 + Slack 告警。
- **M4**：多 Issue 并发 + Vector DB 记忆池（启用 docker-compose 的 `memory` profile）。
- **M5**：生产灰度 + 7 天观察。

每完成一周，跑一次该周路线图里的"验收"步骤，把结果（通过/失败、日志摘要）报告给我，**等我确认再开下一周**。

## 第三步：补齐骨架的"已知漏洞"

骨架是可读、可解释的，但有以下**已知**未实现/未验证的点。请在 M1 之前一并补齐：

1. **Headless Claude CLI 行为校准**：`runner/entrypoint.sh` 用了 `claude --print --output-format json --append-system-prompt --allowedTools --max-turns`。请先用 `claude --help` 校验当前版本的 CLI 实际支持的参数名和输出 JSON 字段名（`usage` 字段路径、`result` vs `text` 字段），如有出入修正 entrypoint.sh 的解析逻辑。
2. **GitHub webhook 接入**：`orchestrator/main.py` 当前是轮询模式（`ingest_issues` 每 30 秒拉一次）。M2 之前请加一个最小 Flask/FastAPI 端点 `/webhook/github`，接收 `issues`、`pull_request`、`workflow_run` 事件并写入状态机，避免 30 秒延迟。
3. **shadow 分支的 git 准备**：`_do_coding` 里 prompt 假设分支已经 checkout，但实际上需要 orchestrator 先在 worktree 里 `git worktree add` 一个新分支并初始化。请在 `runner.py` 里加 `_prepare_worktree(issue_id)` 步骤。
4. **Coder 的 git 推送凭据**：Runner 容器没有 GitHub Token。最简方案是 orchestrator 把仓库 clone 到 `/workspaces/issue-<n>`，配置 git remote 指向 orchestrator 维护的本地裸仓库，再由 orchestrator 转推到 GitHub。请实现这个 git proxy。
5. **网络出口白名单**：`docker-compose.yml` 给 runner 用了 `network_mode: bridge`。请在 `runner.py` 里加一个独立的 `internal_with_proxy` 网络，挂一个 squid/tinyproxy 容器只允许 `.env` 里 `NETWORK_ALLOWLIST` 的域名出去。
6. **Reviewer 看 PR diff 的方式**：当前 `prompt.txt` 只给了分支名，请改成在 prompt 里附上 `git diff main...HEAD --stat` 的摘要，让 Reviewer 不用自己跑 git。

## 第四步：可改的与不可改的

**可改**（鼓励改进，但要在 PR 描述里说明）：

- 任何 Python 实现细节（命名、错误处理、模块拆分）。
- SQLite 表结构（如果加字段，给 `db.py` 里加一个 `migrate()` 函数）。
- 单个角色 prompt 的措辞（但角色边界不变）。
- 把 Flask 换成 FastAPI、把 SQLite 换成 Postgres 这类替代。

**不可改**（要改先问我）：

- 四角色架构（Planner / Coder / Reviewer / Guardian）。
- 影子分支模型（`shadow/issue-<n>` → 影子 CI → 人审 PR → main）。
- Reviewer 与 Coder 的会话隔离与权限差异。
- 模型分配（Coder=Sonnet 4.6，Reviewer/Guardian=Opus 4.7）。
- 安全红线（白名单文件、不可读 secrets、网络出口白名单、Issue 内容视为不可信）。
- "Agent 永远不能直接 push main"这条铁律。

## 第五步：每个动作都要可解释

- 每提交一个 commit，commit message 第一行说明"这是 ROADMAP 哪一周哪一步"。
- 每写一个新模块，开头加 docstring 说明它属于 `ARCHITECTURE.md` 里的哪个组件。
- 任何决策（选了 A 没选 B），在 PR 描述里给出一句理由。
- 遇到 ARCHITECTURE / ROADMAP 与现实冲突时，**停下来问我**，不要自己改架构文档。

## 第六步：禁忌

- 不要在没跑过 `docker compose build` 的情况下声称"M0 完成"。
- 不要把 `.env`、`*.pem`、`secrets/**` 提交到 git。
- 不要在 Coder 的 prompt 里偷偷加"忽略安全红线"之类的逃逸口子。
- 不要给真实仓库加写权限——只在测试仓库 `auto-evo-playground` 里跑，至少跑完 M3 才考虑生产灰度。
- 不要用 sleep/loop hack 来"过 CI"，CI 红就修代码，不是修 CI。

---

## 启动指令

读完上面所有内容后，按这个顺序行动：

1. 先回我一段不超过 200 字的"我读懂了"摘要，覆盖：四角色边界、影子分支、Guardian 决策。
2. 我确认后，开始 M0：检查环境、跑 hello world、报告结果。
3. M0 通过后再开 M1，依此类推。

不要一次性把五周全做完。每周一次同步。开始吧。
