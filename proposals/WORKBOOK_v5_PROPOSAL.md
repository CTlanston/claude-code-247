# WORKBOOK v5 提案 · Standby Team → 5-User BYO-Worker MVP（rework r1）

> **状态：PROPOSAL（非 SoT）。** 经独立审查 rework 一轮后更新（判词存证
> `evidence/v4/loop-c3-review-v5-proposal.json`）。v1.5 P4 真实收口完成后
> 方可转正为 `WORKBOOK_v5.md`。当前 SoT 仍是 `WORKBOOK_v4.md`。

## 论点（一句话）

把已验证的单操作员 24/7 待命团队（v1.5）扩展为 **5 worker 的小队产品**：
每人自带订阅（BYO worker，本地登录自己的 Claude/Codex CLI），共享 GitHub
协作面与只读座舱，协调器只分配任务、**永不触碰任何人的 token**。
**MVP 退出 = 5 个隔离 worker（可模拟）soak 通过；5 个真人是 stretch。**

## 不可动摇的继承

1. Token 永不共享/上云/代理；每 worker 用自己的订阅 CLI。
2. 每 worker 各自的 P1 credit 护栏；构建不烧 per-token API。
3. Gemini 终局裁判、evidence-only；merge 永远人工。
4. 证据诚实（GR#7）：BYO 证据默认**不可信**，见 P2 信任锚。

## 关键架构决断（吸收审查发现）

- **状态面**：`~/.aedev/state.db` 是单机 SQLite，远程 worker 无法直接
  append。v5 增加 daemon **事件摄入路由**（`POST /fleet/events` 等），
  事件加 provenance 字段（`operator_id`、`worker_id`、签名指纹）。
- **push→pull 反转**：现行 daemon 经 `packages/runner` 直接 spawn 本地
  CLI（push）。v5 将 runner 的 CLI 适配层 **wrap** 进独立 worker agent
  （keep：claude/codex adapter、evidence writer；refactor：任务获取从
  函数调用改为 claim API；deprecate：无）。
- **证据信任锚**：worker 自报证据只作参考；**GitHub CI-on-PR 是唯一
  信任锚**（典型闸在 PR 上重跑）；协调器做差异检测（自报 vs CI 结果
  不符 → HOLD-EVIDENCE-MISMATCH）。
- **远程写闸的真实执行面**：协调器无法技术上阻止 worker 用自己的
  GitHub 凭证 push。强制面移到 **GitHub 侧**（repo 权限、branch
  protection、CODEOWNERS 保护 forbidden paths）；协调器只做检测+告警。

## PHASES（草案 r1）

### P0 — 前置收口 + 威胁模型
- v1.5 P4 真实 Draft PR 落地（硬前置）。
- ADR-A 多用户威胁模型（token 隔离、repo 授权矩阵、证据伪造、失控
  worker blast radius）；ADR-B fleet 事件摄入与签名 provenance。
- （可选）操作员的 AUTONOMOUS_FLEET_LOOP_SPEC 若入库，则 ADR 化并入。
- L1：两份 ADR 合入；P4 evidence 在库。

### P1 — 身份与隔离
- `operator_id`/`worker_id` 进事件/任务/成本计量；**含 schema 迁移 +
  历史事件回填规则（默认 `operator:owner`），GR#5 重建不破**。
- worker 注册（公钥指纹）；每 worker 独立 `AEDEV_HOME`。
- L1：双操作员事件按人重建用量；历史数据重建回归测试。

### P2 — BYO worker 握手 + 鉴权
- claim/heartbeat/evidence-upload API；**所有请求签名验证**（注册公钥），
  专属 L1 鉴权测试（坏签名/重放被拒）。
- 协调器只发任务说明+evidence 要求，永不发凭证。
- 断线任务回收重派；幂等 claim。证据信任锚按上节执行。
- L1：双 worker 并发认领无重复；kill -9 回收；伪造证据触发
  HOLD-EVIDENCE-MISMATCH。

### P3 — 只读小队视图 + 按人预算（已减脂）
- 只做：session 列表（谁在跑什么）+ 按人 credit 计数 + 按人 HOLD。
- 按人预算 UI、写操作面板**全部推迟**；写操作仍限 owner。
- L1：成员视图无写按钮（浏览器 smoke）；预算按人触发 HOLD。

### P4 — 5-worker soak（MVP 退出）
- 5 个隔离 worker（模拟即可）≥1 周：每 worker ≥1 真 Draft PR、零 token
  泄漏、零越权写、空闲零 credit、伪证检测至少触发一次（注入演练）。
- L1：soak 报告 + 全链 evidence 入库 → v5 done。

## 操作员决策点（不变）

1. 任务分发面：GitHub Issues（推荐）vs 自建队列？
2. 协调器部署：Mac+Tailscale vs 无密钥小 VPS？
3. 成员 Gemini key：各自带 vs owner 统一（validator-only）？
4. P0 ADR：循环起草后审，还是先给方向？
