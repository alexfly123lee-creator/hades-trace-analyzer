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

- [ ] **一条命令跑完整回归：`node mockup/regress.mjs <GUI_URL>`，必须 `ALL GREEN`**（见 §0.4）。任何一项 FAIL 就先修，修完重跑，**不得**带着红项回复。
- [ ] `node --check` 语法校验（client / index / lib）。
- [ ] 纯函数单测 `node --test`（如有改动）。
- [ ] JSON / package 校验。
- [ ] **端到端**：从运行中的服务抓取实际生效的产物，确认新代码/新文案真的被加载（例如 fetch 服务端 bundle 并 grep 关键标记）。
- [ ] **重点交互回归**（见 §0.4 表格）：拨动、hover、跟随、滑块、展开、定位——凡是本轮改动触碰到或可能连带影响的，都要有对应 CDP harness 的绿项。
- [ ] 对照改动逐条核对真实结果，未验证项明确标注。
- [ ] **样式遵循 `docs/DESIGN.md` §5**（DSH design tokens；禁止写死颜色/圆角/加粗，颜色只用 `--dsw-alias-*`）。
- [ ] 文档（agent.md / SPEC / TEST / DESIGN / DETAIL）与代码保持一致。

### 0.4 回归套件（`mockup/regress.mjs`，每次交付必跑）

```powershell
node mockup/regress.mjs http://127.0.0.1:<GUI端口>
```

| # | 检查 | 覆盖的重点功能 | 判定来源 |
|---|---|---|---|
| 1 | `syntax` | 整个 client bundle 可解析 | `node --check` 退出码 |
| 2 | `unit` | run / step 切分、耗时、token、KPI 口径 | `node --test`（43 项） |
| 3 | `smoke:load` | 模块加载 + `apply` + locale 表 + 视图注册 | 脚本退出码 |
| 4 | `smoke:render` | KpiSummary / OverviewBoard / DualBarChart 三条渲染路径、标记带、渐隐类 | 脚本断言 |
| 5 | `served` | **线上 bundle** 是否真的含本轮改动（130+ 标记 / 反向断言） | fetch 服务端产物 |
| 6 | `cdp:scrub` | 矩阵滚轮拨动：一格一 Run、压暗、焦点类、页面不动 | `cdp-scrub-check.mjs` |
| 7 | `cdp:wheel` | 滚轮语义：所有 `deltaMode` 一格一 Run、落点 34%、快速连拨单调不倒退 | `cdp-wheel-check.mjs` |
| 8 | `cdp:hover` | 快速横扫不丢 hover、命中列与指针一致 | `cdp-hover-check.mjs` |
| 9 | `cdp:follow` | 打开落在实况边缘、跟随、上滚释放、`↓ Latest` 复位 | `cdp-follow-check.mjs` |

- harness 页面在 `mockup/*.html`，驱动脚本在 `mockup/cdp-*.mjs`；每个脚本**自带断言并以退出码表态**，套件只汇总。
- 新增重点交互时，**必须同时补一个 harness + 一条套件项**，否则该交互不算「已交付」。
- 报告里贴出套件的 summary 表（PASS/FAIL + 耗时），这是「已验证」的证据。

### 0.3 本次教训（记录在案）

- 「Trace Lab 改名生效、但时间线仍是旧样式」——根因是我只改了「时间线」tab，而用户默认看到的是「概览」tab 的柱状图（同样存在空白浪费的旧布局）。我在未确认用户实际所在 tab、未做端到端视觉验证的情况下，两次宣称「已修复/已生效」，浪费了用户时间与 Token。
- 教训：**凡收到「没生效」的反馈，先定位用户实际看到的是哪个界面 / 哪条渲染路径，再做端到端验证，最后才下结论；绝不未经验证就宣称完成。**
- 「Trace Lab 加载奇慢 vs 轨迹瞬间」——先用真实会话量化：首屏 payload 26.7 MB、`JSON.parse` 107 ms、建树仅 16.7 ms，才确定瓶颈是**下行体积/解析**而非聚合计算。
- 教训：**性能问题必须先量化（payload 字节数、parse/序列化毫秒数、请求次数），再动手；交付时必须给出改造后的真实数字，禁止用「应该变快了」结案。**
- 「滚轮拨动有问题」——上一轮我交付时只跑了语法 + 静态标记，**没有对重点交互做回归**，缺陷（`deltaMode` 行模式一步要 9 格、快速连拨时补间从半途重启导致列表追不上、从过期选中开始拨会让列表瞬移到别处）就直接漏到线上。
- 教训：**每次交付之后、回复之前，必须先跑 `node mockup/regress.mjs` 把重点功能回归一遍（§0.4），并把 summary 贴出来；红项不许交付。** 这条已写成硬性要求，后续所有交付都遵守。

## 1. 目标与背景

用户反馈：系统自带的 trace 记录面板（即会话的「轨迹 / Trajectory」视图）「非常难用，没有产品化可视化能力」，只能看到原始 JSON，没有时间线/分组、看不到血缘/子任务关系、没有搜索过滤、也看不到性能/token 开销。

目标：新建一个独立的 trace 分析面板插件，把 DSH 的事件溯源日志（Session event log）变成可读、可过滤、可定位瓶颈、可导出分析结果的产品级可视化界面。

## 2. 需求澄清结论（用户确认）

| 维度 | 结论 |
|---|---|
| 形态与位置 | 主对话区视图环（`conversation.view` 槽，紧邻内置「轨迹 / Trajectory」），名「Trace Lab」；点击视图环上的「Trace Lab」Tab 打开 |
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
   - `label()`：Tab 文案函数，返回 `t('view.title')`（zh/en「Trace Lab」）。
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
├── client.js               # Client 半：注册 conversation.view「Trace Lab」+ React 树视图（内置建树逻辑副本）
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
2. **M1 骨架** ✅：bundle + patch + locale + icon，主对话区 `conversation.view`「Trace Lab」注册并验证 `active`。
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
22. **M21 深色模式单独一套透明度（F149）** ✅：9% accent 混进深色 `layer-1`（#232324）只有 `#252b39`，hover 在深色下等于没有。现在调色板按主题分两套：`LIGHT_TINT`（9/12/10/22/14/80，完全不变）与 `DARK_TINT`（22/30/26/36/26/90），`tintOf(pct, base)` 生成 `color-mix`；检测不用 CSS（面板可能在 shadow root 内，`body[...]` 后代选择器匹配不到），而在渲染时读 `body[data-ds-dark-theme]` 的属性并把调色板写回共享的 `T`，再用 `MutationObserver` 监听 `body` / `html` 的主题属性，切换主题立刻重渲染、无需刷新。验收：check-served 60/60（新增 data-ds-dark-theme / function applyThemePalette / DARK_TINT）；单测 42/42 不变；对照图 mockup/hover-dark.png。见 TEST V62。
23. **M22 顶部透视卡：一行 KPI + 4 行热力矩阵（F150）** ✅：8 张大数字卡只有总量，回答不了"哪个 turn 值得看、问题在哪"。顶部换成一张卡：一行紧凑 KPI（数字 + 标签 + 异常语义色 + 最慢操作带工具名）+ 4 行 × 每个 run 一列的热力矩阵（Time 蓝 / Token 紫 / 步数 绿 按**会话内排名**映射 8%–88% 透明度，异常行红/橙/发丝灰）。悬停出十字线与读数，点击**打开并定位**该 run（已展开的不会被收起）。顺带修掉一个误导性口径：`kpi.slowest` / `kpi.slow` / run 的 `hasSlow` 排除人机等待，于是本会话"最慢操作"从 `ask_user_question 13.1min`（在等你回答）变成 `pwsh 2.0min`，慢操作 53 → 37。验收：check-served 63/63（新增 function OverviewMatrix / locateRun / mx.hint）；单测 43/43（新增 F150 用例）；verify-perf 9/9（P06 基线同步排除等待）。见 TEST V63。
24. **M23 顶部模块重构：吸顶矩阵 / 对齐十字线 / 丝滑定位 / 纯色图例（F151）** ✅：按反馈改七点——① 矩阵卡 `position: sticky; top: 0; z-index: 3`，KPI 模块滚走、矩阵常驻；② 十字线改用真实网格几何（`track = (100% − 标签列 − 间隙总数)/n`，`left = 标签列 + i×(track+1px)`）替代 `i/n%`，像素实测 band 边框 1072–1079 与单元 1072–1079 完全重合；③ 点击定位改成 rAF + `easeInOutCubic` 手写补间（260–700ms 按距离、落点 32% 视口、连点取消上一段、reduced-motion 直跳）；④ 图例只留色块 + 渐变条；⑤ KPI 拆成独立模块（矩阵卡只留图/图例/读数）；⑥ 删掉整条头部运维条（缓存命中 / 服务端 / 首屏 / 渲染 / 实时徽标 / 刷新按钮）及随之而来的死代码（caption、refresh、clearSessionCache、loadInfo、realtime 状态、perf.lastBuildMs、fmtBytes）；⑦ Run / Step 中英文全部首字母大写（`Run 42`、`Step 7`、`异常 Run`、`载入 Step 内容…`、`% of Run`）。验收：check-served 68/68；单测 43/43。见 TEST V64。
25. **M24 吸顶改成 transform 钉住 + 十字线拆线 + 配色收敛（F152）** ✅：① `position: sticky` 在真实面板里静默失效（滚动所有者是对话页，任意 `overflow: hidden` 祖先都会变成不滚动的 sticky 容器）→ 改成 JS 钉住（占位 `div` + 视口坐标算 `translateY`）；② "梯形底纹"是十字线用了带 1px 左右边框的盒子、列宽 2–4px 时 border-box 塌成楔形 → 拆成三个独立矩形（淡底 + 左右各 1px 线）并画在单元之后；③ 4 行标签统一中性灰；④ 图例回到「色块 + 文字」；⑤ 异常行红/橙改 58% 半透明。CDP 实测不钉 `top=-395`、钉住 `top=0`。验收：check-served 72/72（新增 band-fill / bandLayer('band-l' / data-hades-scroll / translateY(${t}px)，`position: 'sticky'` 改 absent）；单测 43/43。见 TEST V65。
26. **M25 数字摘要与矩阵一起吸顶（F153）** ✅：F152 只钉矩阵卡，KPI 仍会滚走。现在把 **KPI + 矩阵**放进同一个被钉的块（`OverviewBoard`，`data-hades-board`）：占位 div 铺 `surface` 底色（遮住两块间 8px 的缝）→ 被钉块（`will-change: transform`）→ KPI 卡 + 矩阵卡；钉住算法同 F152，但测的是整块高度。`locateRun` 的落点同步改为 `max(viewH*0.32, boardH + 24)`（上限 `viewH*0.6`），定位到的 Run 不会被吸顶块盖住。CDP 实测（病态 DOM + 页面滚 520px）：不钉 `top=-445/bottom=-318`，钉住 `top=0/bottom=127`、`translateY(445.4px)`，KPI 卡在块内 `top=0`。验收：check-served 73/73（新增 function OverviewBoard / data-hades-board）；单测 43/43。见 TEST V66。
27. **M26 吸顶真正生效：跨 shadow root 的滚动监听（F154）** ✅：前两版（`sticky` / `transform` + `document` 监听）真机都"完全没钉住"，根因是宿主为 Lit web component（`attachShadow`），插件视图在 shadow root 内部，而 `scroll` 事件不是 composed。CDP 实测 shadow 内滚动时 `document` 收到 **0** 个 scroll 事件、不钉的块 `top=-183`。改法：沿祖先链逐级挂 scroll 监听、遇 shadow 边界用 `getRootNode()` 再跳 `root.host`（9 个目标）+ 120ms 看门狗 + `wheel/touchmove/keydown`（composed）触发后 400ms 每帧重算。实测钉住 `top=67`。验收：check-served 76/76；单测 43/43。见 TEST V67。（F155 已把这套监听整体删掉，改结构性固定。）
28. **M27 顶部改结构性固定 + 矩阵可选可定位（F155）** ✅：前四版都在"把表头钉在滚动之上"（`sticky` → `transform` → 跨 shadow 监听），真机始终失效。这次换架构：**面板变成有确定高度的 app shell**，表头块是滚动区**外面的 flex 兄弟**，结构上不可能滚。`shellH = clamp(320, min(视口高 − 面板顶, 父容器可见底 − 面板顶))`，挂载/resize/250ms 各量一次；顺带**删掉** sticky、transform 钉住、祖先链监听、看门狗、pageScroll 探测（-3.6 KB）。矩阵点击改为"选中并保持高亮"（`selected` 状态，hover 结束后仍亮）+ `locateRun` 滚到该 Run（落点 `max(viewH×0.32, 矩阵高+16)`，不被表头挡）。CDP 实测（shadow + 无界父容器）：shell 567px、可滚 746px，列表滚 400 后表头 top 103→103；点第 30 列列表滚到 734、表头仍 103、高亮保持。验收：check-served 76/76（新增 shellH / const renderHeader / const renderList / setSelected(i)，移除钉住类标记）；单测 43/43。见 TEST V68。
29. **M28 点击矩阵不再卡顿（F156）** ✅：卡顿是三个热点叠加——① `selected`/`hover` 变化把 700 个格子整块重建；② 展开该 Run 的 160ms 高度动画与 260–700ms 的滚动补间同时改列表高度；③ 这些全在点击的同一个事件任务里做完才绘帧。改法：网格 `useMemo([rows, ranks, n, rowTexts])` 缓存（回调走 `locateRef`，避免每 2s 的实时 tick 打穿 memo）→ 点击只重渲染高亮三件套；点击时先 `setSelected` 立刻亮，`setTimeout(0)` 把定位推到下一个任务，`locateRun` 再等 200ms（高度动画结束）才起补间，已展开的 Run 仍立即定位。验收：check-served 76/76（`const grid = useMemo` / `locateRef` / `setSelected(i)` 均在线上 bundle）；单测 43/43。见 TEST V69。

30. **M29 断开滚动链 + 矩阵选中态（F157）** ✅：① 滚到底后往回滑"表头消失"不是固定失效，而是**滚动链**——列表到 `scrollTop=max` 后再滚一格就把滚轮传给页面，整个面板被页面带走；给列表加 `overscroll-behavior: contain` 解决。② hover 与 selected 原来共用 14%/1px 淡带，既轻又分不清：选中改为 30% 底 + 左右 2px 实线（指针移开仍保留），悬停 20% + 1px（跟随指针），两者可同时存在；图例旁再加 `Run N ✕` 选中胶囊（✕ 取消选中）。验收：check-served 79/79（新增 sel-fill / bandLayer('sel-l' / hov-fill / bandLayer('hov-l' / overscrollBehavior）；单测 43/43。见 TEST V70。

31. **M30 整体卡顿：去掉 4 个隐藏热点（F158）** ✅：① 每行常驻 `will-change: transform`（175 个合成层）→ 只在 FLIP 期间设置并在 `transitionend` 清除；② 行 hover 是 React 状态，鼠标扫过列表每次跨界都重渲染 175 行 → 改成纯 CSS `:hover`（颜色走根节点上的 `--hades-hover-row` 等变量，随主题更新），删掉 `hoverRun` 状态；③ `renderDetail(r)` 对 175 行无条件调用（展开的 80 步 run 每次渲染多建 80 个 step 行）→ 只在 `open` 时构建；④ 每 2s 的实时 tick 无条件重渲染 → 先用可见变化签名（counts + token 总数 + 尾行 idx/token/time/stepCount）比对，相同就只更新 seq/缓存，且用户滚动中（<220ms 有 scroll）把更新延后 240ms。验收：check-served 83/83（.hades-run-row / --hades-hover-row / el.style.willChange / appliedSig）；单测 43/43。见 TEST V71。

32. **M31 Step 明细卡重做：统计条 + 时间轴卡片（F159）** ✅：旧面板是一条灰色 meta 行 + 平铺行，所有行同样重（两条 `system-reminder` 注入和模型回答等权，工具参数/结果永远展开）。按选定的 B+E 方案重做：顶部一行统计条（模型/工具/上下文 · 计时 · in/out/cache，模型名挂在“模型”后），下面是**竖轴 + 类型圆点**的时间轴卡片——指令卡（USER + 字数，全文可滚动）、回复卡（REPLY + in/out）、工具卡（TOOL + 名称 + 耗时，args/result 各一行等宽省略）、注入卡（`CTX 注入 ×N` 虚线卡，**默认折叠**，点击展开，`ctxOpen`）、说明行（点线小卡）。`原文` 移到卡片右上角并在原卡内展开 JSON（`rawPanel`）。验收：check-served 87/87（ctxOpen / setCtxOpen / rawPanel / 注入 ×）；单测 43/43；设计稿 mockup/step-cards-final.png。见 TEST V72。

33. **M32 删掉图例里没解释的渐变条（F160）** ✅：图例里那根 84×6 的低→高渐变条本来想说明"格子颜色越深 = 该 Run 排位越高"，但它没有刻度、没有文字、没有说明，夹在 `■ Time ■ Token ■ 步数` 后面读起来像一条跑偏的进度条。删掉它；把"颜色越深 = 排位越高"下沉到三个行色块的 tooltip，并按行说清楚（耗时 / token / 步数各自比较）。图例恢复为五个纯色块 + 文字。验收：check-served 90/90（新增 `mx.rampTime/Token/Steps`，并把 `'mx.ramp':` 加进 absent 断言）；单测 43/43。见 TEST V73。

34. **M33 点矩阵后选中行滚到列表顶部（F161）** ✅：F155 之后表头已在滚动区外，但 `locateRun` 的落点还留着旧算法（`max(视口×0.32, 矩阵高+16)`，上限 `视口×0.6`），选中的 Run 落在列表中部。现在落点固定为列表顶部（`target = scrollTop + 行相对偏移 − 2`）；并且因为列表到底就结束、最后几屏的行数学上无法贴顶，所以在列表末尾加 `tailPad = 列表视口高 − 40px` 的留白（`data-hades-tail`），让每行都能贴顶。CDP 实测（shadow + 无界父容器）：抽测第 8/20/30/34 列，`rowTopInList` 全部 = **2px**（改之前 30/34 分别是 124/240，因为贴底），`boardTop` 恒为 103。验收：check-served 92/92（新增 data-hades-tail / tailPad）；单测 43/43。见 TEST V74。

35. **M34 点击矩阵不再整表重建、不再等 200ms（F162）** ✅：点击还剩两处真实开销——① 每次点击（改 expanded + detail 落地）都把 175 行**重新构建**一遍（≈2100 元素 + 逐节点 diff）；② F156 为了避开高度动画加的**固定 200ms 延迟**，本身就是"点了不动"的卡顿感。改法：`buildRows()` 行元素缓存（整表按 rows/sort/语言签名/首帧校验，打开状态按 `detailEpoch` 单独校验；命中的行复用同一批元素对象，React 整棵子树跳过）→ 点击只重建被点的那一行；`openRun`/`locateRun` 改读 `expandedRef.current`，避免缓存行携带旧快照；定位不再等固定 200ms（详情已缓存 → 下一帧滚；未缓存 → detail 一到就滚，`pendingLocate` 效应 + 400ms 兜底）；定位的那一行用 `instantOpen` 跳过高度动画。验收：check-served 92/92；单测 43/43。见 TEST V75。

36. **M35 展开动画卡顿/反复的根因：一次展开跑了 3 个高度动画（F163）** ✅：`Collapse` 里三处叠加——① `useEffect(setVisible)` 让 `visible` 在布局副作用之后才变，而布局副作用依赖里带着 `visible` → 一次 open 跑两次布局副作用（第二次 cancel 重开，从 0 再来一遍）；② 详情异步，先挂"载入 step…"占位、detail 落地再由 follow 动画长到真实高度；③ WAAPI 对同一属性是**叠加**不是替换，两个 `height` 动画同时跑 = 抖动。改法：`visible` 改渲染期同步翻转、布局副作用只依赖 `[open, expandMs, collapseMs]`；`animRef` 记录在飞动画、新动画前 cancel，follow 在开启动画期间跳过；`openRun` 对未缓存 Run 改为 **fetch 成功后再 setExpanded**（详情与展开同批提交），面板出现即最终高度。harness 实测：旧路径一次展开 **3** 个高度动画，新路径 **1** 个。验收：check-served 99/99；单测 43/43。见 TEST V76。

37. **M36 图例移到右上角 + 矩阵 Run 数量滑块（F164）** ✅：① 图例原来和悬停读数挤在矩阵**下方**同一行（把矩阵往下顶、右上角空着），现在卡片顶部一行：左边读数、右边选中胶囊 + 五色图例，矩阵紧接其下；② 1 列 1 个 Run 在 175 列时只有 ~4px，看不出差异 → 矩阵下方加 `type: range` 滑块（`data-hades-window`，12…全部，标注 `最近 N / 175 个 Run`，右侧 `全部` 复位），矩阵只渲染最新 N 个 Run，rank 按窗口内重算。连带把悬停/选中从"列位置"改为**存 Run idx**（拖滑块时选中列不跳位），读数/胶囊/高亮带按 idx 反查位置。验收：check-served 103/103（新增 type: 'range' / data-hades-window / mx.showRecent / windowN）；单测 43/43；设计稿 mockup/overview-window.png。见 TEST V77。

38. **M37 全英文 UI + 工业化滑块 + 细节收敛（F165）** ✅：① 界面文案全英文，`zh`/`en` 两个 locale 槽指向**同一张英文表**（中文系统语言下也不会半中半英）；只有 `TAG_MAP` 的**键**保留中文（匹配 trace 事件原文），值是英文 chip。② 滑块不再用原生外观：自绘轨道（`--fill` 画已填充段）+ 12px 圆点拇指（白底/1px 品牌描边/阴影）、hover 1.15×、focus 3px 柔光、左侧 `all/latest N of 175 runs`、右侧 `12–175` 与 `all` 复位胶囊、与网格之间 1px 分隔线。③ 细节：swatch 8px、图例项间距 12、指标组与异常组 1px 竖分隔、行标签与图例统一 Title Case、读数 Run 号品牌色加粗 + tabular-nums、行距 4px、异常行单独 4px、单元格圆角按列数自适应（>48 → 1px，否则 2px）、卡片内边距 10/12/10。验收：check-served 103/103（新增 MATRIX_CSS / hades-range / const EN / zh: EN, en: EN）；单测 43/43；设计稿 mockup/matrix-f165.png。见 TEST V78。

39. **M38 矩阵滚轮 = 逐 Run 拨动列表（F166）** ✅：指针在热力矩阵上滚轮不再滚动，而是**一格一个 Run**地拨（增量累加 26px 触发一步，触控板不会飞）；拨动期间根节点加 `.hades-scrubbing`，Run 分组 `opacity:.22`、只有焦点行全不透明且带品牌色左轨 + 16% 底色 + Run 号品牌色；列表用 **130ms + easeOutCubic** 把焦点行顶到顶部（"哒哒哒"定档感，不是 260–700ms 长滑行），停手 700ms 后恢复；滚轮不展开（展开仍是点击）。实现：原生 `wheel` + `passive:false` 才能 preventDefault；处理器只挂一次，靠 `selectedRef/hoverRef/shownRef` 读最新值；行缓存把 focus 纳入条目有效性 → 一格只重建新旧两行。验收：check-served 108/108（新增 hades-scrubbing / wheelAcc / beginScrub / is-focus / scrubTo）；单测 43/43；设计稿 mockup/scrub-f166.png。见 TEST V79。

40. **M39 拨动修复 + 焦点行不再贴顶（F167）** ✅：上一版"没生效"两个真实原因——① 用 `useEffect(..., [])` 读 ref，矩阵卡首次渲染可能因提前 `return null`（数据未到/表格为空）而未提交，effect 只在挂载那次跑、ref 为 null 就直接放弃且永不重试 → 改成**回调 ref**（`useCallback` 稳定身份）在元素真正挂载时绑定、卸载时解绑；② 那段 effect 落在 `if (n === 0) return null;` **之后**，表格短暂为空时 hook 数变化 → 现在所有 hook 都在提前 return 之前。顺带把监听范围从网格盒子扩到**整张矩阵卡**。另外焦点行不再贴顶：锚点从"列表顶部 -2px"改成 **视口 34% 处**（贴顶时紧贴矩阵下边缘，读着累）；落位仍是 130ms easeOutCubic。CDP 实测（真实 `Input.dispatchMouseEvent` 滚轮）：一格一个 Run（101→102→103）、40 行里 39 行压到 22%、页面 scrollY 恒 0、连续拨到第 12 行后 `rowTopInViewportPct = 34`。验收：check-served 110/110；单测 43/43。见 TEST V80。

41. **M40 工业级收敛：token / 标记带 / 稳定色阶 / 键盘（F168）** ✅：按设计计划一次落地 10 项——① `DESIGN` token 表（space 4/8/12/16、motion 120/160/240/260、两套 alpha、row 28/4）替代散落数字，`CSS_VARS` 供注入样式表使用；`EXPAND/COLLAPSE/FOLLOW`、scrub、glide 全部改读 token，focus 底色由 `applyThemePalette` 从 token 生成；② error/slow 从"第 4 个指标行"改为 Time 上方的 **3px 标记带**（`hades-lane`），高亮带上探 -8px；③ rank 改为全会话 `Map(idx→rank)`，滑块只裁剪 → 拖滑块不换色、少一次全格重算；④ 读数结构化、提示词移出头部，拨动时显示 `Run N / M` 刻度；⑤ 矩阵可聚焦 + `←/→/Enter`；⑥ 指标列改分数列、行高落 4px 栅格、提示词 `mask-image` 渐隐；⑦ 首屏 shimmer 骨架 + 空/错卡片；⑧ KPI 三簇 + 1px 分隔；⑨ reduced-motion 覆盖 scrub/glide/FLIP，glide 收口到 260ms；⑩ 滑块去冗余、芯片统一、原文加 Copy。验收：check-served **120/120**；单测 43/43。见 TEST V81、SPEC 45。

42. **M41 Time / Token 轨道回到固定 150px（F169）** ✅：F168 把两条指标轨道改成分数列后，一条 bar 有 600px 长，而它的信息只在同列内部比较 —— 长度不携带信息、只增加扫读成本。`MetricBar` 回到 `flex: 0 0 (150+6+70)px`（轨道 150px + 数字 70px `tabular-nums` 槽），表头两个可排序槽位回到同样固定宽度并让 `sortCol` 重新接收 `barW`，保证表头与行严格对齐；提示词列继续吃剩余宽度并保留渐隐。F168 的其余遗产（标记带、稳定色阶、键盘、骨架、token 表、4px 栅格）不动。验收：check-served 120/120；单测 43/43；渲染 harness 通过。见 TEST V82、SPEC 46。

43. **M42 打开即落在实况边缘 + 实时跟随（F170）** ✅：打开面板直接落在**最新 Run**（底部），并默认"跟随"——流式期间 2s tick 每推新数据，视口自动贴底，矩阵光标（高亮带 + 读数）也骑到最后一列。状态机：`distanceToEdge ≤ 8px` 视为在边缘→跟随；跟随自身的滚动写 `programmatic` 标记让滚动监听忽略（避免自己把自己判成用户滚动）；点行/点矩阵/滚轮拨动都 `stopFollowing()` 交出控制权，新数据不再拽动位置；右下角 `↓ Latest`（`data-hades-latest`）平滑回到最新并恢复。落点用 `getBoundingClientRect` 差值换算内容坐标（**不用 `offsetTop`**：面板根是 relative，offsetTop 会带表头高度），因 F161 尾部留白 target 通常小于 maxScroll，不会停在空白。CDP 实测：初始贴边（distance −12）→ 推 3 条仍贴边 → 上滚 260px 后 `follow=false`、pill 出现、位置保留 → 再推 3 条位置不动 → 点 pill 回到底部、pill 消失。验收：check-served 126/126；单测 43/43。见 TEST V83、SPEC 47。

44. **M43 矩阵 hover 快速移动丢失的修复（F171）** ✅：两个叠加成因——① 175×4 ≈ 2400 个 4px 小格各挂一个 `onMouseEnter`，快速横扫时 over/out 序列与 React 的 enter/leave 模拟同帧交错，最终状态可能落到"已离开"；② 每格一个 `title`（700 个原生 tooltip），横扫时 tooltip 窗口会**抢走 hover**。改法：单元格只留 `data-idx`，hover 由网格容器**统一解析**（`onMouseMove` + `closest('[data-idx]')`，同列不重复 setState，落在缝隙/标签上保持上一列，只有离开容器才清空）；删除全部格子级 `title`，Run 号/error/slow 交给左侧读数与行 tooltip。CDP 实测：6 次大跨度横扫后 hover = 149，与 `root.elementFromPoint` 命中列一致。验收：check-served 128/128；单测 43/43。见 TEST V84、SPEC 48。

45. **M44 滚轮三处缺陷 + 回归套件（F172）** ✅：① **`deltaMode` 未归一**——行模式（`deltaY=3/格`）下 26px 阈值要 9 格才走一步，滚轮像没反应；现在 `deltaMode 1×16 / 2×400` 归一，任何模式一格一 Run；② **补间从半途重启**——快速连拨时每步在落后的 `scrollTop` 重启 ease，列表追不上选中；改用 `scrubTarget/scrubAt` 记住在飞目标，260ms 内新一步从上一目标续算并瞬时跳到起点；③ **从过期选中开始拨**——`selected` 可能在很远的位置，拨一格把列表瞬移；改为"指针所在列 → 列表顶部可见行（`topVisibleRunIdx`）→ 选中"的顺序解析基数；④ 累加器 400ms 无滚轮清零。**同时落地回归套件** `mockup/regress.mjs`（9 项：syntax/unit/smoke:load/smoke:render/served + cdp:scrub/wheel/hover/follow，每项自带断言、以退出码表态），并把"每次交付前必跑、绿项才回复、贴 summary"写进 §0.2/§0.4 与教训。本轮实际结果：**ALL GREEN (9 checks)**。见 TEST V85、SPEC 49。

46. **M45 滚轮"无法持续滚动"：hover 钉住步进基数（F173）** ✅：F172 把基数改成"指针列 → 顶部可见行 → 选中"，但滚轮时**指针一直停在同一列**，`hover` 恒定 → 每格都算成 `hover+1`，于是第一格之后就不动了。改为**光标优先**：`selected`（窗口内）→ 顶部可见行 → hover（无光标时兜底）；hover 只做预览，不决定步进起点。**并补上回归缺口**：上一轮 `cdp:wheel` harness 是简化复刻、没模拟"停靠指针"，所以绿灯漏掉了这个 bug；现在 harness 引入固定 `hovered=40` 并复刻产品规则，新增断言"停靠指针连拨 3 格 = +3"。本轮 `node mockup/regress.mjs`：**ALL GREEN (9 checks)**。见 TEST V86、SPEC 50。

47. **M46 交互简化：悬停 = 滚轮 = 单 Run 聚焦，单击即打开（F175）** ✅：① 鼠标与滚轮合并成一条聚焦路径——悬停某列即把该 Run 设为唯一聚焦行（其余压暗 22%、焦点行全亮 + 3px 左轨 + 16% 底 + 滚到 34%），滚轮在此焦点上 ±1；移出矩阵清除聚焦；② 单击矩阵元素**直接打开**该 Run（展开 step + 滚到顶部），`selected` 只由单击写入，与"聚焦"语义分离；③ 顺带修掉"滚一格弹回"的真根因：尾部留白让边缘判定在末尾附近恒真，滚动监听把我们自己的补间误判成用户滚动 → 重新开启跟随 → F170 效果把光标拽回最后一行；现在所有程序化滚动都打 `markProgrammatic`，边缘判定加 `scrollTop >= maxScroll - 8`；④ **回归升级**：`mockup/integration-harness.html` 直接抽取 client.js 的 `onWheel/scrubTo/beginScrub/stopFollowing/topVisibleRunIdx` 源码在普通 DOM 跑，并镜像跟随/程序化滚动/tick，套件项改名 `cdp:focus`。本轮 `node mockup/regress.mjs`：**ALL GREEN (8 checks)**。见 TEST V87、SPEC 51。

48. **M47 去掉矩阵滚轮 + 放慢聚焦滑行（F176）** ✅：① 删除整条滚轮链路（原生监听 / `deltaMode` 归一 / 累加器 / 拨动逻辑），矩阵只由指针驱动，滚轮回到浏览器默认行为（-2.3 KB）；② `scrubTo` 时长 120ms → **300ms**（`DESIGN.motion.focus`），缓动 `easeOutCubic` → **easeInOutCubic**，因为 120ms cubic-out 眼睛跟不上、"看不清挑了哪行"；③ 悬停/方向键仍走同一聚焦路径（压暗其余 + 滚到 34%），单击仍直接展开，跟随与 `↓ Latest` 不变；④ `cdp:focus` 新增两条断言：**滚轮不得移动焦点/列表**、**滑行在 ~90ms 时必须仍在途中**（防止把时长改回瞬时）。本轮 `node mockup/regress.mjs`：**ALL GREEN (8 checks)**。见 TEST V88、SPEC 52。

49. **M48 矩阵卡置顶 + 去掉卡片阴影（F177）** ✅：① 置顶加两道保险——表头块 `position: sticky; top: 0; z-index: 4`（`data-hades-header`），即使宿主让页面滚动也贴视口顶部；shell 高度改用 **`ResizeObserver` 监听父容器**（原先只有 `window.resize` + 250ms 一次，侧栏/输入框高度变化时会留过期高度，导致页面接管滚动把矩阵带走）；② 删除矩阵卡的 `box-shadow`（只留 1px 描边）——它是固定在顶部的仪表盘而非浮层，阴影让它像悬浮卡片；`↓ Latest` 胶囊的投影保留（那确实是浮层）。验收：`node mockup/regress.mjs` **ALL GREEN (8 checks)**；`check-served` 128/128（新增 `data-hades-header`/`new ResizeObserver`，矩阵阴影进入 absent 断言防回潮）；单测 43/43。见 TEST V89、SPEC 53。

50. **M49 相对位置高亮：悬停不再让行乱跳（F178）** ✅：每换一列就把该 Run 重新锚定到 34%，扫过 175 列 = 175 次滚动，视觉上就是"行疯狂跳动"。改为**舒适带最小滚动**：`bandTop/bandBottom = 12%/78%`；焦点行**已在带内 → 完全不滚**（高亮跟指针走、列表不动，这才是"相对位置高亮"）；只有要离开带时才滚，且只滚**刚好**把它带回带内（回 12% / 推 78%），不再拉 34%。`cdp:focus` 新增"带内悬停不得改变 scrollTop"与"落点须在 0–80% 带内"两条断言，并把断言基线改成紧邻状态（原先对比更早状态会误报）。本轮 `node mockup/regress.mjs`：**ALL GREEN (8 checks)**。见 TEST V90、SPEC 54。

51. **M50 固定焦点线：行在滚、高亮不动（F179）** ✅：F178 的"舒适带最小滚动"让高亮在视口里上下移动，方向反了。改为**固定焦点线**：焦点行恒定落在视口 **34%**（`anchor = viewH × 0.34`），悬停不同列时由**列表移动**把该行送到这条线上 —— 眼睛看到"列表在滚、高亮不动"；连续悬停用 `scrubTarget/scrubAt` 合成位移（260ms 内从上一目标续算），扫过一串列是一次连贯滑动而非逐格跳；300ms easeInOutCubic 与 `markProgrammatic` 保留。`cdp:focus` 改为断言"焦点行必须落在 34%±6%"+"悬停线外行确实滚动列表"，并修掉测试里两处标识符/基线错误。本轮 `node mockup/regress.mjs`：**ALL GREEN (8 checks)**。见 TEST V91、SPEC 55。

52. **M51 点击展开后行位置漂移（F180）** ✅：两处"列表自己动"的隐患——① `focusRun` 曾是 `DualBarChart` 的 prop 并参与**行缓存键**，指针离开矩阵时（`focusRun → null`）会**重建那一行**，展开中的行被重建会重挂 `Collapse` 子树、高度短暂变化 → 列表跳动；改成**直接操作 DOM**（`markFocusedRow` 给行节点加/去 `is-focus`，只有根节点的 `hades-scrubbing` 控制压暗），不再触发任何行重渲染，payload 刷新后由 `applyNow` 补标记。② 滚动位置由我们接管，但 Chrome **scroll anchoring** 会在视口上方内容变高时偷改 `scrollTop`（展开行 + 随后到达的 step 内容都会变高）→ 容器加 `overflow-anchor: none`。`cdp:focus` 新增完整回放（hover → 点击展开 → 详情增高 240px → 指针移出）+ 三条断言。**验证边界如实记录**：把 `overflow-anchor` 改回 `auto` 该 harness 同样通过（增高发生在视口顶部行内，锚定不触发），因此**无法证明锚定就是线上漂移的唯一原因**，需真实面板确认。本轮 `node mockup/regress.mjs`：**ALL GREEN (8 checks)**。见 TEST V92、SPEC 56。

53. **M52 点击定位后行被拉回中线（F181）** ✅：点击走 `locateRun`（行滚到**顶部**），但指针仍在该列上；指针一移动/离开，`beginScrub(idx)` 又按**悬停聚焦**语义把同一个 Run 滚回 **34% 焦点线** —— 两个锚点打架，行就被拉回中线。加**定位锁** `locatedRunRef`：`locateRun` 记下该 Run，`beginScrub` 遇到同一 Run 只更新高亮不滚动（并清锁），指针换到别的列才正常按焦点线滚。`cdp:focus` 新增"点击后重新悬停同一列不得移动列表"断言，并做**对照实验**：去掉定位锁后该断言立刻变红（`3526 → 3375`），证明它真能抓住本次回归。本轮 `node mockup/regress.mjs`：**ALL GREEN (8 checks)**。见 TEST V93、SPEC 57。

54. **M53 定位保持 hold + 滚动诊断（F182）** ✅：F181 的定位锁只挡住"重新悬停同一列"，真实面板里**指针离开矩阵**后行仍会滑回中线；harness 复刻不出这一步（缺真实 React 与宿主布局），所以本轮：① **hold** —— `locateRun` 把行停到顶部时记下目标 `scrollTop`（`locatedHoldRef`），之后若**指针不在矩阵上**却有东西移动了列表，滚动监听**回滚一次**并丢弃 hold；真实用户输入（`wheel`/`pointerdown`/`keydown`）先清 hold，绝不干扰用户滚动。② **诊断** —— `scrollLogRef` 环形缓冲记录 `locate/glide/scrub/scroll/user-input`（含 scrollTop、programmatic、焦点），控制台 `__hadesScrollLog()` 取最近 60 条，这是真实宿主里唯一能定位"谁动了列表"的手段。`cdp:focus` 增加"指针离开后外部改动必须被回滚"断言。**诚实边界**：hold 是症状级兜底，根因待日志确认。本轮 `node mockup/regress.mjs`：**ALL GREEN (8 checks)**。见 TEST V94、SPEC 58。

55. **M54 真凶：点击后指针扫过邻列又触发悬停聚焦（F183）** ✅：现场 `__hadesScrollLog()` 显示最后一段是 `scrub idx 54→43→38→…→24`，末条 `scrub idx:24 from:832 to:665`，随后是一串 `scroll prog:true focus:null` 停在 **665 = 34% 焦点线** —— 点击把行停到顶部后，**指针只要再扫过任何一列就会 `scrubTo` 把列表拉回焦点线**（F181 只挡"同一列"）。改法：点击时给矩阵加**悬停锁** `hoverLock`——锁定期间指针移动只更新高亮/压暗（`onFocusOnly`），**不滚动**；离开矩阵解锁；方向键仍显式导航滚动；F182 的 hold 与日志保留。`cdp:focus` 新增"点击后悬停另一列不得滚动"+"高亮仍跟随"两条断言，**对照实验**去掉锁后立刻变红（`3526 → 3179`，与现场 832→665 同型）。本轮 `node mockup/regress.mjs`：**ALL GREEN (8 checks)**。见 TEST V95、SPEC 59。

56. **M55 撤掉 hold 兜底 + 日志增强（F184）** ✅：日志证明真凶是"点击后扫邻列触发悬停聚焦"（F183 已修），而 F182 的 **hold 一次性回滚** 反而成了新的可见位移源（指针离开矩阵时把列表"补回"定位位置 = 每次挪下来错动几行）。有真因后兜底必须退场：删掉 `locatedHoldRef` 与回滚分支，user-input 监听改为纯日志。日志增强：每条带 `top`/`sh`（区分"滚动"还是"内容变高"），焦点变化记 `focus` 事件，环形缓冲扩到 80 条。本轮 `node mockup/regress.mjs`：**ALL GREEN (8 checks)**。见 TEST V96、SPEC 60。

57. **M56 矩阵点击面：整块可点、整块手形（F185）** ✅：点击只挂在**格子节点**上（3px 标记带 / 11px 指标行），而格子间有 1px gap、行间 4px margin、左边 46px 标签栏 —— 指针落进缝里时 `closest('[data-idx]')` 返回 `null`，点击被吞、光标仍是箭头（用户："经常不进入点击态"）。改法：① 新增 `columnAt(event, container)` 按几何换算列索引（先 `closest`，取不到就用 x/宽度 比例），`clickColumn` 统一处理（含 F183 悬停锁与 locate）；② 点击改挂**容器**（标记带 1 个 + 三条指标行各 1 个，`data-hades-lane-grid` / `data-hades-row-grid`），删掉 2400 个格子级 onClick；③ 绘图区包装器/容器/网格都 `cursor: pointer`。附带修复：三条指标行的点击原先**没有**设 F183 悬停锁，点进去后指针一动又把行拉回焦点线。`smoke:render` 新增结构断言（1 个标记带容器 + 3 个指标行容器 + 手形光标 ≥4）。本轮 `node mockup/regress.mjs`：**ALL GREEN (8 checks)**。见 TEST V97、SPEC 61。

58. **M57 打开 Step 不再"先上后下"跳一下（F186）** ✅：两个成因同在一个打开动作里——① **几何只在打开态存在**：Step 括号（1px 三边 + 3px 左轨 + `margin: 2px 0`）只写在 open 分支，点击瞬间凭空长出边框与 margin，内容先被顶一次；改为**两个状态都预留同样边框宽度与 margin**（关闭时 `transparent`），打开只变色不改几何。② **内容到达重放展开动画**：`expandMs` 从 0 变 `EXPAND_MS` 让 `Collapse` 打开 effect 重跑，而首帧恒为 `height: 0` → 先缩到 0（"先向上"）再展开（"再向下"）；现在只有"用户打开内容已就绪的 Step"才动画（`expanding`），占位符→真实内容直接吸附。`smoke:render` 新增断言：closed/open 两棵树的边框宽度、margin、上内边距必须完全一致。本轮 `node mockup/regress.mjs`：**ALL GREEN (8 checks)**。见 TEST V98、SPEC 62。

59. **M58 去掉顶层统计指标面板（F187）** ✅：按需求移除矩阵上方的 Runs/Steps/Events · Tokens · Errors/Slow/Abnormal/Slowest 面板。① `OverviewBoard` 不再渲染 `KpiSummary`，矩阵卡成为列表上方唯一卡片；② **删除组件本体**（~40 行）+ 配套 `kpi` useMemo（不再计算无人消费的汇总）+ 只被它用的 8 个 `stat.*` 文案键；③ 注释同步（顶部结构说明 / `renderHeader` / app-shell 的"KPI + matrix"措辞）。保留：矩阵图例、悬停读数、滑块窗口、跟随与 `↓ Latest`。回归：`smoke:render` 去掉被删组件；`check-served` 加**反向断言**（`function KpiSummary` / `stat.runs` / `stat.slowest` 不得再出现）。本轮 `node mockup/regress.mjs`：**ALL GREEN (8 checks)**。见 TEST V99、SPEC 63。

60. **M59 Step 乱序打开的跳动：Collapse 两条竞态（F188）** ✅：① **外层面板跟着内层动画一起动** —— Run 面板的"内容增高跟随"以 `children` 为依赖，每次渲染都跑；内层 Step 正在做高度动画时，外层拿过期 `prev` 去 animate 到当前 `scrollHeight`，两个高度动画互相拉扯 → 先跳再跟上。改为**先检查子树里是否已有 height 动画在跑**（`getAnimations({subtree:true})` 过滤关键帧含 `height` 且 running），有就跳过并刷新基线。② **重跑打开效果从 0 开始** —— `expandMs` 变化会让打开效果重跑，首帧恒为 `height: 0` → 塌到 0 再长回。改为 `from = min(heightRef.current ?? 0, height)` 起算，首次打开仍是 `[0, height]`。**回归新增 `collapse` 检查**：直接抽取 client.js 两个 `useLayoutEffect` 的函数体，在 Node 里用假元素跑 4 个场景；对照实验（`control-f188.mjs` 回退修复）立刻变红。本轮 `node mockup/regress.mjs`：**ALL GREEN (9 checks)**。见 TEST V100、SPEC 64。

62. **M62 每个操作卡片内部的切面 Tab（F191）** ✅：按用户两次确认的方案实现 —— 切面 Tab 放在**每张操作卡片内部**，默认该卡主内容。REPLY 卡 `reply/raw`；TOOL 卡 `args/result/raw`（默认 args，result 错误红框 + 空结果提示，raw 就地渲染 call+result JSON）；CTX/注释保持原样。`facets` 用 Map 按 `a:<seq>` / `t:<seq>` 记忆，切切面只重渲染不重新请求，Tab 点击 stopPropagation。回归：`smoke:render` 断言切面序列 `reply/raw/args/result/raw` + 默认正文，`check-served` 加 `data-hades-facet` 等标记。本轮 `node mockup/regress.mjs`：**ALL GREEN (9 checks)**。见 TEST V102、SPEC 66。
## 8. 待开工确认清单（第 0 步执行）

- [x] 主对话区视图注册机制（R2）：`conversation.view` 槽（`@deepseek-ai/dsh-client-ui-conversation`，已读 trajectory 源码）。
- [x] 数据桥写法（R1）：`webServer.register`（prefix `/api/trace-analyzer`）+ `connection.requestRejection` 围栏 + 客户端同源 `fetch`（读 `host-open-in-app` 源码定型）。
- [x] client Body 读取 `sessionId`（slot `inject` 注入）与 `t`（locale 注入）；`inject = ['slots', 'locale']`。
- [ ] 补全 `SessionEventMap` 完整事件类型清单（截断部分）。
- [ ] 确认 `assistant/attempt` 与 `request/header` 的耗时计算口径。
- [ ] 性能改造后确认：首屏 payload ≤ 64 KB（P01）、下行无 `"stream"`（P05）、展开 run 只发一次 `/run`（V20）。
