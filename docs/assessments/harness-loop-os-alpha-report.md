# Harness Loop OS — Local Alpha Report (CloudHull, 2026-06-11)

> GR#7：每分附库内证据；real/simulated/unproven 显式分类。容器无真 CLI——
> strict real-smoke 的活体运行仍属操作员 Mac（脚本的诚实失败路径已在容器真实执行）。

## 评分（/10）
| 维度 | 分 | 证据 |
|---|---|---|
| 普通用户 UX | 8 | 5 卡默认 surface + 操作员词汇 + agent 高亮 + 卡上按钮；user-e2e 7/7（evidence/browser-cockpit-user-e2e/2026-06-11T15-49-51-555Z）；零原始码不变式组件测试 |
| 真实 E2E 证明 | 6 | 真 Draft PR 存在（hermus-agent#4，操作员产出）；strict/DEGRADED 语义+GEMINI_TIMEOUT+回归证据强制已单测（real-smoke-policy 38 测试）；**活体 strict PASS 待 Mac（claude login）** |
| 安全 | 9 | 双闸白名单、owner-gate 403、凭证红线（提交名/卡/fleet 全覆盖）、GR#10 无任何 auto-merge 路径（merge-policy 864 组合穷举）、redteam CI 绿 |
| 多用户就绪 | 7 | submittedBy+迁移 v9+按人分组+owner-only 三闸+审计记名（c5，+34 测试）；**真双设备 Tailscale 走查待操作员** |
| 运维/恢复 | 8 | /ops/overview（holds 人话/引擎就绪/远程写闸/建议恢复，事件派生零探测）+ Ops 页（c6，+14）；Claude 401 → "needs login on this Mac" |
| 剩余 HOLD | — | ①HOLD-PLANNER-AUTH（Mac claude login）②真 Gemini 判词 artifact 入库 ③真双设备多用户走查 ④一周真实 soak |

## Definition-of-done 对照
确定性三套件 PASS（c0）✅ · validator 无模糊 pending（GEMINI_TIMEOUT 终态）✅ ·
strict/fallback 诚实分类（DEGRADED 永不算 strict PASS）✅ · 回归证据强制
（REGRESSION_EVIDENCE_MISSING）✅ · 5 卡默认不变 ✅ · 多用户本地提交/观察 ✅ ·
owner-only 保护 ✅ · 无 auto-merge ✅

## 分类
Real：1036 tests、浏览器 E2E（真 chromium）、容器内脚本诚实失败路径、hermus#4。
Simulated：E2E/soak 引擎侧（自报）。Unproven：strict 活体 PASS、真判词、双设备走查、周 soak。
