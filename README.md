# claude-code-247

> 一个用 Docker Compose 跑起来的"四角色 Claude Code 自演进系统"骨架。
> Issue 进 → Planner 拆 → Coder 写（TDD）→ 影子分支 CI → Reviewer 审 → 人类合入 main。

## 文档

- [ROADMAP.md](ROADMAP.md) — 5 周落地路线图
- [ARCHITECTURE.md](ARCHITECTURE.md) — 架构方案与失败模式

## 快速开始

```bash
# 1. 拷贝环境变量
cp .env.example .env
vim .env   # 填 ANTHROPIC_API_KEY 和 GITHUB_TOKEN

# 2. 起服务
docker compose up -d

# 3. 注入第一个 Issue（手动测试）
./scripts/inject-issue.sh 42 "给 utils.py 加一个 reverse(s) 函数"

# 4. 看日志
docker compose logs -f orchestrator
```

## 目录结构

```
claude-code-247/
├── README.md                    本文件
├── ROADMAP.md                   5 周路线图
├── ARCHITECTURE.md              架构方案
├── docker-compose.yml           4 个服务：orchestrator + redis + runner-coder + qdrant(可选)
├── .env.example                 环境变量模板
├── orchestrator/                Python 长驻进程
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── main.py                  入口：调度循环
│   ├── db.py                    SQLite 状态机
│   ├── github_client.py         GitHub API 封装
│   ├── runner.py                拉起 Headless Claude 容器
│   ├── circuit_breaker.py       信用分与全局熔断
│   └── roles/                   四个角色的 system prompt
│       ├── planner.md
│       ├── coder.md
│       ├── reviewer.md
│       └── guardian.md
├── runner/                      Headless Claude Code 镜像
│   ├── Dockerfile
│   └── entrypoint.sh
├── .github/workflows/
│   ├── shadow-ci.yml            影子分支 CI
│   └── notify-orchestrator.yml  CI 完成回调
└── scripts/
    ├── setup.sh                 初始化 SQLite + 拉镜像
    └── inject-issue.sh          手动注入 Issue 到队列
```

## 运行模型

- Coder / Planner = `claude-sonnet-4-6`
- Reviewer / Guardian = `claude-opus-4-7`

修改在 `.env` 里：

```
PLANNER_MODEL=claude-sonnet-4-6
CODER_MODEL=claude-sonnet-4-6
REVIEWER_MODEL=claude-opus-4-7
GUARDIAN_MODEL=claude-opus-4-7
```

## 这是骨架，不是产品

读完 ARCHITECTURE 第 7 节"失败模式与对策"，再决定要不要给它真实仓库的写权限。
第 1 周建议只在测试仓库跑，第 5 周再考虑生产灰度。
