# WORKBOOK v5 提案 · Standby Team → 5-User BYO-Worker MVP

> **状态：PROPOSAL（非 SoT）。** 经操作员书面批准、且 v1.5 P4 真实收口
> （真 Draft PR + evidence）完成后，方可转正为 `WORKBOOK_v5.md`。
> 当前 SoT 仍是 `WORKBOOK_v4.md`。

## 论点（一句话）

把已验证的单操作员 24/7 待命团队（v1.5）扩展为 **5 人左右的小队产品**：
每人自带订阅（BYO worker，本地登录自己的 Claude/Codex CLI），共享 GitHub
协作面与只读座舱，协调器只分配任务、**永不触碰任何人的 token**。

## 不可动摇的继承（来自 v4 谈判与 CLAUDE.md）

1. Token = 账号凭证：永不共享、永不上云、永不代理（阶段 2 共识）。
2. 构建不烧 per-token API；每用户的 headless 调用走各自的 P1 credit 护栏。
3. Validator 只看 evidence；Gemini 终局裁判不变；merge 永远人工。
4. 远程写双闸（全局开关 + per-repo 白名单）按用户再加一维：
   **每 worker 只能写自己被授权的 repo**。
5. 先 event 后 view；phase 由验收闸控；证据诚实。

## PHASES（草案，待谈判）

### P0 — 前置收口 + 威胁模型
- v1.5 P4 真实 Draft PR 落地（硬前置，不可跳过）。
- `AUTONOMOUS_FLEET_LOOP_SPEC.md` 入库并 ADR 化为循环规范。
- ADR：多用户威胁模型（token 隔离、repo 授权矩阵、evidence 归属、
  恶意/失控 worker 的 blast radius）。
- L1：两份 ADR 合入；P4 evidence 在库。

### P1 — 身份与隔离
- `operator_id` 进事件/任务/成本计量（cost.headless_call 按人记账）。
- 每 worker 独立 `AEDEV_HOME`；worker 注册信息含公钥指纹。
- L1：同库双操作员事件可按人重建用量；越权写被拒的单测。

### P2 — BYO worker 握手协议
- worker 注册/心跳/任务认领（claim）API；协调器只发任务说明 +
  evidence 要求，不发任何凭证。
- 断线/超时任务自动回收重派；幂等 claim。
- L1：双 worker 并发认领无重复执行；kill -9 一个 worker 任务可回收。

### P3 — 共享座舱（先只读）+ 按人预算
- 座舱多 session 视图：谁在跑什么、各自 credit 计数、holds。
- 写操作（approve/start/create-pr）仍限 repo owner；成员只读 + 认领。
- L1：浏览器 smoke 证明成员视图无写按钮；预算按人触发 HOLD。

### P4 — 5 人试点 soak
- 真实 5 用户（或 5 个隔离 worker 模拟）跑 ≥1 周：每人 ≥1 真 Draft PR、
  零 token 泄漏、零越权写、空闲零 credit。
- L1：soak 报告 + 全链 evidence 入库 → v5 done。

## 操作员需要拍板的点

1. 任务分发面：GitHub Issues（推荐：天然鉴权+审计）vs 自建队列？
2. 协调器部署：仍在你 Mac（朋友圈内网/Tailscale）vs 小 VPS（只跑无密钥
   协调器）？
3. 成员的 Gemini validator key：各自带，还是 owner 统一出（validator-only
   预算可控）？
4. P0 的两份 ADR 由循环起草后你审，还是你先给方向？
