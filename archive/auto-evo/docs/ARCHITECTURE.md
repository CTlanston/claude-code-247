# 架构方案 — Claude Code 7×24h 自演进系统

## 1. 系统总览

```
                         ┌────────────────────────────────────────┐
                         │            GitHub (源 + CI)             │
                         │  Issues  │  shadow-main  │  Actions    │
                         └─────▲─────────────▲────────────▲────────┘
                               │             │            │
            webhook / poll     │     push    │     status │
                               │             │            │
                  ┌────────────┴─────────────┴────────────┴────┐
                  │              Orchestrator                  │
                  │  ┌─────────┐  ┌──────────┐  ┌──────────┐   │
                  │  │ Queue   │  │ State DB │  │ Circuit  │   │
                  │  │ (Redis) │  │ (SQLite) │  │ Breaker  │   │
                  │  └────┬────┘  └────┬─────┘  └────┬─────┘   │
                  └───────┼────────────┼─────────────┼─────────┘
                  spawn   │            │             │ metrics
                          ▼            ▼             ▼
                   ┌─────────────┬─────────────┬─────────────┐
                   │  Planner    │   Coder     │  Reviewer   │
                   │  Sonnet 4.6 │ Sonnet 4.6  │  Opus 4.7   │
                   │  (Headless) │ (Headless)  │  (Headless) │
                   └─────────────┴─────────────┴─────────────┘
                                                    ▲
                                                    │ health probe
                                              ┌─────┴──────┐
                                              │  Guardian  │
                                              │  Opus 4.7  │
                                              └────────────┘
```

每个角色 = 一个独立的 `claude --print` 进程，跑在受限的 Docker 容器里，互不共享会话历史。容器之间唯一的"共享内存"是 Orchestrator 维护的状态 DB 和挂载到 worktree 的文件系统。

---

## 2. 组件清单

### 2.1 Orchestrator（Python，长驻）

职责：

- **任务源**：监听 GitHub Webhook（`issues`、`issue_comment`、`pull_request`、`workflow_run`）。本地开发时 fallback 到轮询 `GET /issues?labels=agent:auto`。
- **状态机**：每个 Issue 有状态 `queued → planning → coding → ci_running → reviewing → human_review → merged | rejected | paused`。状态写 SQLite（小团队够用，要扩可换 Postgres）。
- **Runner 调度**：根据状态拉起对应角色容器，注入工作目录、环境变量、Issue 上下文。
- **熔断检查**：每个 Runner 启动前，先看信用分和全局健康。
- **GitHub 写回**：开 PR、贴评论、加标签、推 commit。

### 2.2 Headless Runner（4 个变体共用基础镜像）

基础镜像装好 Node + `@anthropic-ai/claude-code` CLI、Python、git。启动时通过环境变量决定角色：

```
CLAUDE_ROLE = planner | coder | reviewer | guardian
WORKSPACE   = /workspace/<issue-id>
SYSTEM_PROMPT_FILE = /prompts/<role>.md
ALLOWED_TOOLS = Read,Grep,Glob   (Reviewer)
              | Read,Edit,Write,Bash,Grep,Glob (Coder)
```

每次跑完输出结构化 JSON 到 `WORKSPACE/result.json`，Orchestrator 读完即销毁容器。

### 2.3 角色细节

| 角色 | 模型 | 工具集 | 文件系统 | 网络 | 单次预算 |
| --- | --- | --- | --- | --- | --- |
| **Planner** | Sonnet 4.6 | Read, Grep, Glob, WebSearch | 只读整个仓库 | api.anthropic.com only | 50K tokens |
| **Coder** | Sonnet 4.6 | Read, Edit, Write, Bash, Grep, Glob | RW 单 Issue worktree | api.anthropic.com + git server + npm/pypi | 200K tokens |
| **Reviewer** | Opus 4.7 | Read, Grep, Glob | 只读整个仓库 + PR diff | api.anthropic.com only | 80K tokens |
| **Guardian** | Opus 4.7 | Read（仅状态目录）, WebSearch（可选） | 只读 `metrics/` | api.anthropic.com only | 30K tokens |

权限在两层落地：
1. **CLI 层**：`claude` 通过 `--allowedTools` 白名单限制能用的工具。
2. **容器层**：Docker volume 只挂载该角色所需路径；`network_mode: bridge` + iptables 出口白名单。

### 2.4 GitHub Actions（影子 CI）

`.github/workflows/shadow-ci.yml`：

- 触发：push 到 `shadow/**` 分支、`pull_request` 到 `main`。
- 阶段：`lint → unit → integration → coverage-gate(80%)`。
- 输出：失败时把日志摘要回贴到对应 Issue（通过 Orchestrator 的 webhook）。
- 关键约束：**永远不能跑 `deploy:` 脚本**。`shadow-main` 不接 Staging 环境。

### 2.5 状态存储

- `tasks` 表：issue_id, status, branch, credit, started_at, ...
- `runs` 表：每次 runner 的 token 消耗、退出码、duration
- `metrics` 表：5 分钟粒度的 token / CI / failure 计数
- `audit` 表：人工干预记录、Guardian 告警历史

---

## 3. 端到端工作流（一个 Issue 的命）

```
[人类]  打开 Issue #42，标签 agent:auto
   │
   ▼
[GitHub Webhook] ─► [Orchestrator] 入队，状态=queued
   │
   ▼
[Circuit Breaker] 检查全局健康 → 通过
   │
   ▼
[Planner Runner]                   ←─ system prompt: "拆解 Issue 为最多 5 个子任务，列影响文件，不写代码"
   读 Issue 全文 + 相关代码         
   产出 plan.json {"steps":[...]} 
   │
   ▼ Orchestrator 状态=coding，建 worktree shadow/issue-42
[Coder Runner]                     ←─ system prompt: "TDD 模式：每个 step 先写失败测试 commit，再写实现 commit"
   读 plan.json
   循环每个 step：
     1. 写测试 → git commit -m "test: ..." 
     2. 跑测试，确认红
     3. 写实现 → git commit -m "feat: ..."
     4. 跑测试，确认绿
   git push origin shadow/issue-42
   │
   ▼
[GitHub Actions shadow-ci.yml] 跑全量测试
   │  失败 ──► Orchestrator 把日志摘要塞回 Coder（最多 3 轮）
   │  3 轮失败 ──► 状态=human_review，@人
   ▼ 成功
[Reviewer Runner]                  ←─ system prompt: "你是独立审计者。怀疑一切。只读权限。"
   读 PR diff、相关历史 PR、Vector DB top-5 教训
   产出 verdict.json {"verdict":"approve|request_changes","comments":[...]}
   │
   ├── request_changes ──► Orchestrator 把评论塞回 Coder（计入 3 轮上限）
   ▼ approve
[Orchestrator] 开 Draft PR shadow/issue-42 → main，@人 Reviewer
   │
   ▼
[人类] Approve & Merge   （唯一进入 main 的入口）
   │
   ▼ 合入后 Orchestrator
- 销毁 worktree
- 把本次"成功 diff + Reviewer 评论 + 是否人工修改"写进 Vector DB
- 状态=merged
```

---

## 4. 熔断与 Guardian

### 4.1 信用分（每 Issue）

起始 100 分，扣分规则：

| 事件 | 扣分 |
| --- | --- |
| CI 失败一次 | -10 |
| Reviewer 打回一次 | -15 |
| 单次 Coder run 超 200K tokens | -20 |
| Bash 命令尝试访问白名单外的网络 | -50（直接停） |
| 改动了白名单外文件（如 `.github/`、`Dockerfile`） | -100（直接停，转人审） |

归零即 `paused`，Orchestrator 把 PR 标 `agent:paused`，等人复活。

### 4.2 全局健康（Guardian）

每 30 分钟跑一次，输入：

- 过去 24 小时的 token 消耗曲线
- 过去 6 小时的 CI 失败率
- 过去 10 个合并 PR 的代码风格漂移指标（`radon cc` 复杂度变化、新增 TODO/FIXME 数量）
- 同一文件最近 3 次修改的 diff 摘要（看是否在反复横跳）

输出：

```json
{
  "health": 73,
  "alerts": [
    {"level": "warn", "topic": "token_spike", "detail": "..."},
    {"level": "warn", "topic": "complexity_drift", "detail": "..."}
  ],
  "recommendation": "continue|pause|stop"
}
```

`pause` 状态下 Orchestrator 不再拉起新的 Coder，但允许进行中的 Reviewer 跑完。`stop` 状态下立即冻结所有 Runner。

### 4.3 强约束

- **每天 23:00 强制结算**：当日花费 > 预算的 80%，自动进入 `pause` 直到次日 0 点。
- **同一文件 24 小时内被修改 > 5 次**：进入"循环嫌疑"，Guardian 必须人审。

---

## 5. 安全模型

### 5.1 信任边界

```
[最高信任] 人类维护者 → Orchestrator 配置文件
                       ↓
[受信] Orchestrator 进程
                       ↓
[半信任] Reviewer / Guardian（只读）
                       ↓
[低信任] Coder（可写但沙盒）
                       ↓
[不信任] Issue 内容、网页内容、第三方依赖
```

**关键原则**：Issue 正文里的指令视为 untrusted data，不是命令。Planner/Coder 的 system prompt 必须显式声明这一点（见 `prompts/coder.md`）。

### 5.2 凭据隔离

- Anthropic API Key：只挂给 Runner，Orchestrator 自己不要持有。
- GitHub Token：**只挂给 Orchestrator**，Runner 看不到。Runner 的 `git push` 通过 Orchestrator 提供的本地 git proxy（受限远端）完成。
- 任何包含 `secret`/`token`/`key` 字样的文件 — Coder 系统提示明确禁止读取，且容器层挂载排除 `.env`、`*.pem`、`secrets/**`。

### 5.3 网络出口

容器默认 `--internal` 网络，只通过 squid/tinyproxy 访问白名单：

```
api.anthropic.com:443
github.com:443
api.github.com:443
pypi.org:443  files.pythonhosted.org:443
registry.npmjs.org:443
```

任何 DNS 解析到白名单外的地址 → 拒绝 + Guardian 告警。

---

## 6. 模型分配的理由

- **Coder = Sonnet 4.6**：吞吐量大、成本可控，写代码主力。
- **Reviewer = Opus 4.7**：审计需要更强的反事实推理和"挑刺能力"，且调用频率比 Coder 低 3-5 倍，成本可承受。
- **Guardian = Opus 4.7**：跑得很少（每 30 分钟一次），但每次决策影响整个系统，必须最强模型。
- **Planner = Sonnet 4.6**：拆解任务的活儿 Sonnet 已经很好，且 Planner 错了，Coder/Reviewer 也能拦下。

如果预算紧：Planner 可以降到 Haiku 4.5。Reviewer 不要降。

---

## 7. 失败模式与对策

| 失败模式 | 现象 | 对策 |
| --- | --- | --- |
| **TDD 造假** | Coder 写 `assert True` 蒙过测试 | Reviewer prompt 显式检查；CI 跑 mutation testing 抽样 |
| **逻辑漂移** | 测试全过但偏离 Issue 描述 | Guardian 拿 Issue 原文 + 最终 diff 做语义对齐检查 |
| **死循环重构** | 同一文件被反复改 | "同一文件 24h > 5 次修改" 强制人审 |
| **Token 爆炸** | 单 Issue > 1M tokens | 单 run 200K 硬顶 + 信用分 -20 |
| **Reviewer 串通 Coder** | 两个角色都被 prompt injection 影响给绿灯 | Guardian 是第三只眼；外加每 N 个 PR 抽 1 个强制人审 |
| **依赖投毒** | 引入恶意 npm/pypi 包 | 锁文件改动 → 转人审；CI 跑 `npm audit` / `pip-audit` |
| **沙盒逃逸** | Coder 试图改 `.github/` | 文件白名单 + Reviewer 强制 reject |

---

## 8. 后续演进方向（v2+）

- **多仓库**：把 Orchestrator 抽成 SaaS 化，支持订阅多个仓库。
- **Skill Library**：把"如何写好的 PR 描述"这类元能力做成可复用 skill 注入到 Coder/Reviewer。
- **Self-improving prompts**：每周用 Guardian 的告警日志反向优化 Coder/Reviewer 的 system prompt（人审过后才落盘）。
- **Cross-repo 知识迁移**：A 仓库吃过的亏写进通用向量库，B 仓库的 Reviewer 也能查到。

---

## 9. 与原方案对比的取舍说明

| 原方案点 | 本实现 | 取舍理由 |
| --- | --- | --- |
| Firecracker microVM | **Docker** | 单机够用，K8s/microVM 留到 v2 |
| 影子分支压测 | **保留**（GitHub Actions on `shadow/**`） | 这是最关键的安全垫 |
| 四角色分离 | **保留**，但 Guardian 简化为定时 cron | 避免一开始就上消息总线复杂度 |
| Vector DB 记忆池 | **延后到第 4 周** | 第 1-3 周先把闭环跑通 |
| 异步分级人审 | **保留**：CI 绿 + Reviewer 绿后开 Draft PR，人类是最后一道闸 | 与 GitHub 原生流程贴合 |
