# ADR-0022 — v5 多用户威胁模型（ADR-A）

**Status:** Proposed (v5-P0) · 2026-06-10 · loop cycle 5

## Context
v5 把单操作员系统扩展为 ~5 个 BYO worker。新攻击面：不可信的远程
worker 机器、自报证据、共享协作面。

## Threats & Mitigations
| 威胁 | 缓解 |
|---|---|
| Token 泄漏/共享 | token 永不离开 worker 本机；协调器 API 无凭证字段；红线测试 grep 任何凭证出现在 fleet 消息 → FAIL |
| 伪造证据 | GitHub CI-on-PR 为唯一信任锚；协调器对比自报 vs CI → 不符即 HOLD-EVIDENCE-MISMATCH + 冻结该 worker |
| 失控/恶意 worker 越权写 | 技术强制面在 GitHub：repo 权限最小化、branch protection、CODEOWNERS 保护 forbidden paths；协调器只做检测+告警+冻结 |
| 重放/冒名请求 | P2 全请求 Ed25519 签名（注册公钥）+ nonce+时间窗防重放 |
| credit 烧穿 | P1 cost guard 按 operator_id 分账；按人 HOLD-BUDGET |
| blast radius | worker 仅能 claim 被授权 repo 的任务；冻结 = 拒绝其后续 claim/事件 |

## Decision
采用"GitHub 为强制面、协调器为检测面、worker 为零信任端点"的三层模型。
## Consequences
协调器永不持有成员凭证 → 可部署在无密钥 VPS；伪证演练成为 v5-P4 soak
的必测项。
