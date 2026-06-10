# E2E 验收量规 — 循环终止条件（"90%"的可测量代理）

> 终止条件：**≥90%（≥18/20）通过且每项有落盘证据**。
> "像 Anthropic 内部 7×24 系统"不可直接测量（无人持有内部信息）；本量规
> 是经操作员授权的代理：公开最佳实践 + 本 repo 谈判定下的工作簿能力面。
> 归属标注：[C]=云循环可完成 · [O]=必须操作员 Mac 执行。

| # | 能力 | 状态 | 证据 |
|---|------|------|------|
| 1 | 澄清门槛 ≥95% 服务端强制 | ✅ | v3-P2 409 测试, server.test.ts |
| 2 | 引擎分工(Claude 规划/Codex 编码, 订阅 CLI) | ✅ | v3-P1 evidence + 测试 |
| 3 | 跨引擎 review + 上限返工 | ✅ | v4-P2 claude-reviewer + runner 测试 |
| 4 | Evidence-only 终审硬门槛(Gemini) | ✅ | v3-P4 create-pr 阻断测试 |
| 5 | headless 计量 + 预算 HOLD | ✅ | v4-P1 budget 测试 |
| 6 | 24/7 watchdog(空闲零 LLM) | ✅ | v4-P3 模拟时钟测试 |
| 7 | 团队记忆 T1+T2 + 每晚 Compiler | ✅ | v3-P5 + v4-P3 测试 |
| 8 | 大任务 DAG 执行 | ✅ | v3-P6 per-node 测试 |
| 9 | Hold-on-blocker + ntfy | ✅ | v4-P1/P3 notify 事件测试 |
| 10 | 事件溯源可重建 | ✅ | GR#5 各重建测试 |
| 11 | 远程写双闸 + per-repo 白名单 | ✅ | v4-P4 REPO_NOT_WHITELISTED 测试 |
| 12 | 真实 Draft PR 出口 [O] | ❌ | 待操作员开闸 E2E |
| 13 | 当前 main 上的真订阅 CLI 全链 E2E [O] | ❌ | 06-10 的跑在旧 checkout |
| 14 | 多用户身份/隔离(operator_id+迁移) [C] | ✅ | v5-P1: migration v7, 读时回填, 按人预算; db/migrations/budget-guard 测试 |
| 15 | BYO worker claim 协议 [C] | ❌ | v5-P2 |
| 16 | worker 请求签名鉴权 [C] | ❌ | v5-P2 |
| 17 | 证据信任锚(CI-on-PR+伪证检测) [C] | ❌ | v5-P2 |
| 18 | 只读小队视图 + 按人预算 HOLD [C] | ❌ | v5-P3 |
| 19 | 5-worker soak [C 可模拟] | ❌ | v5-P4 |
| 20 | 循环自进化(review→rework→merge 判词落盘) | ✅ | cycles 0-3, evidence/v4/ |

**当前分数：14/20 = 70%。** 距终止线差 5 项：其中 [C] 6 项循环可自建
(14-19，取 5 即达标)，[O] 2 项(12-13)是操作员专属——若操作员完成 12-13，
则只需再建 3 项 [C]。

更新规则：每个 cycle 结束时由循环如实更新本表，禁止无证据打勾(GR#7)。
