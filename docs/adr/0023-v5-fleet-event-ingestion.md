# ADR-0023 — v5 fleet 事件摄入与签名 provenance（ADR-B）

**Status:** Proposed (v5-P0) · 2026-06-10 · loop cycle 5

## Context
状态面是单机 SQLite（`~/.aedev/state.db`）；远程 worker 无法直接 append。
GR#5（先 event 后 view、可重建）必须跨机器成立。

## Decision
1. daemon 新增 fleet 路由：`POST /fleet/register`、`POST /fleet/claim`、
   `POST /fleet/heartbeat`、`POST /fleet/events`（批量 append）。
2. 事件新增 provenance 字段：`operator_id`、`worker_id`、`sig`
   （Ed25519，对 canonical JSON 签名）、`nonce`、`sent_at`。
3. 协调器验签后写入本地 events 表；验签失败 → 拒绝 + `fleet.rejected_event`。
4. schema 迁移：现有事件回填 `operator_id='owner'`；重建逻辑对缺省值
   向后兼容（GR#5 历史不破）。
5. worker 端 = `packages/runner` 的 CLI 适配层 wrap 成独立 agent
   （keep：adapters/evidence writer；refactor：任务获取改 claim 拉取）。

## Consequences
事件库成为多 producer 单 consumer；幂等键 = (worker_id, nonce)。
吞吐瓶颈可接受（5 worker 量级）。座舱/overview 代码无需改动——仍从
本地 events 派生。
