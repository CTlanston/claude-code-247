# Ordinary-User Loop OS — Gap Assessment（v6 前置评估）

> 日期 2026-06-11 · 基线 main（818 tests / 0 failed）· 评估者：会话循环
> 诚实规则（GR#7）：每个分数附证据路径；real / simulated / unproven 显式分类。

## 1. 能力评分

| 能力 | 分 | 依据（证据路径） |
|---|---|---|
| 单操作员循环 | 9/10 | v4 P0–P4 全合并；818 tests；`evidence/v4/LOOP_TERMINATION_REPORT.md`。缺：真 PR 出口 |
| 普通用户 UX | 6/10 | `packages/daemon/src/user-state.ts`(10 态+33 测试)、loopSummary、人话化 409/闸卡；浏览器 E2E 7/7 `evidence/browser-cockpit-user-e2e/2026-06-10T18-46-50-514Z/`。缺：正式 5 卡协议、onboarding、用户理解验证 |
| 真实 E2E 证明 | 4/10 | 操作员口头报告 06-10 两次真链路 PASS（planner=claude/coder=codex/gemini=pass），**证据仅在操作员 Mac，未入库**；仓库内无真实 Gemini 判词 artifact、无真实 Draft PR |
| 递归 planner | 2/10 | 循环由会话驱动（cycles 0–8 账本），无仓库驻留的自规划模块；watchdog/soak 是调度不是规划 |
| BYO fleet | 7/10 | 协议+worker+soak 装置 5/5 PASS `evidence/fleet-soak/2026-06-11T00-45-40-015Z/`（**模拟执行器**）；无真实多机 |
| 安全/安全性 | 9/10 | 双闸白名单、凭证红线、伪证冻结、威胁模型 ADR-0022/0023、redteam CI；无 auto-merge（by design） |

## 2. 剩余差距（精确）

1. **真实 Draft PR 出口**（rubric #12）— 操作员 Mac 开闸，runbook `docs/operations/P4-first-real-draft-pr.md`
2. **当前 main 真 CLI E2E + 证据入库**（#13）— 含真实 Gemini 判词 artifact（#27-H1 的残留要求）
3. **一周真实 soak**（#19）— 装置就绪，缺 launchd/恢复/挂起状态契约（v6 列入）
4. **5 卡通信协议未正式化** — userState 是基础，但 Understanding/Plan/Progress/Blocker/PrReady 卡的字段契约不存在
5. **README 下 2/3 仍描述已删除的 Python 双内核**（#27-H3 残留；P0 仅改了横幅+链接）
6. **递归 planner 不存在**（v6 第五交付物）
7. 操作员侧未推：Mac smoke 补丁、06-10 真实证据文件

## 3. Real / Simulated / Unproven

- **Real**：818 单元/集成测试；浏览器 E2E（真 chromium，mock 引擎）；CI 全绿记录；soak 的 HTTP/Ed25519/冻结路径
- **Simulated**：E2E 与 soak 中的 planner/coder/validator（fixture/template/fake executor）——已在各报告中自报
- **Real but 未入库**：操作员 06-10 两次真链路 run（口头报告，repo 无文件）
- **Unproven**：真 Draft PR、仓库内真 Gemini 判词、周级 soak、真多机 fleet、普通用户可理解性

## 4. WORKBOOK_v6 阶段计划（提案）

- **V6-P0 收口对齐**：关 #27/#28（见 §5）、README 全文与现实对齐、v6 成为 SoT
- **V6-P1 通信协议**：`docs/product/LOOP_COMMUNICATION_PROTOCOL.md` 5 卡字段契约 + daemon 卡片派生（机器码保留于 data 层）
- **V6-P2 卡片化座舱**：UI 只渲染 5 卡；浏览器 E2E 证明"不读日志即知下一步"
- **V6-P3 真实证明收口**：#12/#13 操作员协同（evidence 目录契约+真 Gemini 判词 artifact+操作员缺席 fail-closed 测试，吸收 #28-F0）
- **V6-P4 递归 planner**：最小安全自规划（脏树/红测/超预算/SoT 歧义即拒绝；cycle ledger；止于 Draft PR）
- **V6-P5 soak 运营化**：launchd/恢复命令/ntfy/soak-pending 状态 artifact
- **V6-P6 普通用户验收**：可用性 E2E + 终评分。优先级全程：安全证据 > 普通用户 UX > 自动化 > fleet 规模 > 打磨

## 5. PR #27 / #28 处置决定

- **#27（v3.1 硬化）→ 建议 CLOSE（superseded）**：H1 validator 接线已在 v3-P7 完成；H4 小修已在 v4-P0 完成；**残留 H2（注册 repo 真 E2E）与 H3（README 正文）已分别并入 V6-P3 / V6-P0**，不丢失
- **#28（同名 WORKBOOK_v4 fleet F0–F6）→ 建议 CLOSE（superseded）**：与已合并的 WORKBOOK_v4 同名冲突（基线 a7d400f，落后 49 commits）；F2/F3/F5 已被 v5 fleet 协议以不同路线实现；F4 auto-merge 与现行硬规则冲突（本周期禁止）；**可取之处已吸收**：F0 的"真 Gemini 真 diff 判词 + 操作员缺席 fail-closed 测试"并入 V6-P3
- 两个 PR 均不可盲合：基线过旧必然冲突，且 #28 会覆盖现行 SoT

**操作员决策请求**：批准本评估（merge 本 PR）即授权按 §4 撰写 WORKBOOK_v6；#27/#28 的 close 由你执行或授权我执行。
