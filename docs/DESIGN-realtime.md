# 实时刷新：触发机制方案（R 系列）

> 目标：Hades Lab 里的 run / step 信息**跟着对话走**——新事件落盘后，面板自己更新，不用手动点「刷新」。
> 本文只定**触发机制与刷新语义**，不改聚合口径（F133 的五段计时、F137 的 chip 规则都不动）。
> 现状：`Body` 只在挂载时取一次 `/runs`（缓存后切会话复用），之后完全静止。

## 1. 约束（这些决定了可选方案）

| 事实 | 数值 / 结论 | 出处 |
|---|---|---|
| 面板是 tab，同一时刻只有它或对话被渲染 | 面板可见 ⇒ 对话树不在 DOM（`renderSlot(..., {only})`） | `docs/REPORT-chat-perf.md` §1 |
| 但客户端 store 在后台仍然收事件 | 对话未渲染时 store 仍更新（面板与 chat 共用同一 session store） | `conversation.view` 的 `standardProps` |
| Host 冷聚合一次 | **42.8 ms**（17 955 事件） | `/health` `cache.lastBuild` |
| Host 命中缓存一次 | **~5 ms**（seq 未变） | bench-live P10 |
| 实时事件速率 | 活跃期 **0.81 事件/s**；平均事件间隔 11 s | 本会话实测 |
| 已有基建 | 客户端 LRU 缓存、`AbortController`、`/runs` 49.9 KB、`/step` 1.9 KB | F138 |

结论：**真正决定成本的是"多久刷一次"，不是"从哪儿得到通知"**。所以触发源应选最省事、最不容易失效的那个，再用短路 + 节流把成本压住。

## 2. 可选触发源

| # | 触发源 | 延迟 | Host 成本 | 客户端成本 | 改动面 | 失效场景 |
|---|---|---|---|---|---|---|
| A | **可见时轮询** `/runs?since=<seq>`（2 s） | 0–2 s | 未变 ~1 ms；变了 43 ms（≤1 次/2 s） | 1 请求/2 s，未变时 ~40 B | Host +40 行 / Client +30 行 | 页面隐藏时暂停即可；无 |
| B | **客户端 store 订阅**（`useChat(s => s.order.length)` / `useSession(s => s.running)`）→ 去抖后 `/runs?since` | 0.6–1 s | 只在真变更时 43 ms | 零轮询 | 纯客户端（依赖 standardProps 可用） | store 不推进（如子 agent/其他会话）时无触发；prop 契约需先验证 |
| C | **Host 推送**：`ctx.on('session/event')` → SSE `/stream` | <0.2 s | 每事件一次 tick（合并后 ≤2/s） | 1 条长连接 | Host +80 行（SSE + 生命周期）/ Client +40 行 | 中间层/代理缓冲 SSE；连接数需限一；断线要退避重连 |
| D | **长轮询** `/runs?since&wait=20s` | <0.2 s | 挂起连接 + 唤醒 | 1 连接/20 s | Host +60 行 / Client +20 行 | 每次变更都要重发 49.9 KB；多个面板会叠加挂起连接 |
| E | 手动刷新（现状） | 手动 | 0 | 0 | 0 | 用户忘了点 |

Host 侧可用的推送源已确认存在（Event 目录原文）：

```
'session/event'(this: Scoped<Session>, session: Session, event: SessionEvent): void
    Post-commit, fire-and-forget append feed.
```

即"每次 append 之后"的权威信号，带 `session` 与 `event`（含 `seq`/`type`/`time`）。

## 3. 推荐路线（三阶段，逐段可独立交付）

### R1（先做，1 天）可见时轮询 + `since` 短路

1. **Host**：`/runs` 接受 `since`：
   - 若 `snapshot.seq === since` 且探测未变 → 返回 `{ unchanged: true, seq }`（**~40 B**，不序列化 payload）；
   - 否则照旧返回完整 payload，并带 `seq`。
2. **Client**：
   - visible 时才开表：`document.visibilityState === 'visible'` 才 tick，隐藏即停（不占 CPU、不发请求）；
   - 节流：**trailing 去抖 600 ms + 最小间隔 2 s**，最多一条在途（复用 F138 的 `AbortController`）；
   - 命中 `unchanged` → 什么都不做（不 setState、不重渲染）；
   - 变更 → 保留 `expanded`/`details`，只替换 `payload`；对**已展开的 run** 另取 `/run`、对**已打开的 step** 另取 `/step`（各 ≤ 当前展开数，通常 1–2）。
3. **反馈**：表头加 `● 实时` / `⏸ 已暂停（页面不可见）` + 最近一次更新时间；hover 显示"每 2 s 检查一次"。

**成本核算**（3 分钟流式、240 个事件）：tick ≈ 90 次；未变 tick ~90 × 1 ms；变更 tick ≈ 40 × 43 ms ≈ **1.7 s Host CPU / 3 min ≈ 1% 单核**，客户端合计 ~3.6 MB 下载（未变响应 40 B 不占）。
**AC**：对话里发出指令后切到面板，**≤ 2 s** 出现新的 run/step 行；step 行的时间在流式过程中持续增长；页面隐藏 3 s 内不再发请求（DevTools 可见）；展开态与排序不因刷新丢失；`/health` 的 `lastBuild` 次数与真实变更一致。

### R2（可选，替换轮询）客户端 store 订阅

- 用 `conversation.view` 注入的 `useChat(s => s.order.length)`（`ChatSnapshot.order: readonly string[]`）或 `useSession(s => s.running)` 作为"有事发生"的信号，**事件到来才 tick**，空闲时零请求。
- 仍走 R1 的 `since` 短路与节流；先验证 standardProps 在我们的 occupant 上确实可用（一次日志即可），否则退回 R1。
- **AC**：idle 10 分钟 0 请求；事件到来 ≤1 s 内刷新；面板关闭后不再有订阅回调（effect 清理）。

### R3（真·推送，按需）Host `session/event` → SSE + 增量聚合

- `GET /stream?sessionId=&since=` 走 `text/event-stream`（先验证 DSH webServer 不缓冲；心跳 15 s；`retry` 2 s）。
- 同时把 `buildTraceTree` 改成**可追加**（缓存里保留 `events` 数组与最后 seq，只喂新增事件），把每次 43 ms 降到亚毫秒；这是"边聊边看"体验的上限方案，但改动最大（踩过 step 窗口/迟到事件的坑，必须补齐 40 个单测 + 新增 6 个增量用例）。

## 4. 刷新语义（三阶段共用）

| 对象 | 刷新规则 |
|---|---|
| run 表 | 全量替换 `payload.runs`；按 `idx` 做 key，展开态不变；排序键不重置 |
| 展开的 run | 重新取 `/run`，替换该 run 的 step 索引（新 step 出现在末尾） |
| 打开的 step | 重新取 `/step`，工具行里"正在跑"的那条从无结果变成有结果、耗时开始出现 |
| 展开容器/高亮 | 全部保持（键是 `run-<idx>` / `<runIdx>::<stepIdx>`，追加事件不会改它们） |
| FLIP 动画 | **仅当行顺序变化时动画**；纯数据刷新（顺序不变）不测 rect、不触发 FLIP（避免 155 行 × 每秒一次 layout 读取） |
| 缓存 | 刷新后失效该会话的 `cache.run`/`cache.step` 对应键；`cache.runs` 用新 payload 覆盖 |

## 5. 已识别的坑

1. **`load(true)` 目前会清空 `details`**（`setDetails(new Map())`）——实时刷新必须走"保留态"的刷新路径，否则每次刷新展开的 run 都塌回去。
2. **FLIP 的 `useLayoutEffect` 依赖 `[sort, sorted]`**，payload 一变就全表测 rect；需要改成"顺序未变则跳过"。
3. **流式中的 step 时间**：`stepModelMs = 最后一个 assistant/message − step/start`，step 未结束时显示"当前累计"，这正确，但 `step/end` 到达后会跳变一次（合理，需在 UI 上不闪烁）。
4. **`since` 的语义**：`seq` 是 Host 侧的日志偏移（`inspectSession(s => s.seq)`）；冷会话可能没有 live seq，退化时一律返回全量。
5. **页面隐藏时的状态**：恢复可见时应立即补一次（不等 2 s），否则用户切回来看到旧数据。

## 6. 分期与验收

| 阶段 | 交付 | 验收 |
|---|---|---|
| R1 | `since` 短路 + 可见节流刷新 + 实时徽标 | 见 §3 R1 AC；`bench-live` 增加 P12「unchanged 响应体积 ≤ 64 B、Host ≤ 2 ms」 |
| R2 | store 订阅替换轮询 | idle 0 请求；≤1 s 延迟；订阅随卸载清理 |
| R3 | SSE + 增量聚合 | 单次追加聚集合成 ≤ 5 ms；40 现有单测 + 6 增量用例全绿；断线自动重连 |

## 7. 建议

先落 **R1**：改动小（Host 一个 `since` 分支、Client 一个 tick），**2 s 内的延迟对"边聊边看"已经完全够用**，而且 `unchanged` 短路让空闲成本接近 0。
若你希望"事件一到就亮"，再上 R2（零轮询）；R3 留到有人抱怨 1 s 都嫌慢时再做——它值不了那个风险。
