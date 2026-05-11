# Claude Code 7×24h 自演进系统 — 5 周落地路线图

> 目标：用单台机器（Docker Compose）跑起一个由 Planner / Coder / Reviewer / Guardian 四角色组成的常驻 Agent，把 GitHub Issue 变成经过影子分支压测、人审合入主干的 PR。

---

## 总体里程碑

| 阶段 | 周数 | 目标 | 验收标准 |
| --- | --- | --- | --- |
| **M0 — 准备** | 第 0 周（约 2 天） | 拉到代码骨架、申请 Token、跑通 Hello World | `docker compose up` 能起 4 个容器，headless `claude --print` 能输出文字 |
| **M1 — 骨架闭环** | 第 1 周 | Issue → Planner → Coder → 影子分支 PR | 给一个简单 Issue，能自动产出一个带测试的 PR，CI 红绿可见 |
| **M2 — 双 AI 互审** | 第 2 周 | 加入独立 Reviewer Session + 强制 TDD | 测试不先于实现 = Reviewer 自动 Request Changes |
| **M3 — 熔断 & 看护** | 第 3 周 | Guardian Agent + 信用分熔断 | 模拟 Token 突增 / CI 连挂 5 次，系统自动停摆并发通知 |
| **M4 — 记忆与并发** | 第 4 周 | 多 Issue 并行、Vector DB 记忆池 | 同时处理 3 个 Issue，且复发 Bug 被记忆池命中 |
| **M5 — 生产灰度** | 第 5 周 | 接入 1 个真实仓库，限流上线 | 连跑 7 天，无主干污染、无失控成本 |

---

## 第 0 周：准备

**目标**：拿到所有钥匙、跑通最小命令。

任务清单：

1. 申请/确认 `ANTHROPIC_API_KEY`，并在控制台设置每日 Token 预算告警。
2. 创建一个**干净**的目标仓库 `your-org/auto-evo-playground`，开两条分支保护：
   - `main`：只能通过 PR 合入，必须有 1 个人类 Reviewer。
   - `shadow-main`：允许 Bot 直接推送，但禁止合入 main。
3. 生成一个 GitHub App（推荐）或 PAT，权限：`Issues: RW`、`Pull requests: RW`、`Contents: RW`、`Actions: R`。
4. 准备一台至少 4C8G 的服务器或本地机器，安装 Docker 27+ 和 Docker Compose v2。
5. 拉取本仓库代码骨架，复制 `.env.example` 为 `.env`，填入 Key。
6. 运行 `docker compose up orchestrator runner-coder` —— 验证容器起来后能调通 Anthropic API。

**验收**：在 Issue 面板手动创建一个 Issue，标 `agent:auto`，5 分钟内能在日志里看到 Planner 的拆解输出。

---

## 第 1 周：骨架闭环（核心周）

**目标**：把"Issue 进、PR 出"的主干跑通，先不追求质量。

每日任务：

| 日 | 任务 | 产物 |
| --- | --- | --- |
| Day 1 | Orchestrator：实现 Issue 拉取、状态机、任务队列（Redis） | `orchestrator/main.py` 跑起来后能在 DB 里看到 Issue 记录 |
| Day 2 | Headless Runner：用 `claude --print --output-format stream-json` 跑一次 Planner | Planner 输出的 JSON Plan 落到 `workspace/<issue-id>/plan.json` |
| Day 3 | Coder Runner：根据 Plan 在临时 worktree 里写代码 + 提交 | 仓库里出现 `shadow/issue-<n>` 分支 |
| Day 4 | GitHub Actions：`shadow-ci.yml` 在 push 到 `shadow/*` 时跑测试 | Actions 页面能看到 CI 状态 |
| Day 5 | Orchestrator：CI 绿后自动开 Draft PR 到 `main`，@当事人 | GitHub PR 列表出现 Draft PR |

**避坑要点**：

- 第 1 周**不要**做并发，每次只处理一个 Issue，方便调试。
- Coder 使用 `--permission-mode plan` 的反义：直接给写权限，但**只挂载该 Issue 的 worktree**，看不到其他文件。
- Plan/Code 全部留痕到 `workspace/<issue-id>/`，方便事后归因。

**验收**：手动创建一个 Issue「给 utils.py 加一个反转字符串的函数 reverse(s)」，30 分钟内能看到带测试的 Draft PR。

---

## 第 2 周：双 AI 互审 + 强制 TDD

**目标**：从"能跑"到"能信"。

任务：

1. **独立 Reviewer Session**：开新容器、新 system prompt、**只读** clone，禁止 Reviewer 能写代码（避免左右互搏）。Reviewer 用 Claude Opus 4.7。
2. **TDD 守门**：Coder 提交流分两次——先提交 `test:` 前缀的失败用例，再提交 `feat:` 前缀的实现。Orchestrator 检查 commit 顺序，违规就拒绝进入审计阶段。
3. **Reviewer 输出格式**：JSON `{"verdict": "approve|request_changes", "comments": [...]}`，写回 PR 评论。
4. **二次 Coder 修复**：若 `request_changes`，Coder 拿评论再来一轮（最多 3 轮，超出转人审）。

**避坑要点**：

- Reviewer 的 prompt 里**强调"宁误杀、勿放过"**，专门盯：测试桩造假、未覆盖边界、隐式依赖、删除已有用例。
- 限制 Reviewer 工具：`Read`、`Grep`、`Glob`，禁用 `Edit`、`Write`、`Bash`。

**验收**：故意提交一个把测试改成 `assert True` 的"假修复"，Reviewer 必须 catch 并打回。

---

## 第 3 周：Guardian + 熔断

**目标**：让系统能在自己跑偏的时候**自己关电闸**。

任务：

1. **指标采集**：Orchestrator 每 5 分钟把以下指标写进 SQLite/Postgres：
   - 当日 Token 总消耗、单 Issue Token 消耗
   - CI 失败率（小时窗口）
   - PR 退回轮数分布
   - Issue 处理时长 p95
2. **信用分**：每个 Issue 起始 100 分，命中规则扣分，归零即停。
3. **Guardian Agent**（Opus 4.7）每 30 分钟跑一次，输入是上述指标 + 最近 N 个 PR 的 diff 摘要，输出 JSON：`{"health": 0-100, "alerts": [...], "recommendation": "continue|pause|stop"}`。
4. **告警**：`pause/stop` 时通过 Webhook 推 Slack/微信，并在 GitHub 给所有进行中的 PR 加 `agent:paused` 标签。

**避坑要点**：

- Guardian 用**新 Session、不喂代码细节**，专看宏观指标，避免被 Coder 的"花言巧语"带跑偏。
- 阈值先松后紧：第一周用宽松阈值收数据，第二周再收紧。

**验收**：把 Coder 的 prompt 改坏让它输出乱码，Guardian 30 分钟内进入 `pause`，并能在 Slack 看到告警。

---

## 第 4 周：记忆池 + 并发

**目标**：解决"同样错误反复犯"和"吞吐量太低"的问题。

任务：

1. **Vector DB**：用 Qdrant（一个轻量 Docker 容器够了）。索引内容：
   - 历史 PR 中被 Reviewer 打回的 comment + 对应 diff 片段
   - 历史 Bug 修复的 root cause 摘要
2. **Reviewer 检索增强**：Reviewer 在审之前，先用 PR 的 diff 摘要 query 向量库，把 top-5 相似教训塞进 system prompt。
3. **多 Issue 并行**：Coder 池开到 3 个并发 Worker，每个 Worker 锁一个 Issue（DB 行锁），结束后释放。
4. **资源隔离**：每个 Coder 容器 CPU 限额 2 核、Mem 4G，避免一个 Issue 拖死全机。

**验收**：注入 3 个 Issue，能看到三条 `shadow/issue-*` 分支同时被推进；故意复现一个上周已修过的 Bug，Reviewer 评论里出现"这跟 PR #N 的教训一样"。

---

## 第 5 周：生产灰度 + 7 天观察

**目标**：从玩具变工具。

任务：

1. **限流上线**：在真实仓库开 `agent:auto` 标签，但只让维护者能贴。每天最多消化 5 个 Issue。
2. **白名单文件**：Coder 只能改 `src/**`、`tests/**`，禁止动 `.github/`、`pyproject.toml`、`Dockerfile` 等关键文件——这种改动一律转人审。
3. **预算硬顶**：Anthropic 控制台设置组织级日预算，Orchestrator 也设软顶（比如 \$30/天），到顶即停。
4. **每日复盘脚本**：每天 23:55 自动跑一次，把当天产出的 PR / 退回 / 熔断事件汇总成一封邮件给你。
5. **7 天观察**：每天看 5 分钟邮件，记录所有"这地方 Agent 不该这么干"的瞬间，作为下一轮 prompt 调优材料。

**验收（出师标准）**：

- 7 天内 0 次主干污染。
- 7 天内总成本 ≤ 预算。
- 至少 50% 的 Issue 不需要人类介入修改即可合入。
- Guardian 至少触发 1 次熔断且事后回看是合理的。

---

## 资源清单

- **算力**：1 台 4C8G 机器（24 小时跑），约 ¥150/月。
- **存储**：50GB 够 30 天日志 + 向量库。
- **API 成本**：Coder 用 Sonnet 4.6 约 \$15-25/天（中等 Issue 量），Reviewer/Guardian 用 Opus 4.7 约 \$5-10/天。**总预算建议 \$30-50/天**。
- **人**：第 0-2 周需要 1 人全职搭建；第 3 周后可降到 0.3 人。

---

## 不要做（红线）

1. **不要**让 Agent 直接 push `main`，永远走 PR + 至少 1 个人类 Approve。
2. **不要**把生产数据库密码、私钥放进 Agent 能读到的环境变量。**用单独的 Vault**。
3. **不要**给 Coder 网络出口里的"任意域名"，只放行 `api.anthropic.com` + 你 Git 服务器 + npm/pypi。
4. **不要**省略 Guardian。一个会写代码、能 push、还没人盯着的 AI，是最危险的同事。
5. **不要**第一周就追求漂亮架构——先**能闭环**，再**能优化**。
