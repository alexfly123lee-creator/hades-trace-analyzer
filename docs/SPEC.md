# Trace Lab · 规格（SPEC）

> 当前生效的契约与不变量。历史决策见 `git log`（每条提交都写了"为什么"）。

## 1. 数据模型

```
session → run（一次指令）→ step（一次 agent loop）→ operation（一次模型/工具/注入）
```

| 概念 | 判定 |
|---|---|
| run | 真实用户消息开启新 run：`user/message` 且 `data.source.kind === 'user'` |
| run0 | 第一条真实用户消息之前的全部事件 = 系统提示词（`isSystemPrompt`，`prompt = null`） |
| 运行时注入 | `source.kind ≠ 'user'` 的 `user/message`（runtime-context / skill-catalog / time-context）**不**开新 run |
| step 边界 | 日志自带 `step/start` / `step/end`；有 `data.step` 时按它归组，否则归当前打开的 step；`turn/end` 之后的迟到事件不粘到上一步 |
| step 编号 | 按出现顺序重排 1..n（原始编号在子代理委派下会交错/重置） |
| 空 run 尾 | 无 prompt 的续跑（followup）留在当前 run，标签用「续跑」兜底 |

### 计时口径

- `step 耗时 = 模型时间 + 工具时间`，**不含人机等待**。
- 模型时间 = `assistant/message.time − step/start.time`（无 assistant 消息则无此项）。
- 人机等待 = `ask_user_question` / `exit_plan_mode` / `plugin_manager` 且耗时 ≥ 5s，单独显示为 `⏸`。
- `run 耗时 = Σ 各 step 的（模型 + 工具）`。
- KPI 的 `slow` / `slowest` 与 run 的 `hasSlow` 同样排除人机等待。

### token

`input / output / cacheRead / cacheWrite / reasoning` 全部来自 `assistant/message.data.usage`，缺失记 0。run 的 token = 其 step 之和；step 行与 run 行显示同一口径。

## 2. 路由契约（Host，只读）

前缀 `/api/trace-analyzer`，GET，经 `connection.requestRejection` 围栏；失败统一 `{code, message}`。

| 路由 | 参数 | 返回 |
|---|---|---|
| `/runs` | `sessionId`、可选 `since` | `{header, meta{sessionId,slowMs,serverMs,generatedAt,seq}, counts{events,runs,steps}, tokens{total}, kpi{errors,slow,abnormal,slowest}, runs[{idx,prompt,isSystemPrompt,actor,stepCount,token,time,startTime,endTime,hasError,hasSlow}]}` |
| `/run` | `sessionId`、`idx` | `{idx, prompt, isSystemPrompt, actor, startTime, endTime, slowMs, steps[{step,startTime,endTime,timeMs,modelMs,toolMs,waitMs,token,hasError,title,tag,tags?,marks?,text}]}` |
| `/step` | `sessionId`、`idx`、`step` | `{idx, step, start/endTime, timeMs, modelMs, toolMs, waitMs, model{provider,model}, usage{...}, counts{models,tools,contexts}, slowMs, operations[]}` |
| `/event` | `sessionId`、`seq`、可选 `before/after` | `readEvent` 原文窗口（仅点开 RAW 时调用） |

`operations[]` 的 kind：`assistant{seq,time,text,usage}` / `tool{seq,callSeq,resultSeq,name,args,result,error,isError,durationMs,startTime,endTime}` / `context{seq,time,text}` / `system{seq,time,text}` / `note{noteKind,seq,time,text}`。行序 = 事件 `seq` 序；工具结果折叠进它的 call 行。

循环探针（仅 loopback，返回常量与体积/耗时，无会话内容）：`/health`、`/bench?sessionId=latest`。

### 快照与缓存

- Host：每会话一条快照 `{seq, header, eventCount, tree, tokens, tools}`，LRU 4；版本键 = `inspectSession(s => s.seq)`，未变则只做纯投影。
- 活跃会话走 `inspectSession(... session.snapshotEvents())`（约 0 ms）；冷会话回退 `readSession`。
- 原文事件 LRU 256（事件写入后不变）。
- Client：`runs 6 / run 40 / step 240 / event 160` 四条 LRU；切回会话、重复展开零请求。

## 3. 客户端不变量

1. 首屏只拉 `/runs`；展开 run 才 `/run`；点开 step 才 `/step`；点 RAW 才 `/event`。
2. 实时：每 2s 以 `?since=<seq>` 轮询；`unchanged` 只回 ~40B 且客户端不写状态；页面隐藏时暂停。
3. 可见变化签名（counts + token 总计 + 尾行）不变就不重渲染；用户滚动中到达的数据延后 240ms 应用。
4. 打开落在实况边缘（最新 Run 在底部），并"跟随"；向上滚动即释放跟随，出现「↓ Latest」pill。
5. 指针扫过矩阵 = 聚焦该列对应的 Run（整表压暗，焦点行全亮）并滑到视口 34% 焦点线；点击 = 打开该 Run 并停在列表顶部（`hoverLock`：之后指针移动只换高亮，不再滚动）。
6. 矩阵命中必须按几何解析、卡片级清空（详见 DESIGN §4.1）。**回归红线**：缝隙/卡内死区不得丢失 hover。
7. 焦点高亮由渲染结果驱动（`syncFocusRow` 每次提交重放），不得只写一次命令式 class。
8. 展开/收起只动高度与底色；括号的边框宽度与 margin 在两个状态都预留，避免开合先位移再生长。
9. Step 内容：REPLY / 工具名 / CTX 三张卡片，args 与 result 直接展开，RAW 是卡片底部默认收起的下拉；外层注入卡片合并为 `CTX ×N`。
10. 长 run 分页（每页 80 步 + 「显示全部」）；超过 60 步的 run 不做高度动画，改 160ms 淡入。
11. 深/浅色由 `body[data-ds-dark-theme]` → 面板根 `data-hades-theme` 驱动，纯 CSS 变量，无运行时调色板改写。
12. 面板 UI 文案为英文常量；locale 服务只承载视图环标题「Trace Lab」。

## 4. 性能门槛（本机实测，会话 36.7k 事件 / 244 run / 5092 step）

| 指标 | 门槛 | 实测 |
|---|---|---|
| `/runs` payload | ≤ 350 B/run | 79 KB / 244 run ≈ 324 B/run |
| `/runs` 服务端（warm，快照命中） | ≤ 30 ms | 12 ms |
| `/runs` 服务端（cold，重建树） | ≤ 200 ms | 118–142 ms（每次 seq 变化重建一次） |
| 首屏 JSON.parse（客户端） | ≤ 5 ms | 0.1–0.2 ms |
| `/run` | p90 ≤ 20 KB | 16.7 KB |
| `/step` | p95 ≤ 4 KB | 1.8 KB |
| RAW 首屏渲染 | ≤ 20 000 字符 + 「show all」 | 同 |
| 空闲 CPU | 命中时 < 1% 单核 | 轮询命中只回 40 B |

> 已知代价：快照按 `seq` 失效，流式会话每个 2s tick 若日志增长就重建一次树（≈120 ms Host 侧 CPU）。增量建树未做。

## 5. 不在范围内（v1）

跨会话对比、血缘树、导出、搜索过滤、事件溯源链 UI、时间轴缩放。
