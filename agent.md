# Trace 分析面板插件 — 概要设计

> 面向 DeepSeek Harness（DSH）的 trace 日志分析面板插件。本文档记录需求澄清结论、技术底座、架构设计与实施顺序，作为后续实现与 Spec 的单一事实来源。
>
> 运行时版本锚点：`sessionQuery` 服务及 `SessionEvent*` 类型来自当前运行安装的 Cordis 运行时 Inspection，非记忆推断。

## 0. 交付铁律（每次交付前必做，最高优先级）

> 这是本项目的**第一优先级**操作规范。任何改动在向用户说「完成」之前，必须先完成**端到端交付验证**，并把**真实结果**如实报告。禁止用「应该没问题」「刷新看看」「语法通过」这类未经验证的表述当作完成。

### 0.1 硬性要求

1. **不得把「语法通过 / 单测通过」当作「完成」**。语法与单测只能证明没有语法/纯函数错误，不能证明改动在真实运行时**真正生效**。
2. **必须做端到端验证**，至少包括：
   - 改动是否真的被运行时加载（例如：抓取运行中服务端实际返回的 client bundle / 路由响应，确认新代码真的被吐出，而不是只检查磁盘文件）。
   - 界面/行为是否真的变化（抓取实际渲染产物、检查关键标记是否出现、或拿到用户屏幕/真实运行态证据）。
   - 关键数据是否真实正确（例如：run 切分、耗时、token 统计）。
3. **报告真实结果**：明确写出「验证了什么、真实结果是什么」。若某一步**没有验证到**，必须标注「未验证」及原因，并**不得**宣称已完成。
4. **验证通过才可说完成**；验证不过就继续修，不把验证动作甩给用户（例如只说「你刷新看看」）。
5. **每次交付附带验证清单**：列出验证项、各自通过/失败/未验证，以及证据（抓取到的关键标记、命令输出、测试结果）。

### 0.2 交付前标准检查清单（每次都要跑）

- [ ] `node --check` 语法校验（client / index / lib）。
- [ ] 纯函数单测 `node --test`（如有改动）。
- [ ] JSON / package 校验。
- [ ] **端到端**：从运行中的服务抓取实际生效的产物，确认新代码/新文案真的被加载（例如 fetch 服务端 bundle 并 grep 关键标记）。
- [ ] 对照改动逐条核对真实结果，未验证项明确标注。
- [ ] **样式遵循 `docs/DESIGN.md` §5**（DSH design tokens；禁止写死颜色/圆角/加粗，颜色只用 `--dsw-alias-*`）。
- [ ] 文档（agent.md / SPEC / TEST / DESIGN / DETAIL）与代码保持一致。

### 0.3 本次教训（记录在案）

- 「Hades Lab 改名生效、但时间线仍是旧样式」——根因是我只改了「时间线」tab，而用户默认看到的是「概览」tab 的柱状图（同样存在空白浪费的旧布局）。我在未确认用户实际所在 tab、未做端到端视觉验证的情况下，两次宣称「已修复/已生效」，浪费了用户时间与 Token。
- 教训：**凡收到「没生效」的反馈，先定位用户实际看到的是哪个界面 / 哪条渲染路径，再做端到端验证，最后才下结论；绝不未经验证就宣称完成。**
- 「Hades Lab 加载奇慢 vs 轨迹瞬间」——先用真实会话量化：首屏 payload 26.7 MB、`JSON.parse` 107 ms、建树仅 16.7 ms，才确定瓶颈是**下行体积/解析**而非聚合计算。
- 教训：**性能问题必须先量化（payload 字节数、parse/序列化毫秒数、请求次数），再动手；交付时必须给出改造后的真实数字，禁止用「应该变快了」结案。**

## 1. 目标与背景

用户反馈：系统自带的 trace 记录面板（即会话的「轨迹 / Trajectory」视图）「非常难用，没有产品化可视化能力」，只能看到原始 JSON，没有时间线/分组、看不到血缘/子任务关系、没有搜索过滤、也看不到性能/token 开销。

目标：新建一个独立的 trace 分析面板插件，把 DSH 的事件溯源日志（Session event log）变成可读、可过滤、可定位瓶颈、可导出分析结果的产品级可视化界面。

## 2. 需求澄清结论（用户确认）

| 维度 | 结论 |
|---|---|
| 形态与位置 | 主对话区视图环（`conversation.view` 槽，紧邻内置「轨迹 / Trajectory」），名「Hades Lab」；点击视图环上的「Hades Lab」Tab 打开 |
| 分析范围 | 仅当前会话，跟随当前 session 走 |
| 核心可视化 | 事件时间线/瀑布图、会话血缘树、Token 用量统计、耗时/性能分析 |
| 增强需求 | 异常工具链调用自动高亮（token 消耗大、耗时长等） |
| 实时性 | 实时跟随（增量更新）+ 手动刷新快照 |
| 主要痛点 | 全部：原始 JSON 难读、无时间线/分组、无血缘、无搜索过滤、无性能/token |
| 附加能力 | 导出（JSON/JSONL/复制）、深浅色主题适配 |
| 本地化 | 未勾选，但按 DSH 规范 UI 文案必须走 locale 服务；中文优先，英文兜底 |

## 3. 技术底座（已通过 Inspection 验证）

### 3.1 Trace 的本质

DSH 的「trace」= 会话事件日志（event-sourced Session log）。每个会话是一条有序 `SessionEvent` 序列，字段为：

```
SessionEvent = { type, seq, time, data, ignorable?, surfaceOp?, sourceEventSeqs? }
```

- `seq`：会话内单调递增序号（`SessionSeq`）。
- `time`：事件时间戳（epoch ms）。
- `surface`：`current | shadowed | log-only`（当前有效 / 被替换遮蔽 / 仅日志）。
- `sourceEventSeqs` / `surfaceOp`：事件溯源链 —— 哪些事件被替换、哪些是来源。

已知事件类型（`SessionEventMap`，未截断部分见 §3.3）：

```
turn/start, turn/end, step/start, step/end,
user/message, developer/message, system/message,
assistant/message, assistant/attempt,
tool/call, tool/result,
request/header, request/context, session/end-seed, …（更多，见运行时）
```

关键事件数据形态：

- `assistant/message` → `{ turn, step, message, stream: AssistantStreamRecord[], usage?: TokenUsage, interrupted? }`
- `tool/call` → `{ turn, step, callId, name, arguments }`
- `tool/result` → `{ turn, step, message, error?, meta? }`
- `request/header` → `{ header: EpochHeader, reason, startsSeries? }`
- `TokenUsage` → `{ inputTokens, outputTokens, totalTokens?, cacheReadTokens?, cacheWriteTokens?, reasoningTokens? }`

### 3.2 只读数据源：`sessionQuery` 服务（Host）

面板所需数据全部来自该服务的只读方法：

| 方法 | 返回 | 用途 |
|---|---|---|
| `listEvents(sessionId)` | `SessionEventRecord[]`（seq/type/time/surface） | 时间线骨架 |
| `readEvent({sessionId, seq, before?, after?})` | `SessionEventWindow`（完整事件 + 上下文窗口） | 事件详情 |
| `traceSession(sessionId)` | `SessionLineageTrace`（祖先 + 后代树 + 根） | 血缘树 |
| `traceEvent({sessionId, seq})` | `SessionEventTraceObservation`（替换链 + 来源/派生） | 事件来源追溯 |
| `filterEvents(sessionId, filters)` | `SessionEventSearchDocument[]`（语义文本） | 搜索过滤 |
| `readSession(sessionId)` | `SessionLogSnapshot`（完整原始事件日志） | 快照/导出 |
| `readSurface(sessionId)` | `SessionSurfaceSnapshot` | 当前模型表面 |
| `listSessions` / `filterSessions` | `SessionRecord[]` | （预留，跨会话扩展用） |

### 3.3 重要类型（节选，来源：运行时 Service Inspection）

```
SessionEventRecord  { sessionId, seq, type, time, surface }
SessionEventWindow  { session, inheritedEventCount, target, events, startSeq, endSeq }
SessionLineageTrace { target, ancestors, descendants: SessionLineageNode[], (complete + root) | (incomplete + unresolvedParentId) }
SessionLineageNode  { session: SessionRecord, descendants: SessionLineageNode[] }
SessionEventTraceObservation { target, replacedBy?, replacementChain, replacedEventSeqs, sourceEventSeqs, derivedEventSeqs, session }
SessionHeader       { version, id, createdAt, cwd?, parentSession?, isSeeded, origin?, delegationDepth?, agentPreset? }
SessionRecord       { header, live, persisted, formatStatus? }
```

> `SessionEventMap` 的完整事件类型清单在运行时返回中被截断，实现时以 `cordis_inspect_query` 的 `sessionQuery` 精确契约为准补全。

### 3.4 信息架构（最终定稿）

经多轮澄清，最终对齐 DSH 原生事件模型，树形结构为：

```
session
└─ run（一次指令；统计单位，0-based：run0, run1, … runN）
   ├─ 标签 = `run N · <触发它的真实用户 prompt 文本>`；run0 恒为「系统提示词」
   └─ step（迭代，step/start → step/end；一次 agent loop）
      └─ 操作（request / assistant / tool call+result …）
```

术语对照（含历史叫法，避免再次混淆）：

| 概念 | 含义 | 曾用叫法（已弃） |
|---|---|---|
| `run`（一次指令） | 一条真实用户指令的完整执行；统计/分组单位 | 曾叫「turn」「回合」 |
| `step`（迭代） | 一次「调模型→调工具」循环 = 一次 agent loop | 曾叫「turn」 |
| 系统提示词 | run0（第一条真实用户指令之前的 system/developer message） | — |
| `user/message` | 触发 run 的指令文本（仅 `source.kind === 'user'` 计为真实用户输入） | 作为 run 标签，不单设层 |

**run 的切分规则（已定稿，关键）**：

- 只有**真实用户消息**才开启新 run：`user/message` 且 `data.source.kind === 'user'`。
- 运行时注入的上下文（`runtime-context` / `skill-catalog` / `time-context` 等 `source.kind ≠ 'user'` 的 `user/message`）**不**开启新 run，归入当前 run 或 run0。
- **run0 = 系统提示词**：第一条真实用户指令之前的所有事件（`system/message`、`developer/message`、运行时上下文注入等）聚合为 run0，`isSystemPrompt = true`、`prompt = null`。
- 因此 run1 才是第一条真实用户指令（用户的第一条 prompt），与直觉一致。

长程任务的坑（已处理）：

1. **follow-up 续跑**：agent 会 `followup()` 自我唤醒、无新真实用户 prompt 时继续跑。此时这些事件仍挂在**当前 run** 下（不另开 run）；若确无 prompt，标签以「续跑」兜底。
2. **step 编号重置**：step 编号每个 run 从 1 起；step 嵌套在所属 run 下，天然不撞号。实现上**按事件自带的 `data.step` 分组**（assistant/tool/result 都带 step 号），分组后**按出现顺序重编号为 1,2,3…**（原始 step 号在 subagent 委派下会交错/重置，不可靠）。
3. **`step/start` 早于 `user/message`**：系统提示词与用户指令同处 step 1，`step/start` 可能出现在触发它的 `user/message` **之前**。因此 `turn/*`、`step/*` 标记事件**不参与分组**（只作状态参考）；run 与 step 的时间/耗时都以**叶子事件 `time` 的最小/最大值**计算（单调递增、恒非负、口径一致），而非 step 起止（会把 step 起止错配到 run 切分点，产生负耗时/空 step）。
4. **异常结束**：`turn/end.reason ≠ completed`（error / aborted / interrupted…）时对应 run 标红（`turn/start`、`turn/end` 不参与 run 切分，仅作状态参考）。

## 4. 架构设计

### 4.1 总体形态

一个「bundle」（Host 半 + Client 半），非单文件装饰插件：

- **Host 半**（`index.js`）：`export function apply(ctx, config)`，负责把 `sessionQuery` 的只读方法包装成 Client 可调用的数据通道，并声明 `Config`（异常高亮阈值等）。
- **Client 半**（`client.js`）：`window.__ModuleLoader__.load({ id, factory })`，注册主对话区视图（`conversation.view` 槽），用 React 渲染分析界面。
- **资源**：`cordis.patch.yml`（插入 Host 行）、`locale/*.json`（meta.title/meta.description + UI 文案）、`icon.svg`、`docs/DETAIL.md`。

### 4.2 扩展点与形态（已确认，来自 `@deepseek-ai/dsh-client-ui-conversation` / `dsh-client-ui-trajectory` 源码）

主对话区视图环（与内置「对话 / 轨迹」同一排 Tab）由 `conversation.view` 槽提供（`@deepseek-ai/dsh-client-ui-conversation` 声明）：

1. **client `inject` 声明槽来源**：`@deepseek-ai/dsh-client-ui-conversation` + `@deepseek-ai/dsh-client-locale`（+ `@deepseek-ai/dsh-client-ui-session`）。最小集为 `['slots', 'locale']`。
2. **视图注册**：`ctx.slots.inject('conversation.view', () => ctx.slots.register({ name:'conversation.view', id, order, locale:NS, label:()=>t('view.title'), inject:(sessionId)=>({ sessionId }) }, Body))`，返回 disposer。
   - `id`：实现身份，全局唯一（本插件 `VIEW_ID = 'hades-eye'`）。
   - `order`：视图环排序；内置轨迹为 `order: 10`，本插件 `order: 11`（紧邻「轨迹」右侧）。
   - `label()`：Tab 文案函数，返回 `t('view.title')`（zh/en「Hades Lab」）。
   - `inject(sessionId)`：视图每次打开时回调，返回注入给 Body 的 props（这里透传 `sessionId`）。
3. **Body 组件 props**：框架注入标准 `ConvViewProps`（`useSession`/`useTrajectory`/`useDuration`/`renderSlot` 等）+ 上一步 `inject` 返回的 props + 由 `locale:NS` 注入的 `t`。本插件只用 `{ sessionId, t }`。

可发现性：视图环 Tab 即入口，无需 guide 卡片或会话头按钮（已移除）。

### 4.3 数据桥（Host ↔ Client）

`sessionQuery` 的方法无 `@Remote`，Client 不能直接调用。采用**已证实**的路由方案（同 `@deepseek-ai/dsh-api-session-controller` 的 `SessionMediaReferences`，其在认证 `connection.fetch` 通道挂 `GET /api/file`）：

- **Host**：`ctx.webServer.register(route)` 注册只读 JSON 路由（`/api/trace-analyzer/*`），handler 内调 `ctx.sessionQuery.*` 返回 JSON；仅只读、不写会话。
- **Client**：同源 `fetch('/api/trace-analyzer/...')` 请求该路由（认证由 Host 的 `connection.requestRejection` 围栏 + 浏览器登录态保证）；Body 组件拿到 `sessionId` 后拼请求。

（备选：Typert `@Remote` 类型化 Remote，成本高，仅当路由方案受阻时启用。）

数据来源补充：`@deepseek-ai/dsh-api-session-controller` 已提供 `session/events`、`session/follow` Remote 与 Client `sessions.retain` 历史流，但**不含** `traceSession`（血缘）/`traceEvent`（事件溯源），故血缘树与事件溯源仍需走 `sessionQuery` 的自建桥。

### 4.4 目录结构

```
dsh-trace-analyzer/
├── package.json            # dsh.bundle.patch + dsh.client（web / immediately / inject）
├── cordis.patch.yml        # 插入 Host 行 trace-analyzer
├── index.js                # Host 半：数据桥 + Config
├── client.js               # Client 半：注册 conversation.view「Hades Lab」+ React 树视图（内置建树逻辑副本）
├── lib/                    # （实现时拆分）Host 聚合/转换纯函数（可单测）
│   ├── aggregate.js        # 时间线分组 / token 汇总 / 耗时统计 / 异常判定
│   └── types.js
├── locale/
│   ├── en.json
│   └── zh.json
├── docs/DETAIL.md          # 详情页
├── icon.svg
└── test/                   # 单元/集成测试（见 docs/TEST.md）
```

### 4.5 核心模块划分

| 模块 | 数据来源 | 职责 |
|---|---|---|
| 运行总览（单视图，原「概览 + 时间线」合并，无 tab） | `/runs`（轻量投影）→ 客户端渲染 | KPI 大卡片 + run 表：run 文字 + **角色徽标** + 单条指标条（时间/Token，数值在条内）+ 点行**就地展开**为**分组**（run 与全部 step 同一淡蓝底 + 连续 3px 左轨，F130）；step 行 index 与 run 对齐、角色徽标同列、条内数值与 Turn 一致、另一维度条后常驻、**动词+对象标题**（F23.1，无文本事件压缩成标题标记，F23.2 在详情里补说明行）；点 step → **内容面板直出**（模型/计时/Token/概述/工具参数/结果，F129；每块带角色徽标 F131）+ 单选选中态（F128）+ 按时间/Token 排序（FLIP）；展开时才拉 `/run`、点 step 才拉 `/step` |
| 事件详情 | `/event` → `readEvent`（按需） | 操作展开时取事件原文 JSON + 溯源链（溯源链待接入 UI） |
| 导出 | 内存数据 | 单事件 JSON、整段 JSONL、复制（待做） |

> **交互**：点 run 行**就地展开** step/操作（不再跨 tab 下钻）；step/操作逐层展开；排序用 FLIP 动画。

> **建树位置（M6 已改）**：`buildTraceTree` 等聚合逻辑**只在 Host**（`lib/aggregate.js`，权威实现 + 单测）。原 client.js 内嵌副本已删除，避免两份实现漂移；代价是 Host 侧改动需重启应用生效（客户端仍可 HMR）。详见 §4.7。

### 4.6 实时性设计

- **实时**：Host 侧订阅 `session/event`（scoped 到当前 Agent）推送增量事件；Client 通过桥的增量接口（或轮询轻量 `listEvents`）追加到时间线尾部。
- **手动刷新**：按钮触发一次完整快照重建（清客户端缓存 + 重新请求 `/runs`）。
- 遵循 practices.md：不轮询 `agent/status`；增量只追加、不改写已渲染节点；大会话分页/虚拟化。

### 4.7 性能架构：阶段化加载（M6，替代一次性全量快照）

**基线实测**（真实会话：6800+ 事件 / 79 run / ~930 step；`mockup/measure-perf.mjs`、`mockup/measure-phases.mjs`、`mockup/verify-perf.mjs`、`mockup/inspect-step-content.mjs`，以及运行中 Host 的 `/bench` 探针）：

| 项 | 基线（v1 全量快照） | 改造后（实测） |
|---|---|---|
| 首屏 payload | 27.5 MB | **31.0 KB** |
| 首屏 `JSON.parse`（客户端） | 108.8 ms | **0.1–0.2 ms** |
| `/runs` 服务端耗时（live Host） | 880–1600 ms（`readSession` 读盘+回放校验） | **~20–37 ms**（内存路径） |
| 展开单个 run（步索引） | 无（早已整包在手） | 按需，p50 1.8 / p90 6.5 / max 39.8 KB |
| 点开单个 step（容器+清单） | 无（内容混在整包/嵌套里） | 按需，p50 1.2 / p95 2.2 / max 7.5 KB |
| 事件原文 JSON | 随全量下发（其中 `data.stream` 占 12.8 MB） | 点「原文」时才 `readEvent` 取（单窗口 ≤ 64 KB） |

**根因**：v1 的 `/summary` 把 `readSession()` 全部原始事件整包下发（含 `assistant/message.data.stream` 流式块），客户端再 `buildTraceTree`。内置轨迹之所以「瞬间出下一层」，是因为它读**客户端已加载的会话内存**（`sessions.binding` + `uiConversation` 增量快照）并用虚拟行渲染，完全没有 HTTP 往返。**瓶颈是 payload 体积、解析与全量读盘，不是聚合计算**（建树 ~3 ms）。

**关键发现（live 内存路径）**：Host 侧 `ctx.sessionQuery.inspectSession(sessionId, (s) => ({ header: s.header, events: s.snapshotEvents() }))` 对**活动会话**直接返回内存中的完整事件日志（与轨迹同源），实测 **0 ms**，事件数与 `readSession` 完全一致；`readSession` 需读盘 + 回放校验，约 900 ms。因此 live 会话走内存路径，冷/持久化会话回退 `readSession`，两者共用同一份 `lib/aggregate.js` 投影，结果一致。

**四段式契约（唯一数据通道，替代 `/summary`）**：

1. `GET /runs?sessionId=` → `{ header, meta:{sessionId,slowMs,serverMs,generatedAt}, counts:{events,runs,steps}, tokens:{total}, kpi:{errors,slow,abnormal,slowest}, runs:[{idx,prompt,isSystemPrompt,stepCount,token,time,startTime,endTime,hasError,hasSlow}] }`。
2. `GET /run?sessionId=&idx=` → `{ idx, prompt, isSystemPrompt, startTime, endTime, steps:[{step,startTime,endTime,timeMs,token,hasError,text}], serverMs }`（**只发步索引**，不再带 `events[]`/`tools[]`）。
3. `GET /step?sessionId=&idx=&step=` → `{ idx, step, startTime, endTime, timeMs, model:{provider,model}, usage:{input,output,cacheRead,cacheWrite,reasoning}, counts:{models,tools,contexts}, operations:[{kind:'assistant',seq,time,text,usage} | {kind:'tool',seq,callSeq,resultSeq,name,args,result,error,isError,durationMs,startTime,endTime} | {kind:'context',seq,time,text} | {kind:'system',seq,time,text}], slowMs, serverMs }`（Step 展开容器的唯一来源；行序 = 事件 seq 序；文本/参数/结果各截断 400 字符）。
4. `GET /event?sessionId=&seq=` → `readEvent` 原文窗口（仅点「原文」时调用）。

不再下发 `events` 数组；`data.stream` 永不进入下行数据。

**Host 侧**：`lib/aggregate.js` 提供纯函数 `buildRunsPayload(events, opts)` / `buildRunsPayloadFrom(tree, tokens, tools, opts)` / `buildRunDetail(tree, tools, idx, opts)` / `buildStepContent(tree, tools, idx, stepIdx, opts)`；`index.js` 以 `inspectSession(...s.seq)` 作版本键按会话缓存快照（LRU 8），版本未变时展开 run/step 只做纯投影。树叶子额外保留 `usage`（分项）、`argsText`/`resultText`（各 ≤400）、`provider`/`model`，供 `/step` 直接投影（只在 Host 内存，不进 `/run`）。

**Client 侧**：删除内嵌 `buildTraceTree` 副本（Host 为唯一实现），只做渲染；模块级缓存（runs / run 步索引 / step 内容 / event）让切回会话、重复展开零请求；表头常驻显示实测「首屏 xx ms · xx KB · 服务端 xx ms」，缓存命中显示「缓存命中」，作为可复核的性能验收证据。

**代价（如实记录）**：投影逻辑移到 Host 后，Host 改动需重启应用生效（客户端仍可 HMR）；开发期可用 `plugin_manager` 关闭再开启该入口触发重载。这是换取「首屏 KB 级 + 展开按需」的必要代价。

**运维/验收探针**（仅 loopback，返回常量与体积/耗时，不含会话内容）：`GET /api/trace-analyzer/health`、`GET /api/trace-analyzer/bench?sessionId=latest`。

**已知限制（如实记录）**：`/run` 体积与 run 的 step 数线性相关（≈120 B/step），当前最长 run 约 40 KB；`/step` 与单个 step 的工具数相关，p95 2 KB / max 6.9 KB。两者都在门槛内；若某 run 出现数千 step，再考虑「按 step 分页 / 虚拟滚动」（未做）。

**验收结果**：TEST §5 P01–P11（离线 `mockup/verify-perf.mjs` + 在线 `mockup/bench-live.mjs`）全部通过，实测值见表格与 TEST §5。

**验收**：SPEC §15 F120–F127；TEST §5 P01–P09（自动化）+ V19–V22（人工）。

## 5. 关键技术要点与风险

1. **主题**：只用 `--dsw-alias-*` 主题 token（`Theme.listTokens`），不写死颜色；深浅色跟随宿主。
2. **禁止**：不 `require` 任何 Harness Client 包（`@deepseek-ai/dsh-client-ui-primitives` 等）；不自写 DOM 到 `document.body`；不 `iframe`；不读其他插件 DOM。
3. **locale**：UI 文案走 `ctx.locale`（`register`/`bind`），中文优先。
4. **性能**：阶段化加载（首屏 `/runs` ≤ 64 KB）+ 按需 `/run`、`/event` + 会话级缓存（§4.7）；纯函数聚合便于测试与缓存。
5. **只读**：插件不改会话事件、不追加 `SessionEvent`、不 `appendPluginRecord`。
6. **风险 R1（数据桥）**：`sessionQuery` 无现成 Remote，采用 `webServer` 路由 + `connection.fetch`（§4.3，已证实模式）；精确 route/fetch 写法开工时读 `host-open-in-app`/`session-controller` 源码定型。
7. **风险 R2（已解决）**：主对话区视图注册 = `conversation.view` 槽（§4.2，已读 `dsh-client-ui-trajectory` 源码确认）。
8. **风险 R3（血缘跨会话）**：v1 范围「仅当前会话」，血缘树中后代/祖先是**其他会话**；点击跳转依赖 `uiWorkspace.openSession` / `sessions.scope`，若受限则 v1 只做只读展示 + 复制 sessionId，不跳转。
9. **风险 R4（服务注入，已解决）**：`conversation.view` 槽由 `@deepseek-ai/dsh-client-ui-conversation` 声明，需在 client `inject` 声明该来源并保证该包已加载。

## 6. 配置项（Config）

| key | 默认 | 说明 |
|---|---|---|
| `highlight.toolDurationMs` | 5000 | 工具调用耗时超过该值高亮（ms） |
| `highlight.toolTokenDelta` | 0 | 单步 token 增量超过该值高亮（0=关闭） |
| `timeline.pageSize` | 200 | 时间线每页事件数 |
| `bridge.mode` | `route` | 数据桥方案（route / remote），实现确定后固定 |

## 7. 实施顺序（里程碑）

1. **M0 待确认清零** ✅：数据桥与视图注册写法已读源码定稿（§4.2/§4.3）。
2. **M1 骨架** ✅：bundle + patch + locale + icon，主对话区 `conversation.view`「Hades Lab」注册并验证 `active`。
3. **M2 数据桥** ✅：`/api/trace-analyzer/*` 只读路由。
4. **M3 执行树 + Token/耗时统计** ✅：run（一次指令，run0=系统提示词）→ step 树 + 10 单测。
5. **M4 单视图「运行总览」** ✅：KPI 大卡片 + 可展开 run 表（按时间/按 Token 排序+FLIP + 点行就地展开 step→操作局部瀑布）。已去掉「血缘」tab（官方轨迹亦无此类目）。
6. **M5 事件详情（readEvent/traceEvent）+ 搜索过滤 + 阈值 Config + 导出 + 实时跟随 + UX 评审**：待做。
7. **M6 性能改造（阶段化加载）** ✅：`/summary` 全量快照 → `/runs` + `/run` + `/event` 三段式 + live 内存路径（`inspectSession`）+ Host 快照缓存 + 客户端缓存 + 删除客户端建树副本；首屏 payload 27.5 MB → ~25 KB，`/runs` 服务端 880–950 ms → 0.9–8.2 ms。验收见 TEST §5 P01–P10 / V19–V22。
8. **M7 Step 信息增强 + Run/Step 共同选中态（F128）** ✅：step 行 index 与 run 对齐、耗时 + Token 常驻、单选选中态（Run/Step 共用 3px 强调轨 + 淡底）、选中不改行高（不破坏 FLIP）。**行标题改为「动词 + 对象」（F23.1）**：`读取 client.js:226` / `修改 DESIGN.md` / `搜 「…」` / `运行 · <命令描述>`，有模型文本则取首句、动作退为副标题，压缩/重试/失败/文件变更等无文本事件做状态标记（最多 2 个），原文仍作 tooltip；**详情面板补说明行（F23.2）**：压缩/重试/文件变更/命令/计划/清单/交付/审批 各占一行 muted 行。验收见 TEST U19/U20 + V23–V25 + V44–V47。
9. **M8 分组化 + Step 内容直出（F129/F130）** ✅：展开 Run 与其 Step 合并为一个着色分组（F130）；Step 条数值改为条内右对齐（与 Turn 条共用 `MetricBar`）、另一维度条后常驻；新增 `/step` 四级路由，点开 Step 直接铺开 模型/计时/Token 分项/概述/工具参数/结果（无嵌套，原文为可选单层开关）；`/run` 瘦身为步索引（max 155 KB → 43 KB），`/step` p95 2 KB。验收见 TEST P04/P11 + V26–V29。
10. **M9 角色标识（F131，对齐内置轨迹）** ✅：kind 集合、中文标签、配色与标签几何全部沿用轨迹 `kindTag`（`user` 用户 / `assistant` 助手 / `context` 上下文 / `system` 系统 / `tool` 工具；19px 高、10px、650 字重、`color-mix` 淡底）；**落位改为**：Run 行一枚（触发者）+ Step 明细行各一枚（用户指令 / 上下文 / 助手概述 / 工具块），**Step 行不再带标签**；同时去掉固定 56px 角色列，Run/Step 的 index 与 bar 重新严格同列。验收见 TEST U23 + V30。
11. **M10 Step 展开容器 + 有序活动清单（F129）** ✅：`/step` 改为 `counts + operations[]`（按事件 seq 排序，工具结果折叠进 call 行）；客户端把 Step 行与其明细一起装进**括号容器**（accent 10% 蓝底 + 3px 蓝轨 + 1px 40% 环 + 圆角；明细缩进 74px、自身透明），全部改用纯蓝阶梯：Run 分组 3%（`border-left: 3px` 蓝轨 + 1px 25% 真边框 + `overflow: hidden`）、展开的 Run 行 8%（只有填色，被裁切）、Step 括号 16%、展开的 Step 行 26%（环 35/45/45/70），Run 块很淡、Step 块更深，靠明度区分两块，顶部构成概览（模型/模型调用 N/工具调用 N/上下文 N/计时/Token），下面逐行列出 `用户指令 → 模型调用 → 工具… → 上下文 → 系统`，行间分隔线用 `border-l2`（l1 在有底色的容器里不可见），每行带角色标签与「原文」开关；**高亮跟随展开**：展开的 Step 行保持 16% 蓝底 + 60% 内环、面板描边 45%；展开的 Run 行保持 8% 底 + 35% 环、分组底色 7%；收起即恢复，可同时展开多项各自高亮（旧版把高亮绑在「选中」上，且 3px 轨与分组轨重叠，几乎不可见）。Step 行的概括文案仍为旧规则，留待下一轮。验收见 TEST U21/U23 + V31/V32；P11 实测 p50 1.2 / p95 2.2 / max 7.5 KB。
12. **M11 标签体系（F135 / F136 / F137）** ✅：把 step 行的「动词 + 对象」文案换成**标签式命名**——行首一枚动作 chip（`READ` / `EDIT` / `RUN` / `REPLY` / `FAIL`…）+ 对象文本，兜底词折叠（`运行命令→运行`、`tool · X→工具`），中文留在 tooltip（F135）；Turn 行（角色）与 Step 行（动作）**共用同一个 `RowTag` 组件**：19px 高 / 10px / 650 / `.035em` / `radius-xs` / `padding 0 5px`（对齐官方轨迹 `kindTag`），词表分层、配色同源（工具类=warn、回复=assistant、失败=error），标签一律英文大写（F136）；再把「一枚 chip」扩成**多动作 chip**（F137）：按调用顺序去重，同一动作折叠成 `EDIT ×6`、超过 3 种折叠成中性 `+N`，回复类行是 `REPLY` + 实际动作，原 `· 修改 ×6` / `+N 次调用` 文字后缀与 `suffix` 字段一并移除。验收：参考会话 **2275 steps → 2125 单 chip / 148 双 chip / 2 三 chip / 0 overflow**，`mockup/verify-chips.mjs` 断言 0 问题（chip 计数覆盖全部 `tool/call`、`tags[0] === tag`）；`stepTitle` 全量 11.5–13.7 ms（A/B 与无 chip 版差异在噪声内），`/runs` payload 字节不变（无 step 标题），P10 暖态 5.9–46 ms 通过。见 TEST V49–V51 + SPEC F135–F137。
13. **M12 性能加固与"卡顿可自证"（F138）** ✅：先定位归因——`conversation.view` 是 list 槽且渲染方用 `renderSlot(..., { only: viewId })`（源码取自 `app.asar`），所以**聊天时插件的组件树不在 DOM 里**，客户端也没有任何定时器/事件订阅（每会话只发 1 次 `/runs`，49.9 KB）。真正的可优化点是自己的面板与 Host 常驻：客户端缓存改 LRU（runs 6 / run 40 / step 240 / event 160）、`/runs` 在途请求加 `AbortController`、长 run 只渲 80 行 + 「显示全部」、表头在构建 ≥8 ms 时显示「渲染 x ms」；Host 快照缓存上限 8 → 4 会话（单会话一条，键 `sessionId` + `seq` 校验），`/health` 回报 `cache.{sessions,events,lastBuild}`。实测：17 955 事件会话 `/health` → `lastBuild 42.8 ms`、`sessions 1`；`check-served` 34/34；`verify-perf` 9/9（P02 改暖态中位 42.5 ms，冷首建 56.2 ms 单列）；闲置 8 s 全进程 CPU 0.6%。见 TEST V52 + SPEC F138 + `docs/REPORT-chat-perf.md`。
14. **M13 实时刷新（F140）** ✅：面板打开期间自动跟随对话更新，**可见时轮询 + `since` 短路**（Design: `docs/DESIGN-realtime.md`，R1）。Host `/runs?since=<seq>` 在未变化时只回 `{unchanged:true, seq}`（~40 B），完整 payload 在 `meta.seq` 带上构建偏移，`/health.cache.unchangedHits` 计数可观测；Client 每 2 s tick（隐藏即暂停、切回 400 ms 补一次），未变化不 setState，变更时保留展开/排序、重取已展开的 `/run`、用 `refreshToken` 重取已打开的 `/step`（运行中的工具行自动补上结果与耗时），表头常驻 `● 实时` / `⏸ 已暂停` 徽标。实测：`check-served` 37/37；单测 41/41（新增 `meta.seq`）；事件速率 0.81/s、冷聚合 42.8 ms、命中 ~1 ms ⇒ 3 分钟流式约 1% 单核。R2（客户端 store 订阅，零轮询）与 R3（`session/event` → SSE + 增量聚合）见设计文档。
15. **M14 增量呈现：更新要"长出来"（F141）** ✅：F140 第一版有"整页重刷"的观感，逐条改掉：① `unchanged` tick 不再写状态（函数式更新返回 `prev`，React bail out，空闲 30 s 零 commit）；② FLIP 只在**行序变化**时做，且改用 `offsetTop` 量位置（滚动不再被误判成行移动），payload 替换不再触发 155 行重新测量；③ step 面板改成 **stale-while-revalidate**：`refreshToken` 变化时保留旧内容、新切片到达原地替换，只有首次加载才显示「载入 step 内容…」；④ Time/Token 条 `width` 与 `TimeBar` 的 `left` 加 `.25s` 过渡，数值增长是"长过去"而不是瞬移；⑤ 首次渲染之后新增的 run 行带 `hadesRowIn` 220 ms 淡入，读作"追加"而非"重排"。验收：`check-served` 40/40（新增 `hadesRowIn` / `seenRuns` / `stale-while-revalidate`）；单测 41/41；见 TEST V55。
16. **M15 Step 的 token 时序切片（F142）** ✅：先按「run 行的堆叠分布」做了一版（为此在 /runs 加了 segments），按反馈改为**画在 step 行**：展开 run 后，每行 step 的 token 轨道**整条代表该 run 的总消耗**，第 k 步占据 [累计(k−1), 累计(k)]——左缘是前面所有 step 的累计占比、宽度是自己占 run 的百分比、各段首尾相接铺到 100%；淡色 = 之前已花、深色 = 本步、背景 = 剩余，tooltip 给 	ok · x% of run · 累计 y (z%)。数据不加字段（客户端由 /run 的 per-step token 累加，/runs 回到 51.8 KB、P01 门槛回 64 KB）。验收：单测 42/42（断言 5 步累计序列 [110,330,660,1100,1650] 等于 run 总量）、verify-perf 9/9、样例 mockup/step-token-preview.png；见 TEST V56。见 TEST V56。
17. **M16 展开动效（F144，方案 C）** ✅：点击展开不再是瞬时切换——抽了 Collapse 组件（WAAPI）：打开时量一次 scrollHeight 再 animate 高度 0→内容高度 + 淡入，**160ms**、曲线 cubic-bezier(.2,.7,.3,1)，结束把高度落回 auto；折叠 **120ms**、更快的曲线，并**保留最后一次内容到动画结束才卸载**，所以收起也有动效。关闭的 run/step 仍按需挂载（不用 CSS 0fr→1fr，否则 200 步的 run 会白挂几百节点）；step 数 > 60 的长 run 跳过高度动画、改 160ms 纯淡入（7000px 高度逐帧重排必掉帧）。箭头改成 ▸ 单字符旋转 90°（160ms），展开时索引列不抖；prefers-reduced-motion: reduce 直接切换；动画只在 open 变化时触发，实时刷新不重放。验收：check-served 44/44（新增 function Collapse / prefers-reduced-motion）；单测 42/42 不变；对比 demo mockup/expand-motion-demo.html。见 TEST V57。
18. **M17 时间条与 Token 条统一（F145）** ✅：同一行里 Time 条曾是 6px 内缩胶囊、Token 条是满高切片 + 18% 底衬，两根条像两个控件。现在把所有填充收敛到两个 helper：`SpentFill`（`opacity .18`，`0 → 本行之前已消费`）与 `SliceFill`（满轨道高 8px、`borderRadius 2px`、solid），Run/Step 两级、Time/Token 两列全部走它们，`TimeBar` 组件删除，过渡统一 `left/width .25s ease`。语义不变：Step 的时间条仍是 run 时间轴上的位置（底衬 = 本步开始前已流逝），token 条仍是累计切片（底衬 = 之前已花掉），所以两列结构完全相同、**只剩色相不同**（蓝 #3b82f6 / 紫 #a78bfa）。顺带清掉文档里 5 处历史遗留的控制字符（早前 PowerShell here-string 把 `\a`/`\0`/`\f`/`\v` 转义成了 C0 字符，导致 markdown 被当成二进制、无法用编辑工具修改）。验收：check-served 50/50（新增 function SliceFill / function SpentFill / SLICE_RADIUS = 2 / SPENT_ALPHA = 0.18）；单测 42/42 不变；对照图 mockup/bar-align.png。见 TEST V58。
19. **M18 两列等宽（F146）** ✅：F145 只管画法，宽度仍是 Time 170 / Token 112——一宽一窄读起来像"主指标 + 附录"，112px 也把 F142 的累计切片挤得很短。现在两列同宽：轨道 **150px** + 间隙 6 + 数字槽 **70px** = **226px**（旧 246 / 168），`TIME_W` / `TOKEN_W` 两组常量合并为 `METRIC_W` / `METRIC_NUM_W`，表头、Run 行、Step 行与 `MetricBar` 默认值全部引用同一对常量，"等宽"变成结构性的而不是约定；数字槽同步统一到 70，两个数字右对齐在同一条竖线上。代价：两列合计 +38px，标题列相应变窄；收益：token 累计切片长了 34%，最后一步右边缘仍精确 100%。验收：check-served 52/52（新增 const METRIC_W = 150 / const METRIC_NUM_W = 70）；单测 42/42 不变；对照图 mockup/bar-align.png。见 TEST V59。
20. **M19 run 的 prompt 全文（F147）** ✅：run 行一直用 `truncate(prompt, 80)`，第 80 字之后永远看不到（本会话 169 条 prompt 里 25 条超 80 字、最长 960 字）。现在整段进 DOM，由 `overflow: hidden + text-overflow: ellipsis + nowrap` 在**真实宽度**处截断——拉宽窗口立刻多显示、无需重取；`truncate()` 工具函数整体删除（另一处 400 字上限在 StepContent 的「指令」块，同样改全文，容器本来就能滚动）。payload 不变（`/runs` 一直送完整 prompt），P01 仍 53.1 KB。验收：check-served 55/55（新增 `r.prompt || '…'` 标记 + 两条 absent 断言：`truncate(r.prompt`、`function truncate` 必须不存在）；单测 42/42 不变；对照图 mockup/run-prompt.png。见 TEST V60。
21. **M20 hover 反馈加强（F148）** ✅：行悬停原来只是 `accent 6%` 淡色（列头 8%），浅色主题下几乎等于没有反馈。第一版加了 1px `inset` 内环（22% / 30%），被否——密集列表里多一圈细线显脏，改成**只用底色**：Run 行 9% 底（展开态提到 12% 以保证层级）、Step 行 10% 底（展开 22% 不变）、列头 8%→14% + 底线 55%→80%，另用箭头变 accent、索引/标题提亮补一层信号，`background/color` 带 120ms 过渡（渐亮而非跳色）。同时留了 7 个候选档位（`mockup/hover-options.html`：A 9%／B 12%／C 16%／D 12%+箭头文字／E 12%+左轨／F 10%+外阴影／G 12%+柱子提亮）供后续挑。验收：check-served 57/57（`tone: hover ? T.brand` 标记 + `hoverRing` 的 absent 断言）；单测 42/42 不变；截图 mockup/hover-strong.png、hover-options-1/2.png。见 TEST V61。

## 8. 待开工确认清单（第 0 步执行）

- [x] 主对话区视图注册机制（R2）：`conversation.view` 槽（`@deepseek-ai/dsh-client-ui-conversation`，已读 trajectory 源码）。
- [x] 数据桥写法（R1）：`webServer.register`（prefix `/api/trace-analyzer`）+ `connection.requestRejection` 围栏 + 客户端同源 `fetch`（读 `host-open-in-app` 源码定型）。
- [x] client Body 读取 `sessionId`（slot `inject` 注入）与 `t`（locale 注入）；`inject = ['slots', 'locale']`。
- [ ] 补全 `SessionEventMap` 完整事件类型清单（截断部分）。
- [ ] 确认 `assistant/attempt` 与 `request/header` 的耗时计算口径。
- [ ] 性能改造后确认：首屏 payload ≤ 64 KB（P01）、下行无 `"stream"`（P05）、展开 run 只发一次 `/run`（V20）。
