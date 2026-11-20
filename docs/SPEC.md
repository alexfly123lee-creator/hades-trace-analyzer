# Trace 分析面板插件 — 功能规格（SPEC）

> 配套 `../agent.md`。本文定义可验收的功能需求（F 系列）、界面结构、数据契约与非功能约束。每条需求给出验收标准（AC），测试用例对应 `docs/TEST.md` 中的用例 ID。

## 1. 术语

- **会话/事件日志**：DSH 会话的 `SessionEvent` 有序序列（`seq` 递增）。
- **run / step**：一条真实用户指令的完整执行为 run（统计单位，run0=系统提示词，run1=第一条真实 prompt）；run 内模型循环的一步为 step。
- **surface**：事件在会话表面中的状态：`current`（当前有效）/ `shadowed`（被替换遮蔽）/ `log-only`（仅日志）。

## 1.1 数据来源与字段契约（核心结论）

> **结论**：本插件所需的全部 trace 数据（概述 / 参数 / 结果 / 计时 / Token / 模型）都来自 **DSH 核心会话事件日志**（`SessionEvent` 序列），由核心会话层落盘，**不依赖、也不需要「轨迹（Trajectory）」插件存在**。轨迹插件 `@deepseek-ai/dsh-client-ui-trajectory` 只是一个**只读查看器**：它把同一份会话事件投影成自己的 UI 行；删掉它只失去那套 UI，数据仍在日志里。

### 1.1.1 为什么与轨迹插件无关

- **数据落盘方是核心会话层**：`session-log-deepseek` / `session-persistence-jsonl` 负责把 `assistant/message`、`tool/call`、`tool/result`、`step/start`、`step/end` 等事件写入 `session.v4.jsonl.zstd`。轨迹插件是 `dsh.client.platform: 'web'` 的客户端 UI，本身不写会话日志。
- **轨迹的「参数/结果」直接读事件字段**（其源码 `trajectory-tool-definition.ts`：读 `tool/call.data.arguments`、`tool/result.data.message.content` 等）；`trajectory-event-projection.ts` / `trajectory-snapshot-builder.ts` 只做「事件 → 视图行」的投影，不生产数据。
- **本插件读同一份日志**：通过 `sessionQuery.readSession(sessionId)` 拿到完整 `SessionEvent[]`，与轨迹互不影响；移除轨迹插件不影响本插件。

### 1.1.2 四类数据的字段契约

| 轨迹里看到的 | 来源事件 | 字段 | 是否现成 |
|---|---|---|---|
| 概述 | `assistant/message` | `data.message.content[]`（`reasoning` 思考 / `text` 回复 / `tool-call` 调用名+参数） | ✅ |
| 参数 | `tool/call` | `data.name` + `data.arguments`（JSON 字符串） | ✅ |
| 结果 | `tool/result` | `data.message.content[]`（输出）+ `data.message.isError`（是否报错）+ `data.error` | ✅ |
| 计时 | `step/start` / `step/end` | `time`（起止）；`assistant/message.data.stream[]` 有逐 chunk `time`/`dt` | ✅ |
| Token | `assistant/message` | `data.usage`（input/output/cacheRead/cacheWrite/totalTokens） | ✅ |
| 模型 | `assistant/message` / `request/header` | `data.source`（provider/model）/ `data.header.config` | ✅ |

**调用配对**：`tool/call.data.callId` ↔ `tool/result.data.message.source.callId`（或 `toolCallId`），据此算「调用→结果」耗时。

### 1.1.3 唯一例外（如实标注）

轨迹 Host 半的 `SessionToolResults`（`src/index.ts`）仅为**实时会话**在内存保留 tool 的**原始返回值** `result.value`（比 `tool/result.message.content` 更完整的结构化值），**冷读不可用**。因此「原始 tool 结构化返回值」不是持久化数据；但本规格所需的「结果」文本已在对局日志的 `tool/result.message.content` 中，无需该实时能力。

## 2. 视图与形态

- **F01 视图注册**：注册主对话区视图（`ctx.slots.inject('conversation.view', () => ctx.slots.register({ name:'conversation.view', id:'hades-eye', order:11, locale:NS, label, inject:(sessionId)=>({ sessionId }) }, Body))`）。
  - AC：对话区视图环（紧邻内置「轨迹」右侧）出现「Trace Lab」Tab（zh/en「Trace Lab」）；点击打开分析视图，标题走 locale。
- **F02 作用域**：仅分析当前打开会话，跟随 session 切换。
  - AC：切换会话后 Tab 内容自动重建为对应会话数据，不残留上一会话。
- **F03 打开入口**：视图环上的「Trace Lab」Tab 即入口，点击打开/切换。
  - AC：点击 Tab 打开视图；与「对话 / 轨迹」Tab 同排、互斥切换。
- **F04 空态**：无会话/无事件时给出引导文案，不崩溃。
  - AC：空白会话打开 Tab 显示空态，不报错、无空白异常。

## 3. 数据加载与实时性

- **F10 阶段化加载**：进入视图只请求轻量 run 清单（`/runs`，见 §16），不再整包 `readSession`；展开 run 才请求该 run 的 step/操作（`/run`）。
  - AC：打开视图时只发一次 `/runs`；KPI + run 表立即可见（KB 级 payload，见 F120）。
- **F11 实时跟随**：会话运行中，通过 Host 侧 `session/event` 订阅增量事件，追加到时间线尾部。
  - AC：模型产出 assistant 消息 / tool 结果时，视图实时出现新事件，无需手动操作。
- **F12 手动刷新**：提供「刷新」按钮，清空客户端缓存并重建完整快照。
  - AC：点击后重新请求 `/runs` 并重绘，计量数值更新，无重复行。
- **F13 加载失败处理**：读取失败（会话不存在、权限等）展示错误态 + 重试。
  - AC：错误有可读文案与「重试」按钮，重试可恢复。

## 4. 运行总览（核心视图，单视图无 tab）

- **F20 单视图**：概览 + 时间线合并为一张可展开的 run 表（无 tab）；统计单位统一为 **run**（一次指令执行）。
  - AC：单一视图，KPI + run 表直接呈现，无需切 tab。
- **F21 KPI 卡片**：顶部大数字卡片（run/step/事件/Token/错误/慢/异常 run/最慢操作），全宽自适应换列，异常类用语义色高亮。
  - AC：关键指标一眼可见；`最慢操作` 带上下文（工具名）。
- **F22 run 表**：每 run 一行，列序为「Turn index（最左）→ 170px 时间条 → 70px 时间数值 → 112px Token 条 → 50px Token 数值（轨道定长；数值在固定宽度格右对齐；时间统一用秒（`0.58s` / `19.10s` / `94.6s`）、数字与单位无空格，Token 只写 `18.3k` 不带 tok；表头标签为 `Time` / `Token`，**左边缘与柱子左边缘齐平**（标签只压在柱子列上，数字列不设表头））→ Turn 内容 prompt（自适应撑满）→ 状态点」，支持**按 Time / 按 Token 排序**（FLIP 动效）；表头两列是**整列热区**的排序控件（F132），`⇅` 常驻、三态循环「降序 → 升序 → 取消」，取消后回到自然顺序（run0→runN）。
  - AC：切换排序即时重排并带过渡动画；表头任何位置（条槽 + 数字槽）都能点；再点同列先反向、再取消回自然序；Turn index 在左、内容可读、数值清晰右对齐在条内。
- **F23 就地展开**：点 run 行 → 就地展开该 run 的 step 列表；step 行（连同括号）**整体内缩 16px**，与 run 行错开一级（层级靠缩进）；**Step 条上的数值与 Turn 条完全一致地排布在条内右侧**（共用同一组件），另一维度（Token 或耗时）作为条后 muted 小字常驻；条形态仍随排序键切换（按时间=甘特、按 Token=占比条）。
  - AC：点行就地展开/折叠；`step N` 与 `run N` 对齐；step 条内数值的位置/字号/颜色与 turn 条一致；两个维度都可见。
- **F23.1 Step 行标题（动词 + 对象）**：step 行不再直甩正文或参数原文，而是压成一行标题——① 有 assistant 文本 → **首句**（剥 markdown/代码块，≤42 字，未闭合括号不切半），若同一步也调了工具，动作降为副标题（`修改 ×3` / `查 + 抓`）；② 单工具 → `动词 + 对象`（`读取 client.js:226` / `修改 client.js` / `搜 「sortCol」` / `运行 · <命令描述>` / `交付 x.html`），对象取**具名字段**（`file_path` / `pattern` / `description`）而非 JSON 第一个字符串；③ 多工具 → 首个动作 + `+N 次调用`；④ 无文本无工具但有害义事件 → 用该事件当标题（`压缩 12.5k tok` / `失败 RATE_LIMIT`）；⑤ 模型空回复 → `空回复`；⑥ 只有注入 → `仅注入上下文`；⑦ 其余 `—`。
  - **副标题与标记**：`· 修改 ×3`（动作摘要）；标记来自无文本事件（F23.2），**最多 2 个**、与标题重复时省略，`失败`=error 色 / `重试`=warn 色 / 其余 muted。
  - **保真**：`text` 仍保留原始长摘要，作为该行 tooltip（hover 全文），压缩标题不丢信息。
  - AC：纯工具 step 也能一眼读出「做了什么 + 对什么做」，不再出现 `tool · 名字 · 绝对路径`；标题长度 p90 ≤ 40 字；hover 仍能看到完整原文；展开/排序/主题切换不受影响。
- **F23.2 Step 说明行（无文本事件）**：压缩 / 重试 / 失败 / 文件变更 / 斜杠命令 / 计划模式 / 清单 / 交付 / 审批 这些原本被整条丢弃的事件，在 step 详情里各占一行 muted 说明行（`[压缩] 压缩 12.5k tok`、`[命令] /export`），按事件顺序插在原位；说明行的标签同样使用 `RowTag` + 英文词表（`COMPACT` / `RETRY` / `FAIL` / `FILES` / `CMD` / `PLAN` / `TODO` / `DELIVER` / `APPROVAL`），中文在 tooltip；`job/*`、`session-log-deepseek/*`、`request/header`、`permission/*`、`sandbox/*`、`model/selection`、`session/title*` 仍不渲染（与工具一一对应或纯传输/元数据）。
  - AC：耗时异常或「看起来没内容」的 step 打开后能直接看到原因（压缩/重试/失败）；说明行不抢主内容、不改变行高节奏。
- **F24 全宽 + 滚动**：面板随窗口无限铺满，纵向滚动流畅。
  - AC：无宽度上限；5000+ 事件会话首屏仍为 KB 级 payload，不卡死（见 §15）。

> 已移除：血缘 tab、F25（血缘）、§5 会话血缘树（F30–F32）——官方轨迹无此数据类目。

## 6. Token 用量统计

- **F40 总览**：聚合全部 `assistant/message.usage` 得总量与分项。
  - AC：展示 input / output / cacheRead / cacheWrite / reasoning 总量（缺失项显示 `-`）。
- **F41 按 run 分布**：按 run 汇总 token，展示表格 + 简单柱状图。
  - AC：每个 run 的 token 用量可查，能定位 token 高峰。
- **F42 单事件用量**：在事件详情中显示该 `assistant/message` 的 `usage`。
  - AC：详情里 token 分项可读。

## 7. 耗时 / 性能分析

- **F50 统计口径**：以事件 `time` 差计算耗时，配对依据事件类型（`tool/call`→`tool/result` 按 `callId`，`request/header`/`assistant/attempt` 按 run/step 与时间邻接）。
  - AC：口径在 UI 或文档中说明；无法可靠配对的项不强行计算。
- **F51 瓶颈列表**：按耗时降序列出 top-N 慢事件（tool / step / LLM 调用）。
  - AC：列表给出事件类型、耗时、所在 run/step，可点击跳详情。
- **F52 统计总览**：总事件数、总 run 数、总耗时、平均耗时、最长单事件。
  - AC：统计卡在视图顶部展示。

## 8. 异常工具链自动高亮

- **F60 错误高亮**：`tool/result.error` 非空的工具链行以错误色标出。
  - AC：失败工具调用醒目，点开可见 error 详情。
- **F61 耗时阈值高亮**：工具耗时超过 `highlight.toolDurationMs`（默认 5000ms）高亮。
  - AC：超阈值事件在时间线/列表中以告警色标出；阈值来自 Config。
- **F62 token 阈值高亮**：单步 token 增量超过 `highlight.toolTokenDelta`（默认 0=关闭）时高亮。
  - AC：开启且超阈值时高亮；关闭时不高亮。
- **F63 高亮聚合提示**：视图给出「异常 N 项」汇总，可一键过滤只看异常。
  - AC：异常项可定位、可过滤、可清除过滤。

## 9. 事件详情查看器

- **F70 完整 JSON**：`readEvent` 返回的完整事件以 pretty + 语法高亮 JSON 展示。
  - AC：字段完整、可折叠；`data` 内大对象可展开。
- **F71 溯源链**：`traceEvent` 展示 `replacementChain` / `replacedEventSeqs` / `sourceEventSeqs` / `derivedEventSeqs`，并附 `replacedBy`。
  - AC：来源/替换关系可读，相关 `seq` 可点击跳到对应事件。
- **F72 surface 标记**：展示事件 surface 状态及其含义。
  - AC：`current`/`shadowed`/`log-only` 清晰标注。
- **F73 上下文窗口**：展示 `readEvent` 的 `before/after` 邻接事件。
  - AC：可看到目标事件前后文。

## 10. 搜索与过滤

- **F80 过滤维度**：按事件类型、surface、时间范围过滤；文本搜索走 `filterEvents`。
  - AC：多条件可叠加；结果按 `seq` 升序；高亮命中文本。
- **F81 搜索输入**：关键词搜索，返回匹配事件（`SessionEventSearchDocument.text`）。
  - AC：结果可点击跳详情；无结果显示空态。
- **F82 过滤状态**：当前过滤条件可视化、可一键清除。
  - AC：过滤器状态明确、可重置。

## 11. 导出

- **F90 单事件导出**：详情中的事件可导出为 JSON 或一键复制。
  - AC：复制到剪贴板内容为合法 JSON；导出文件为 `.json`。
- **F91 整段导出**：当前会话事件可导出为 JSONL（每行一个事件）或 JSON 数组。
  - AC：导出文件内容与 `readSession` 事件一致，行序为 `seq` 升序。
- **F92 导出范围**：导出遵循当前过滤（可选「全部 / 当前过滤结果」）。
  - AC：选择过滤结果时只导出命中项。

## 12. 主题与本地化

- **F100 主题适配**：只用 `--dsw-alias-*` 主题 token，深浅色自动跟随宿主。
  - AC：明暗两种主题下对比度正常、无写死颜色导致的看不清。
- **F101 本地化**：UI 文案走 `ctx.locale`；提供 zh（主）与 en。
  - AC：切换宿主语言后文案随之切换，无硬编码中文/英文。

## 13. 配置

- **F110 Config 声明**：`export const Config` 声明 §6（agent.md）所列配置项及校验。
  - AC：`Config.listConfigs` 可见 schema；非法值被拒绝。
- **F111 阈值生效**：修改 `highlight.*` 阈值后刷新生效，无需重启（HMR）。
  - AC：改动配置后视图重算高亮。

## 14. 非功能约束

- **NF1 只读**：插件不追加/修改会话事件、不写会话日志。
- **NF2 隔离**：不 `require` Harness Client 包、不自写 DOM 到 `document.body`、不 iframe、不读其他插件 DOM。
- **NF3 资源清理**：所有定时器/订阅/事件监听在 `ctx.effect` 内注册并返回清理。
- **NF4 性能**：首屏 payload ≤ 64 KB、解析 ≤ 10 ms、服务端 ≤ 50 ms（F120–F127）；大会话（≥5000 事件）展开仍流畅；token/耗时聚合为纯函数、结果可缓存。
- **NF6 下行最小化**：默认不下发事件原文；只有用户显式展开操作时才拉取单事件窗口。
- **NF5 无障碍**：交互控件有 `aria` 语义；色带/高亮不单靠颜色表达（配图标/文字）。

## 15. 性能与加载架构（M6）

> 背景与实测基线见 `agent.md` §4.7。总原则：**首屏只下发 KB 级投影，明细按需拉，原文按需取。**

- **F120 阶段化加载**：视图打开只请求 `/runs`（KPI + run 行），展开某 run 才请求 `/run`（该 run 的 step 索引），展开某 step 才请求 `/step`（该 step 的内容），点「原文」才请求 `/event`。
  - AC：打开视图仅一次 `/runs`；展开 run 才出现一次 `/run`；点开 step 才出现一次 `/step`；未点「原文」不请求 `/event`。
- **F121 下行数据裁剪**：任何响应都不含 `SessionEvent` 全文；`assistant/message.data.stream`（流式块）永不进入下行数据。
  - AC：`/runs`、`/run`、`/step` 响应中 `"stream"` 出现次数为 0；事件原文只能经 `/event` 获取。
- **F122 体积上限**：参考规模会话（≥6000 事件 / ≥70 run）实测：首屏 `/runs` 51.8 KB（≤64 KB）；`/run` 步索引 p50 1.8 / p90 6.5 / max 39.8 KB（≤4 / 16 / 128 KB）；`/step` 内容 p50 1.2 / p95 2.2 / max 7.5 KB（≤2 / 8 / 16 KB），解析 ≤5 ms。
  - AC：实测值写入 TEST §5；超限即不通过。
- **F123 会话级缓存**：同一会话重复打开 Tab、切走再切回复用已加载数据，不发新请求；「刷新」清缓存后重建。
  - AC：表头显示「缓存命中」；点刷新后重新请求并更新计量。
- **F124 加载计量**：表头常驻显示首屏实测耗时与 payload 体积（客户端计时 + 服务端构建耗时）。
  - AC：数值随打开/刷新更新，可作为验收证据比对。
- **F125 数字一致性**：改造后 KPI 与 run/step 分组结果与全量快照算法完全一致（不得因裁剪数据而改变统计）。
  - AC：自动化比对（run 数、step 数、事件数、token 各分项、错误数、慢操作数、异常 run 数、最慢操作）全部相等。
- **F126 服务端快照缓存**：同一会话在日志偏移（`session.seq`）未变化时，展开 run 不重复读取会话事件。
  - AC：连续展开多个 run，服务端耗时保持个位数毫秒；日志偏移变化后自动重建。
- **F127 实时会话内存路径**：活动（live）会话通过 `inspectSession` 读内存事件日志，冷/持久化会话回退 `readSession`；两条路径产出的一致结果由同一份聚合纯函数保证。
  - AC：live 会话 `/runs` 服务端耗时 ≤ 50 ms（实测 0.9–8.2 ms，对照 `readSession` 880–986 ms）；同一会话两种路径的事件数（5996）与统计结果一致。

## 16. Step 内容与选中态（F128–F138）

- **F128 Run/Step 高亮跟随展开**：不单独维护「选中某一行」——**展开即高亮、收起即恢复**。展开的 Run 行保持 8% 淡蓝底 + 1px 35% 内环（分组底色 4%→7%、序号主文字色）；展开的 Step 行保持 22% 底色（无环，被括号裁切），其下的 Step 括号容器为 accent 11% 蓝底 + 3px 蓝轨 + 1px 38% 真边框，「行被展开」与「容器」是同一个状态的颜色暗示；可同时展开多个 Run/Step，各自保持高亮。
  - AC：展开的 Run 行与 Step 行各自保持高亮；收起后立即恢复普通行；多个展开项同时高亮互不干扰；切换排序时展开状态与高亮保持；高亮不改变行高（只用 background/box-shadow，不破坏 FLIP）。
  - AC（可达性）：step 行 `role="button"`、`tabIndex=0`、`aria-expanded`/`aria-pressed`，Enter/Space 可切换；深浅色主题下轨道与底色对比度正常。
- **F129 Step 括号容器 + 有序活动清单（Step 行与明细同框，无嵌套）**：点开 step 后，**该 step 行与其下方明细被同一个括号容器托住**——**括号描边不变、底色去掉**：1px `accent 38%` 描边 + `border-left: 3px` 蓝轨 + `radius-md`，`background: transparent` + `radius-md`（`margin: 2px 0 2px 16px`，**Step 层级内缩 16px**，与 Run 分组轨道错开），明细区在容器内再缩进 74px 且自身透明；收起的 Step 行同样保留 16px 缩进（展开/收起不左右跳）。层级：Run 分组为中性灰面 + 灰轨，Step 括号为 accent 6% 淡蓝底 + 蓝轨，展开的 Step 行为 16% + 60% 环——颜色焦点落在 Step 层，所以「行被展开」与「它下面的容器」是同一个状态的颜色暗示。明细区头部为**构成概览**（模型 · 模型调用 N · 工具调用 N · 上下文 N · 计时 · Token in/out/cache），下方按事件 `seq` **顺序**逐行列出该 step 的痕迹：`[用户] 指令`（可选）→ `[助手] 模型调用`（token + 文本）→ `[工具] tool · 名称 · 耗时`（参数 / 结果，错误红、慢橙）→ `[上下文] 注入` → `[系统] 系统提示词`；工具结果折叠进对应工具行；行间不画分隔线，以留白分隔（极简大纲）；每行尾部可选「原文」单层开关。
  - AC：展开任一 step，Step 行与其明细被同一个括号容器包住（淡蓝底/3px 左轨/1px 内环/圆角），Step 行自身高亮与容器同色相（更强一档）；行序与事件顺序一致（不再按类型分组）；工具结果不单独成行；报错工具行红色并显示错误码；无内容时显示空态；「原文」按需加载且默认收起。
  - 数据契约：`/step` 返回 `{ idx, step, startTime, endTime, timeMs, model, usage, counts:{models,tools,contexts}, operations:[{kind:'assistant'|'tool'|'context'|'system', seq, …}], slowMs, serverMs }`；`assistant` 带 `text`/`usage`，`tool` 带 `callSeq`/`resultSeq`/`name`/`args`/`result`/`error`/`isError`/`durationMs`，`context`/`system` 带 `text`；文本与参数/结果各截断 400 字符。
- **F130 Run–Step 分组整体性**：Run 行与其展开的全部 Step 处于同一个括号范围（1px `accent 25%` 描边 + 3px 蓝轨 + 圆角，**无底色**），与 Step 的缩进括号形成层级，「整体」由展开状态决定，不依赖是否选中。
  - AC：展开 run 后，run 行与所有 step 在同一着色块内、左轨连续；折叠后恢复普通行；分组样式不改变行高/列宽。
- **F131 角色标识（actor，与内置「轨迹」对齐）**：kind 集合、中文标签、配色、标签几何全部沿用轨迹的 `kindTag`：
  - `user` 用户 / `assistant` 助手 / `context` 上下文 / `system` 系统 / `tool` 工具（轨迹的 `subtool`/`compacted` 本插件不产生，未覆盖）。
  - **落位**：Run 行在指标条后一枚（触发者：run0=`system`、其余=`user`）；**Step 行不放**；Step 展开容器的每行各一枚——`[用户] 指令`（run 由用户发起且是该 run 第 1 个 step）、`[助手] 模型调用`、`[工具] tool · 名称 · 耗时`、`[上下文] 注入`、`[系统] 系统提示词`；容器头的构成概览不带角色标签。
  - 映射：`assistant/message` 与 `request/*` → `assistant`；`tool/call`·`tool/result` → `tool`；`developer/message` 与非 `source.kind==='user'` 的 `user/message` → `context`；`system/message` → `system`；真实 `user/message` → `user`。
  - AC：Run 行角色与轨迹同款（标签文字/配色/19px 高/10px/650 字重一致）；Step 行**不出现**角色标签；Step 明细行按上表各带标签，颜色与轨迹一致；空 step 仍显示空态；深浅色主题下均可辨识（带文字，不只靠颜色）。
- **F132 列头排序控件（可点击暗示）**：表头 `Time` / `Token` 不是纯文字标签，而是**柱子列上的排序按钮**——热区 = **条槽**（170px / 112px），标签左边缘与柱子左边缘齐平、箭头跟在标签右侧；表头单元格宽度仍与行一致（246 / 168px）以保证列位置不漂移；`⇅` 双箭头**常驻**（未排序两枚各 35%），排序生效**只点亮当前方向**（↓ 或 ↑ 100%、另一枚 22%）且标签转列主色（Time=`trajectory-accent`、Token=`chart-tools`）；三态循环 **默认（run0→runN）→ 降序 → 升序 → 默认**；hover / 键盘聚焦时整列出现 8% accent 底 + 底部 1px 55% 线，把可点区域画出来；排序生效时列右侧出现状态胶囊「已按 Time ↓ 排序 ✕」，✕ 一键清除（不必猜「再点一次是反向还是取消」）；`aria-sort` 取 `descending` / `ascending` / `none`，title 说明下一击行为。
  - AC：不点任何东西也能看出「可排序」（常驻双箭头，不再依赖激活后才出现的 ↓）；点列内任意位置命中同一控件；图标占固定槽位、排序不引起列宽/行高/文字位置变化；标签左边缘与下方柱子左边缘齐平；深浅主题下 35% / 8% / 55% 三档均可辨识。
- **F136 行标签统一（Turn 角色 / Step 动作）**：两级用**同一个标签组件、同一套几何、同一个位置**，只换词表：
  - **几何（共用）**：高 20px、`padding: 0 6px`、`font-size 11px / line-height 17px / weight 650 / letter-spacing .035em`、1px 透明边框、`radius-xs`、`white-space: nowrap`（与官方轨迹 `kindTag` 一致）；
  - **位置（共用）**：指标条之后、正文之前，作为行的一个独立 flex 子项（行内 gap 10），不参与正文的省略号截断；
  - **词表（分层，统一英文）**：Turn 行 = 角色 `USER` / `SYSTEM`；Step 行 = 动作 `READ` / `EDIT` / `RUN` / `REPLY` / `FAIL` / `DELIVER` / `COMPACT` / `SYSTEM` / `CONTEXT` / `TOOL` …（与 `run` / `step` / `Time` / `Token` 同一语言）；**中文原文保留在标签 tooltip 里**；
  - **配色（共用一套 token）**：角色用 `ROLE` 五色（business / assistant / success / label-secondary / warn）；动作**映射到同一套颜色** —— 工具类动作 = `warn`（与 `工具` 角色同色）、`回复` = assistant、`系统提示词` = system、`仅注入上下文` = success、`失败` = error、`重试`/`压缩` = warn。
  - AC：同一行内标签与指标条基线对齐、高度一致；Turn 与 Step 的标签在同一列起点（Step 按层级缩进）；不出现两套字号/圆角/内边距；标签一律英文大写，中文只在 tooltip。
- **F135 Step 行标签式命名**：行标题 = **一枚或多枚动作标签**（chip，多枚见 F137）+ 对象文本，标签由 host 在 `stepTitle()` 里产出（`tag` / `tags` 字段），客户端只负责渲染：
  - 标签取值 = 标题首个词（`读取` / `修改` / `运行` / `搜` / `找` / `看图` / `写` / `交付` / `插件` / `技能` / `清单` / `提问` / `查` / `压缩` / `重试` / `失败` / `提交计划` / `系统提示词` / `空回复` / `仅注入上下文` / `回复`）；
  - **兜底词折叠**：`运行命令→运行`、`写文件→写`、`读取文件→读取`、`搜索→搜`、`插件管理→插件`、`加载技能→技能`、`更新清单→清单`、`抓网页→抓`、`tool · X→工具`，避免"运行 运行命令"这类重复；
  - 有模型文本的行用 `回复` 标签 + 首句；
  - 配色只承载语义：`失败`=error、`重试`/`压缩`=warn、`交付`/`回复`/`提问`/`提交计划`=品牌色、其余中性；几何与轨迹 `kindTag` 对齐（19px 高 / 10px / 650 / 1px 边框 / radius-xs，与 F136 同款）；
  - AC：每行都可读出「类别 + 对象」；同动词标签宽度恒定、不随对象跳动；标签不参与省略号截断；对象为空时只显示标签（如 `系统提示词`、`上下文压缩`）。- **F134 工具配对去重**：同一 `callId` 出现多个 `tool/result`（会话恢复后日志会重复投递）时，配对取**第一个** result，`durationMs = max(0, result.time − call.time)`。否则会把几小时后的重复结果当成同一调用的结束时间：参考会话实测最长工具耗时 **54,413s**，修复后为 **785.4s**（真实的「等你回答」工具）。
  - AC：工具行耗时不再出现小时级数值；`最慢操作` KPI 与真实等待一致；同一 callId 的重复 result 不影响 step 内容面板。
- **F133 step 耗时 = 模型 + 工具（等人不计入）**：官方轨迹把时间放在两处——**Step 组头**是组内记录的墙钟跨度（含工具，`layout.ts groupDescription`），**assistant 记录详情**是模型耗时（`TrajectoryTable.totalTime`）。本插件把两者合成一个"执行耗时"，并把"等人"剥离出来：
  - `modelMs = assistant/message.time − step/start.time`（与官方 assistant 总耗时逐值一致）；
  - `toolMs = Σ 工具 durationMs`（剔除人机等待：`ask_user_question` / `exit_plan_mode` / `plugin_manager` 且 ≥5s）；与官方工具记录的 `timeSeconds` 逐值一致（仅在等待步上差额 = waitMs）；
  - `waitMs = Σ 上述等待工具时长`，**单独展示**（行上 `⏸ 13.1min`、tooltip 与面板分段），**不加入 timeMs**；
  - `timeMs = modelMs + toolMs`；没有模型调用且无工具的步 → `null`（显示 `—`）；
  - `run.time = Σ 各步 timeMs`（= 该 run 的执行耗时，等于各步之和）。
  - 归属规则不变（`step/start`/`step/end` 窗口、迟到事件不粘附、`agent/inbox/spliced` 丢弃）。
  - AC：`mockup/verify-traj-align.mjs` 独立重算，参考会话 **模型段 2030 步 0 差异、合计 15,794.07s 双边相等**；工具段差额恰等于 `waitMs`（4,733.84 − 3,556.21 = 1,177.63s）；run 1 = **1,097.7s（18.3min）**。

- **F137 Step 行多动作标签**：一枚 chip 装不下一个 step 的全部工作。一个 step 里出现**不同**动作时，按**调用顺序**每个动作各给一枚 chip（最多 3 枚）；同一动作重复则折叠成计数（`EDIT ×6`），不会因为「改了 6 个文件」而多占 5 格；超过 3 种不同动作时，多出来的折叠成一枚中性 `+N` chip。行标题（对象文本）仍取**第一次调用**的对象，不因 chip 变多而跳字。
  - **词表与 F135 同源**：每枚 chip 的名字 = 该次调用按 `leadTag()` 算出的词（`读取` / `修改` / `运行` / `搜` / `找` / `看图` / `写` / `交付` / `插件` / `技能` / `清单` / `提问` / `查` / `提交计划` / `取运行环境` / `工具` …），因此不会出现 `取运行环境` 与 `取环境` 两枚 chip 指同一个动作；客户端只用 `STEP_TAG_EN` 一张表把词映射成 `READ` / `EDIT` / … 。
  - **回复类 step**：`REPLY` 打头，其后是这一步实际调用的动作 chip（`REPLY` + `EDIT ×6`）。原先写成文字后缀的 `· 修改 ×6` / `· +2 次调用` **取消**——调用次数已由 chip 的 `×n` 承载，`suffix` 字段从行数据里移除。
  - **几何不变**：每枚 chip 与 F136 同款（20px / 11px / 650 / `.035em` / radius-xs），行内 gap 10，chip 行不参与标题的省略号截断；多枚 chip 不改变行高、不改变 Time/Token 列位置。
  - **配色只承载语义**：`REPLY` = assistant、`FAIL` = error、其余动作 = 工具色；`+N` 用中性 faint 色（不与真动作抢注意力）。
  - **数据契约**：`/run` 的 step 项新增 `tags: [{ tag, count, overflow? }]`（`tag` 字段保留 = 首枚，向后兼容），`suffix` 移除。
  - **AC**：参考会话 2275 步 → 2125 步仍是 1 枚 chip（与 F135 完全一致）、148 步 2 枚、2 步 3 枚（`REPLY INSPECT FETCH`）、0 步 overflow；`查 listService` 显示 `INSPECT ×2 READ`；`修改 6 个文件` 显示 `EDIT ×6`；每步「chip 上的 `×n` 之和」覆盖该步全部 `tool/call`（`mockup/verify-chips.mjs` 断言 0 问题，并校验 `tags[0] === tag`）；chip 一律英文大写、中文在 tooltip；多 chip 行在三档缩进（run / step / 面板）下都不换行。
  - **开销**：`stepTitle()` 全量 11.5–13.7 ms，与「关掉 chip」的 A/B 差异落在噪声内（单调用 step 仍走原来的捷径、chip 词表不扫参数）；`/runs` payload 字节完全不变（该路由不含 step 标题）。
- **F138 性能加固与"卡顿可自证"**：把插件自身在宿主机 / 渲染进程里的占用收敛，并让"卡是不是我们"变成屏幕上的数字。
  - **客户端缓存有界**：`cache.{runs,run,step,event}` 由无界 Map 改为 LRU（runs 6 / run 40 / step 240 / event 160 条），超出淘汰最旧条目。原来长时间使用后所有打开过的 step 都留在渲染进程堆里。
  - **在途请求可取消**：`/runs` 请求带 `AbortController`，面板卸载或切会话时 abort（原来只有 `cancelled` 标志，请求仍跑完并解析 JSON）。
  - **长 run 分页**：单个 run 的 step 行超过 **80** 条时只渲染前 80 行，末尾给「显示全部 N 步（还有 M 步）」；避免 200+ 步的 run 一次挂上几千个节点（本会话实测最长 run 211 步）。
  - **渲染计量**：Body 记录本次构建耗时，≥ 8 ms 时表头显示「渲染 x ms」，与服务端耗时、首屏体积并列——卡顿时先看这个数字再怀疑是谁。
  - **Host 缓存遥测**：`/health` 增加 `cache: { sessions, max, events, seqs, lastBuild: { ms, events, at } }` 与 `uptimeMs`；快照缓存上限 **8 → 4 个会话**（单会话始终只保留最新一条，键 = `sessionId`，按 `seq` 校验命中），按实测 5.9 MB/条，上限从 ~47 MB 降到 ~24 MB。
  - **AC**：`check-served` 34/34 标记通过（含 `cacheSet` / `STEP_PAGE` / `perf.lastBuildMs` / `AbortController`）；`verify-perf` **9/9**（P02 改为「暖态中位 ≤ 50 ms」= 42.5 ms，冷首建 56.2 ms 单列报告）；`/health` 实测 `cache.events=17955`、`lastBuild.ms=42.8`；211 步的 run 默认 80 行 + 按钮，点开后可继续展开；切会话/卸载后不再有在途 `/runs`；闲置 8 s 全部 DSH 进程 CPU 合计 **0.6%**（无轮询）。

## 17. 可读性基线（F139）

- **F139 整页字号 / 行宽 / 行距放大一档**：面板此前的最小字号 10px、正文 12px、行高 1.45、行最小高 26px，长时间看 trace 偏吃力。一次性放大并放宽：
  - **字号**：正文 12 → **13**、次要 11 → **12**、极次要 10 → **11**、KPI 大数字 28 → **32**；不再保留 10px 档；
  - **行距 / 行高**：正文 `line-height` 1.45 → **1.6**、行最小高 26 → **30**、行内 `gap` 10 → **12**；
  - **行宽（列宽）**：Time 条 150 → **170**、Token 条 100 → **112**、数字槽 64/46 → **70/50**（排序热区随之 220/152 → **246/168**）；行索引列 64 → **78**（12px 下 `▸ step 199` 约 62px，不能溢出到柱子）；**（这两列的宽度已由 F146 改为等宽 150 / 150，数字槽 70 / 70）**；
  - **标签 chip**：19px 高 / 10px → **20px 高 / 11px**（`line-height` 16 → 17、`padding` 0 5px → 0 6px），几何仍与官方 `kindTag` 同族；
  - **不变量**：表头标签左缘仍与柱子左缘齐平；Run 与 Step 的时间/Token 两列严格同宽；标签与指标条基线对齐；不改字重（正文仍 400，标签仍 650）。
  - **AC**：`▸ step 199`、`99.99s`、`126k`、`EDIT ×6` 均不溢出、不换行；表头与柱子对齐关系不变；`check-served` 34/34（另外对已服务 bundle 断言 `RUN_IDX_W=78` / `TIME_W=170` / `TOKEN_W=112` / 正文 13px / 无 10px / chip `20px + 0 6px` / `lineHeight 1.6` 共 8 项，0 失败）；40 个单测不变（渲染层改动不触碰聚合）；深浅色主题下正文与次要文字 ≥ 4.5:1。

## 18. 实时刷新（F140）

- **F140 run/step 随对话实时更新**：面板打开期间，新事件落盘后 2 s 内自动出现在表上，不需要点「刷新」。触发机制见 `docs/DESIGN-realtime.md`（R1/R2/R3 三阶段），本期交付 **R1：可见时轮询 + `since` 短路**。
  - **Host**：`/runs` 接受 `since`（客户端已持有的日志偏移）。探测到 `snapshot.seq === since` 时返回 `{ ok, unchanged: true, seq, serverMs }`（**~40 B**，不序列化 payload）；否则照旧返回完整 payload，并在 `meta.seq` 里带上本次构建的偏移；`/health.cache` 增加 `unchangedHits` 计数器。
  - **Client**：仅在 `document.visibilityState === 'visible'` 时每 **2 s** 触发一次 tick；发送 `?since=<meta.seq>`；命中 `unchanged` **不 setState、不重渲染**；页面隐藏即暂停（徽标显示「已暂停」），切回可见立刻补一次（400 ms）。
  - **刷新语义**：run 表整体替换但**保留展开态、排序键与高亮**；已展开的 run 重新取 `/run`（新 step 出现在末尾）；已打开的 step 通过 `refreshToken` 重新取 `/step`，正在跑的工具行从"无结果"变为"有结果 + 耗时"，无需收起再展开。
  - **反馈**：表头常驻徽标 `● 实时` / `⏸ 已暂停` / `⚠ 实时中断`，tooltip 说明"每 2 s 检查一次；未变化时服务端只回 ~40 B"。
  - **AC**：对话里发出指令后切到面板，≤ 2 s 出现新 run/step 行；流式过程中 step 时间持续增长、工具行在结果到达后自动补上耗时；页面隐藏后 2 s 内不再发请求（`/health.cache.unchangedHits` 停止增长）；idle 时每次 tick 的 Host 成本 ~1 ms（未变）/ 43 ms（变更 ≤ 1 次/2 s）；刷新不丢展开/排序；`check-served` 37/37（新增 `realtime.live` / `tickBusy.current` / `refreshToken` 三个标记）；单测 41/41（新增 `meta.seq` 用例）。

## 19. 实时刷新的增量呈现（F141）

- **F141 更新要"长出来"，不能"刷一下"**：F140 的 tick 在**内容有变化**时会替换 payload；如果实现得糙，整张表会重新测量/重绘、柱子跳变、step 面板闪「载入…」，用户看到的就是"页面重新刷新"。F141 把这条路径改成**只动变化的部分**：
  - **空转不写状态**：`unchanged` 的 tick 不再 `setState`（用函数式更新返回 `prev` 让 React bail out）——空闲时每 2 s 一次 tick **不产生任何 React 提交**；
  - **FLIP 只在行序变化时做**：`DualBarChart` 记住上一次的行序（`data-run` 序列），行序未变直接跳过测量与动画；同时把 `getBoundingClientRect().top` 换成 `offsetTop`，滚动再也不会被误判成"所有行都移动了"；
  - **step 面板 stale-while-revalidate**：`refreshToken` 变化时**保留旧内容**继续显示，新切片到达后原地替换；只有首次加载才出现「载入 step 内容…」，刷新时不会再闪空态；
  - **柱子宽度过渡**：Time/Token 条的 `left` / `width` 加 `transition .25s`（F145 起两根条共用同一个过渡），新值不再硬跳，缩放看起来是"长过去"的；
  - **行按 `idx` 复用**：run 行 key = `idx`、step 行 key = 序号、面板活动行 key = `seq`，新事件只新增尾部行、只有数值变更的行重绘。
  - **AC**：面板开着空闲 30 s，React DevTools 里**无 commit**、Performance 面板无 paint；新事件到达时只有新增/变化的行更新，其余行的 DOM 不重建；打开某个 step 观察，面板内容**不出现空态闪烁**，工具行在结果到达时原地长出耗时；切换排序时仍有 FLIP 动画；`check-served` 37/37；单测 41/41。

## 20. Token 的时序切片（F142）

- **F142 step 行的 Token 条 = run 总量的百分比切片，按顺序累加**：展开一个 run 后，**每一行 step 的 token 轨道整条就代表该 run 的总消耗**；第 k 个 step 占据 [累计(k−1), 累计(k)] 那一段——左边缘 = 前面所有 step 的累计占比，宽度 = 它自己占 run 的百分比，各段首尾相接一直铺到 100%。
  - 轨道里：**淡色 = 这一步之前已经花掉的部分**，**深色块 = 这一步自己的份额**，**背景 = 还没花的剩余**；
  - 数字列仍显示这一 step 自己的 token；tooltip 给 1.6k tok · 0.6% of run · 累计 37.7k (14%)；
  - 时间列不变（step 在 run 时间轴上的位置），所以同一行同时给出「时间位置」与「token 位置」；
  - **不用新增字段**：只用 /run 里已有的 per-step 	oken 在客户端累加（/runs 仍是 51.8 KB，P01 门槛维持 64 KB）。初版曾把分布画在 run 行并为此加了 segments 字段，已按反馈改掉。
  - **AC**：112px 轨道上（F146 起为 150px），最后一步切片右边缘恰好 100%；每段宽度 ∝ 该步 token；Σ step.token = run.token（单测断言 5 步累计序列 [110,330,660,1100,1650] 与 run 总量相等）；展开 211 步的 run 仍只渲染 80 行（F138 分页）；样例见 mockup/step-token-preview.png。
## 21. 展开动效（F144）

- **F144 点击展开有平滑动效（方案 C，再收一档）**：展开/折叠不再瞬时切换，而是**高度 + 淡入**，一条统一曲线、**没有逐行 stagger**（最克制的一版，见 mockup/expand-motion-demo.html）。
  - **展开 160ms / 折叠 120ms**：打开时 height 0 → 内容高度、opacity 0 → 1，曲线 cubic-bezier(.2,.7,.3,1)；折叠用更短的 140ms 和 cubic-bezier(.4,0,1,1)，收回要"跟手"。
  - **实现**：Collapse 组件用 WAAPI——打开时量一次 scrollHeight 再 element.animate，动画结束把 height 落回 auto（避免内容再变化时被固定高度裁掉）；**关闭时保留最后一次内容 140ms** 完成收起后才卸载，所以折叠也有动画而不是"啪"地消失。
  - **首次展开不排队**：只有内容已在缓存里（`/run`/`/step` 已到）才做高度动画；首次展开是**立刻出现 + 内容到达后 120ms 跟随长高**（`FOLLOW_MS`），避免先动画一个「载入…」占位符、内容到了再长一次的“双段拖沓”。
  - **按需挂载**：关闭的 run/step 不渲染子树（CSS 0fr→1fr 那套要求常驻 DOM，200 步的 run 会白挂几百个节点，故不用）。
  - **长 run 降级**：run 的 step 数 > 60 时跳过高度动画，改为 **160ms 纯淡入**——7000px 的高度动画每帧都要重排，必然掉帧。
  - **箭头**：▸ 用同一个字符**旋转 90°**（160ms），不再替换 ▸/▾，展开时索引列不会抖动。
  - **只响应用户点击**：动画只在 open 变化时触发；F140 的实时刷新（efreshToken/payload 替换）不会重放动画。
  - **无障碍**：prefers-reduced-motion: reduce 时直接切换，不做任何动画。
  - **AC**：DevTools Performance 录一次展开，动画期间**无 >50ms 长任务**、每帧 ≤16.7ms；快速连点 10 次不出现动画叠加或高度错位；折叠后该 run 的子节点已从 DOM 移除；200 步的 run 是一整块淡入而非缓慢长高；系统开启"减少动态效果"后瞬时切换；check-served 44/44（新增 function Collapse / prefers-reduced-motion 两个标记）；单测 42/42 不变。
## 22. 时间条与 Token 条的统一（F145）

- **F145 两根指标的 bar 只差颜色**：Time 列与 Token 列曾经有三种画法——Run 行是 8px 满高填充、Step 的 Time 是 `top/bottom:1px` 的 6px 内缩胶囊（圆角 99）、Step 的 Token 是满高切片 + 18% 底衬（圆角 2）。同一行里两根条一个"浮"一个"沉"，读起来像两个不同控件。现在**所有列、所有层级都由同一对 helper 绘制**，结构完全一致，只剩色相不同（Time = `--dsw-alias-trajectory-accent` 蓝 `#3b82f6`；Token = `--dsw-alias-chart-tools` 紫 `#a78bfa`）。
  - **`SpentFill`（底衬）**：`0 → 本行之前已消费` 的淡色区，`opacity = SPENT_ALPHA`（0.18）。
  - **`SliceFill`（本行份额）**：满轨道高（8px）、`borderRadius = SLICE_RADIUS`（2px）、solid 色；位置与宽度交给调用方。
  - **Step 的 Time**：位置 = 本步起点在 run 时间轴上的百分比（gantt 语义不变），宽度 = 本步时长占比；底衬 = 本步开始前已流逝的时间。**Step 的 Token**：位置 = 累计(k−1)，宽度 = 本步份额（F142 语义不变）；底衬 = 本步之前已花掉的 token。两列因此是同一张"已用 + 本步"的图，只是量纲与色相不同。
  - **Run 行**：两列都是 `left: 0` 的纯 `SliceFill`（前面没有"已用"，不加底衬），本来就是同一种画法，行为不变。
  - **不再有局部内联条**：原先散在三处的 `h('div', { position: 'absolute', … })` 全部收敛到两个 helper，`TimeBar` 组件删除；`SLICE_RADIUS` / `SPENT_ALPHA` / 过渡曲线只有一处定义，防止再次分叉。
  - **过渡**：`left .25s ease, width .25s ease` 统一（实时刷新与排序时两根条同步生长，不再一条 linear 一条 ease）。
  - **AC**：同一行里 Step 的 Time 与 Token 的**高度、圆角、底衬透明度一致**（8px / 2px / 18%），只有色彩不同；Run 行两列也一致；`client.js` 里不再存在内联的绝对定位条（只剩两个 helper 内部）；`check-served` 50/50（新增 `function SliceFill`、`function SpentFill`、`SLICE_RADIUS = 2`、`SPENT_ALPHA = 0.18` 四个标记）；单测 42/42 不变；对照图 `mockup/bar-align.png`。

## 23. 两列等宽（F146）

- **F146 Time 与 Token 两列一样宽**：F145 统一了两根条的*画法*，宽度还是 170 / 112 —— 一宽一窄让 token 列读起来像时间列的附录，而且 112px 的轨道把 F142 的累计切片挤得很短。现在两列**同宽**：
  - **尺寸**：轨道 **150px**、间隙 6px、数字槽 **70px**，两列各 **226px**（旧：246 / 168）；数字槽同步统一到 70（旧 70 / 50），两个数字因此右对齐在同一条竖线上；
  - **实现**：`TIME_W` / `TOKEN_W` 两组常量合并为 `METRIC_W = 150` + `METRIC_NUM_W = 70`，表头、Run 行、Step 行、`MetricBar` 默认值全部引用同一对常量，"等宽"是结构性的而不是约定；排序热区随之 246/168 → **226/226**；
  - **代价**：两列合计 414 → 452（+38px），run 标题列少了 38px；索引列 78 与两列的对齐关系不变（Step 行索引仍按 `RUN_IDX_W − (STEP_INDENT + 3)` 收窄）；
  - **Token 轨变宽的红利**：F142 的累计切片在 150px 上比 112px 长约 34%，最后一步的右边缘仍然精确落在 100%。
  - **AC**：表头 `Time` / `Token` 两个按钮宽度相等（各 226px），标签左缘仍压在柱子左缘上；两列数字右边缘在同一条竖线上；`35.55s` / `99.99s` / `345k` / `1.2M` 在 70px 槽内不溢出；Run 行与 Step 行的两列左缘严格对齐；深浅色下轨道底色仍为 12% 同色相；`check-served` 52/52（新增 `const METRIC_W = 150`、`const METRIC_NUM_W = 70` 两个标记）；单测 42/42 不变；对照图 `mockup/bar-align.png`（两列等宽版）。

## 24. run 的 prompt 全文显示（F147）

- **F147 run 行不再按字数截断，只在宽度处截断**：run 行的 prompt 一直是 `truncate(prompt, 80)` —— 无论窗口多宽，第 80 个字之后永远看不到（本会话 169 条真实 prompt 里有 25 条超过 80 字，最长 960 字）。
  - **现在**：整段 prompt 原样进 DOM，单元格用 `overflow: hidden` + `text-overflow: ellipsis` + `white-space: nowrap` 在**真实可用宽度**处裁掉并补省略号；窗口拉宽立刻多显示，不需要任何重取。
  - **删掉的字符预算**：`truncate()` 工具函数整个移除（原先只有两处调用：run 行 80 字、step 面板里的指令 400 字）；step 面板（`StepContent` 的「指令」块）同样改为全文，容器本来就是 `maxHeight 96 + overflow: auto`，超出时滚动而不是被砍。
  - **空白**：`white-space: nowrap` 本来就会把换行折叠成空格，所以行内仍是单行；tooltip（`title`）保留原始全文（含换行）。
  - **Payload 不变**：`/runs` 一直送的是完整 `prompt`（`textOf(user/message)` 无上限），所以这次是纯客户端改动，P01 仍是 53.1 KB。
  - **代价与取舍**：两列指标 + 索引占掉约 630px，窗口 900px 时 prompt 列只剩 ~270px；因此**长 prompt 在窄窗口下仍然会被省略号截断**——这是"按宽度截断"的必然结果，拉宽窗口或 hover 可看全。若希望更多可见，可再选：① 允许折行到 2 行；② 点一下 prompt 弹出全文浮层。
  - **AC**：`99.99s` 这类行不再出现"第 80 个字后固定省略"的现象，同一 prompt 在 700 / 820 / 940px 宽的窗口里显示长度递增（mockup/run-prompt.png）；`client.js` 里 `truncate(` 与 `function truncate` 均已不存在；`check-served` 55/55（新增 `r.prompt || '…'` 标记 + 两条 `absent` 断言：`truncate(r.prompt`、`function truncate` 必须不存在）；单测 42/42 不变；payload 53.1 KB / P01 不变。

## 25. hover 反馈加强（F148）

- **F148 hover 要看得出来，但只用底色（不加描边）**：行悬停原来是 `accent 6%` 的淡色（列头 8%），在浅色主题下几乎与背景同色，鼠标移上去没有任何"这一行可点"的反馈。
  - **Run 行 hover**：底色 6% → **9%**，展开态 8% → **12%**（保证 hover 不盖过展开）；箭头 `▸` 变 accent；索引文字 muted → primary；
  - **Step 行 hover**：底色 6% → **10%**（展开态 22% 不变）；箭头变 accent；标题 muted → primary；
  - **列头 hover**：底色 8% → **14%**，底部 1px 线 55% → **80%**；
  - **不加描边**：1px `inset` 环试过一版（22% / 30%），被否掉了——行上多一圈细线在密集列表里显脏；现在 hover **只有底色 + 文字/箭头变化**，靠 120ms 过渡渐亮，鼠标扫过不会出现细线"闪一下"；
  - **实验案例**：`mockup/hover-options.html` 存了 7 个候选（A 底色 9%／B 12%／C 16%／D 12%+箭头文字／E 12%+左侧 3px 轨／F 10%+轻微外阴影／G 12%+两根柱子提亮），截图见 `mockup/hover-options-1.png`、`hover-options-2.png`，供后续挑一档。
  - **AC**：浅色主题下鼠标扫过任意 run 行/step 行，能看出底色变深、箭头变蓝、文字提亮，但**没有任何描边**；深浅次序正确（9% < 12%，10% < 22%）；快速扫过多行不出现布局跳动（只改 `background`/`color`）；`check-served` 57/57（新增 `tone: hover ? T.brand` 标记 + `hoverRing` 的 absent 断言：描边必须不存在）；单测 42/42 不变。

## 26. 深色模式的 hover 与选中（F149）

- **F149 深色主题要单独给一套透明度**：F148 的 hover 用 `color-mix(accent 9%, layer-1)` —— 在白底上是清楚的淡蓝，但混进深色 `layer-1`（`#232324`）后得到 `#252b39`，与背景几乎分不出来；Step 的 10% 混页面底同理（`#19202d`）。
  - **深色一套值**：hover Run **22%**、hover Step **26%**；展开态同步提一档——Run **30%**、Step **36%**，保证 hover 仍比展开浅；列头 hover **26%**、底部线 90%；
  - **浅色完全不变**：仍是 9 / 10 / 12 / 22 / 14 / 80，本次只切换深色；
  - **检测方式**：平台把深色标记为 `body[data-ds-dark-theme]`（见 `DARK_ATTRIBUTE`），面板可能在 shadow root 内，`body[...]` 后代选择器匹配不到，所以用 **JS 读属性**而不是 CSS：`darkThemeActive()` + `applyThemePalette()` 在渲染时把调色板写回共享的 `T`，并用 `MutationObserver` 监听 `body[data-ds-dark-theme]` / `html[data-ds-theme-source]`，用户切换主题时立刻重渲染，不需要刷新；
  - **实现**：`LIGHT_TINT` / `DARK_TINT` 两个常量表（每项一个百分数），`tintOf(pct, base)` 生成 `color-mix(...)` 字符串，避免再手写颜色。
  - **AC**：深色主题下 hover 任意 run/step 行都能一眼看出底色变蓝（旧 9% 换成 22%：`#252b39` → `#283852`）；hover 仍明显浅于展开态（22 < 30，26 < 36）；浅色主题观感与 F148 完全一致（9 / 10）；切换浅色↔深色无需刷新，面板立即换色；`check-served` 60/60（新增 `data-ds-dark-theme`、`function applyThemePalette`、`DARK_TINT` 三个标记）；单测 42/42 不变；对照图 `mockup/hover-dark.png`。

## 27. 顶部透视卡（F150）

- **F150 顶部从「8 张数字卡」换成「一行 KPI + 4 行热力矩阵」**：原来的 8 张卡只有总量，回答不了"哪个 turn 值得看""问题在哪"。现在一张卡同时给三层信息：
  - **一行紧凑 KPI**：`175 run · 3125 step · 15452 事件 · 7.3M Token · 28 错误 · 37 慢操作 · 15 异常 run · 2.0min 最慢操作 pwsh`（数字 15px、标签 11px、异常项语义色、最慢操作带工具名）；
  - **热力矩阵**：4 行 × 每个 run 一列（本会话 175 列，列宽自适应、gap 1px、行高 11px）。Time / Token / 步数 三行按 **会话内排名** 映射到 8%–88% 透明度（Token 中位 13.4k、最大 691k，52× 偏斜，线性映射无效）；异常行 `hasError` → 红、`hasSlow` → 橙、否则发丝灰；
  - **十字线 + 读数**：悬停任意一列，四行同时点亮 1px 蓝色 band；KPI 行右侧同一行显示该 run 的摘要（`run 90 · 1.9min · 691.2k tok · 33 步 · 有错误 — <prompt 前 60 字>`），未悬停时显示操作提示（二者共用一行，卡片不跳高）；
  - **点击定位**：点格子 → 该 run 被**打开**（不切换关闭）+ 滚动到它的行（在面板自己的滚动容器里 `scrollIntoView({ block: 'center' })`，两帧后再滚，等展开提交完成）；
  - **图例**：低—高渐变 + 「蓝 = 耗时 · 紫 = Token · 绿 = 步数」+ 红/橙含义。
  - **口径修正（同属 F150）**：`kpi.slowest` / `kpi.slow` / run 的 `hasSlow` 一律排除**人机等待**（`ask_user_question` / `exit_plan_mode` / `plugin_manager` 且 ≥5s）。本会话里 `ask_user_question 13.1min` 之前被报成"最慢操作"，指向一个不存在的性能问题；修正后最慢操作 = `pwsh 2.0min`，慢操作 53 → 37 条。等待本身仍按 F133 在 step 行显示为 `⏸`，只是不再计入慢操作。
  - **AC**：浅色/深色下 175 列都清晰可分；悬停任一列四行同时点亮且读数与表内数据一致；点击格子会打开并滚动到该 run（已展开的 run 不会被收起）；`最慢操作` 不再出现 `ask_user_question`；`check-served` 63/63（新增 `function OverviewMatrix` / `locateRun` / `mx.hint`）；单测 **43/43**（新增 F150 用例：10min 的 ask_user_question 不算最慢，pwsh 60s 才算）；`verify-perf` 9/9（P06 基线同步改为排除等待）；对照图 `mockup/overview-card.png`。

## 28. 顶部模块重构：吸顶矩阵 + 纯色图例（F151）

- **F151 顶部按"数字 / 图 / 操作"三件事拆开**，同时去掉开发者面板式的头部：
  1. **矩阵卡吸顶**：矩阵卡 `position: sticky; top: 0; z-index: 3`，滚动 run 列表时**始终钉在面板顶部**，行从它下面滑过；KPI 模块正常滚走。卡片背景不透明 + 一层很浅的外阴影，滚到列表深处也随时能对照"哪块厚"。
  2. **十字线精确对齐单元边界**：旧实现用 `left: i/n%` —— 它忽略了每格之间 1px 的 gap，格数一多就整体漂移、线从单元中心切过。现在按真实网格算：`track = (100% − 标签列 − 间隙总数) / n`，`left = 标签列 + i × (track + 1px)`，宽度 = `track`，配合 `box-sizing: border-box`，**左右边界正好压在单元边框上**（无头浏览器逐像素实测：band 边框像素 = 单元首/末像素，见 `mockup/overview-card.png` 第四块"测量用"）。
  3. **点矩阵 → 丝滑下滑**：不再用 `scrollIntoView({behavior:'smooth'})`（长距离会跳、无法取消、在本面板里偶尔不动），改为 **rAF 手写补间**：`easeInOutCubic`，时长按距离取 260–700ms，落点 = 目标行距滚动容器顶部 32% 处（避开吸顶卡），连续点击会取消上一段动画；`prefers-reduced-motion` 时直接跳到位。
  4. **图例只留颜色**：删除"蓝 = 耗时 · 紫 = Token · 绿 = 步数"这类文字说明，改成「3 枚行色块 + 低→高渐变条 + 红/橙异常色块」，含义靠行标签本身的颜色 + tooltip 承载。
  5. **数字摘要独立成模块**：KPI 从矩阵卡里拆出来，成为矩阵上方的独立卡片；矩阵卡只留"图 + 图例 + 读数"。
  6. **去掉头部运维条**：删除「缓存命中 / 服务端 xx ms / 首屏 / 渲染 / 实时 ● 徽标 / 刷新按钮」整条头部；面板直接从内容开始（实时 tick 仍在跑，只是不再显示遥测）。随之删除 `caption()`、`refresh()`、`clearSessionCache()`、`loadInfo`、`realtime` 状态、`perf.lastBuildMs`、`fmtBytes()` 等死代码。
  7. **Run / Step 首字母大写**：行索引 `Run 42` / `Step 7`、KPI 标签 `Run（指令）` `Step（迭代）` `异常 Run`、提示语 `悬停看这个 Run`、tooltip `% of Run`、`载入 Step 内容…`、`该 Step 无内容`，中英文两套都改。
  - **AC**：滚到列表第 90 行时矩阵卡仍贴在面板顶部（`mockup/overview-sticky.html` 实测截图）；悬停十字线的左右边界与单元左右边界重合（像素级测量：band 1072–1079 = 单元 1072–1079）；点任意格子后行在 ~500ms 内平滑滑到视口 1/3 处（连点不叠加）；图例里没有任何"颜色 = 含义"的句子；顶部不再出现缓存/服务端/实时/刷新；`check-served` 68/68（新增 `function KpiSummary` / `position: 'sticky'` / `glideRaf` / `mx.ramp` / `Run ${r.idx}`，并把 `缓存命中`、`cacheHit`、`firstPaint`、`realtime.live`、`perf.lastBuildMs` 改为 absent 断言）；单测 43/43。

## 29. 吸顶改成 transform 钉住 + 十字线拆线（F152）

- **F152 四点修正**（都是上一版落地后暴露的问题）：
  1. **吸顶在真实面板里失效 → 换成 transform 钉住**。原因：面板的滚动所有者不是我们的盒子（真实 GUI 里滚的是对话页），而且任意一个 `overflow: hidden` 祖先都会变成"不滚动的 sticky 容器"，于是 `position: sticky` 静默失效、卡片跟着页面滚走。现在改为 JS 钉住：卡片放在同尺寸的占位 `div` 里，滚动时按占位盒的视口坐标算 `translateY(max(0, min(pinTop − wrapTop, maxT)))` 并写到卡片的 `transform` 上——**布局空间无关**（不依赖谁在滚）、不改列表布局、也不会踩 `position: fixed` 的 containing-block 坑；`maxT` 保证卡到列表底部就停住。事件：`document` 上捕获阶段监听 `scroll` + `resize` + `ResizeObserver`，rAF 合并。无头浏览器对照实测（同一份病态 DOM：`panel{overflow:hidden}` + 页面滚动 520px）：不钉时卡片 `top=-395`（滚走），钉住后 `top=0`、`transform: translateY(395.4px)`。
  2. **"梯形底纹"**：十字线原先是一个带 1px 左右边框的盒子；列宽只有 2–4px 时，`border-box` 装不下两侧边框，盒子塌成楔形/梯形。现在拆成**三个独立矩形**（淡底 + 左 1px 线 + 右 1px 线），无边框、无圆角，任何列宽都不会塌；并且它们画在单元**之后**（覆盖在数据上），十字线是一整条连续的高亮列，而不是从单元缝隙里透出来的"梯子"。
  3. **同一行的文字颜色统一**：矩阵 4 行标签全部改成 `label-secondary` 中性灰（原先 Time/Token/步数 各用自己的颜色，读起来像 4 种风格）。
  4. **图例回到「色块 + 文字」**：`■ Time ■ Token ■ 步数 ▭渐变 ■ 有错误 ■ 有慢操作`，色块负责辨识、文字负责命名。
  5. **红/黄降饱和**：异常行的红/橙不再是纯色实心，改为 `color-mix(… 58%, transparent)`，3px 小格不再刺眼；图例色块仍用纯色以便对照。
  - **AC**：滚动对话页时矩阵卡始终贴在可视区顶部（实测 `top=0`），滚到列表末尾时停在底部不越界；悬停十字线是**两条 1px 直线 + 一层 14% 淡底**，任何列宽下都不出现梯形/楔形；4 行标签颜色一致；图例是色块 + 文字；红/橙为半透明；`check-served` 72/72（新增 `band-fill`、`bandLayer('band-l'`、`data-hades-scroll`、`translateY(${t}px)`，并把 `position: 'sticky'` 改为 absent 断言）；单测 43/43。

## 30. 数字摘要与矩阵一起吸顶（F153）

- **F153 顶部整块吸顶**：F152 只钉住了矩阵卡，KPI 数字仍会滚走。现在**数字摘要 + 热力矩阵作为一个整体**放进同一个被钉住的块里（`OverviewBoard`）：滚动时两块一起停在面板顶部，run 列表从它们下面穿过。
  - **结构**：`占位 div`（`background: surface`，用于遮住两块之间 8px 的缝）→ `被钉的块`（`data-hades-board`，`will-change: transform`）→ `KpiSummary` 卡片 + 矩阵卡片；钉住的算法与 F152 相同（`translateY(max(0, min(pinTop − wrapTop, maxT)))`），只是**测量的是整块高度**。
  - **点击定位的落点同步**：可滚动区域的顶部被这块挡住了，所以 `locateRun` 的落点改由 `boardH + 24` 与 `viewH*0.32` 取较大值（上限 `viewH*0.6`），定位到的 Run 不会被吸顶块盖住。
  - **实测**（CDP，同一份病态 DOM：`panel{overflow:hidden}` + 页面滚 520px）：不钉时整块 `top=-445 / bottom=-318`；钉住后 `top=0 / bottom=127`、`translateY(445.4px)`，且 KPI 卡在块内 `top=0`（即数字与矩阵一起挂在顶部）。
  - **AC**：页面滚动时**数字与矩阵都不动**（两者 top 恒为 0，直到列表底）；两块之间的缝隙不透出下面的行；点格子定位后的行完整可见（不被吸顶块压住）；`check-served` 73/73（新增 `function OverviewBoard`、`data-hades-board`）；单测 43/43。

## 31. 吸顶真正生效：跨 shadow root 的滚动监听（F154）

- **F154 根因是事件到不了**：DSH 的宿主是 Lit 组件（`attachShadow({mode:'open'})`），插件视图挂在 **shadow root 内部**；而 **`scroll` 事件不是 composed**，shadow 内部的滚动**不会**派发到 `document`。所以前两版无论用 `position: sticky` 还是 `transform` + `document` 监听，在真实面板里都表现为"完全没钉住"。
  - **实测证据**（`mockup/overview-shadow.html`，CDP 读取）：组件挂在 shadow root、滚动发生在 shadow 内部时，`document` 上的 scroll 计数 = **0**；同一个页面里不钉的块 `top=-183`（滚走）。
  - **修法**：从占位块出发**沿祖先链逐级挂监听**，遇到 shadow 边界就 `getRootNode()` 拿到 shadow root 挂上、再跳到 `root.host` 继续往上，最后补 `window`；共 9 个目标。另外加两层保险：① 120ms 看门狗（每帧 8 次 `getBoundingClientRect`，代价可忽略）兜住任何漏掉的滚动；② `wheel` / `touchmove` / `keydown`（**这些事件是 composed 的**）作为提示，触发后 400ms 内每帧重算，滚轮滚动时依然跟手。
  - **钉到哪**：`pinTop = max(0, hostRect.top)` —— 优先贴**面板顶部**；面板顶部滚出视口时才退化为贴视口顶部。
  - **AC**：shadow root 内的滚动也能钉住（实测：不钉 `top=-183`，钉住 `top=67` = 面板顶部、`translateY(250px)`）；`document` 收到 0 个 scroll 事件的情况下依然工作；滚轮连续滚动时无可见滞后；把面板滚到底时块停在列表底部不越界；`check-served` 76/76（新增 `getRootNode` / `boostUntil` / `setInterval(update`）；单测 43/43。

## 32. 顶部改结构性固定 + 矩阵可选可定位（F155）

- **F155 不再"钉"，改成没有东西可滚**：F151–F154 都在想办法把表头钉在滚动之上（`sticky` → `transform` → 跨 shadow 的监听），但真机上始终失效。这次换架构：**面板是一个有确定高度的 app shell**，表头块是滚动区**外面的 flex 兄弟**——它结构上就不可能滚。
  - **高度**：`shellH = clamp(320, min(视口高度 − 面板顶部, 父容器可见底 − 面板顶部))`；挂载 + `resize` + 250ms 后再量一次。有了确定高度，列表才真的自己滚，页面不再被撑长。
  - **结构**：`root(shellH, flex column)` → `hdr(flex 0, padding 10/12/0)`［KPI 卡 + 矩阵卡］→ `list(flex 1, minHeight 0, overflow auto)`［只有 Run 列表］。
  - **删掉的机制**：`position: sticky`、`transform` 钉住、跨 shadow 的祖先链监听、120ms 看门狗、`pageScroll` 探测——全部删除（`-3.6 KB`）。这几层都是对"谁在滚"的猜测，现在不需要猜。
  - **矩阵可选 + 滚动定位**：点击任一单元格 → 该列**选中并保持高亮**（hover 结束后仍然保留），同时 `locateRun` 用 rAF + `easeInOutCubic` 把列表滚到该 Run（落点 `max(viewH×0.32, 矩阵高 + 16)`，上限 `viewH×0.6`，保证不被表头挡住）。
  - **实测**（harness：shadow root + 无界父容器，CDP 读取）：shell 高 **567px**、列表可滚 **746px**；列表滚 400px 后表头 **top 103 → 103**（不动）；点击第 30 列后列表滚到 **734**、表头仍 **103**、选中带 `display:block`（保持高亮）。
  - **AC**：滚列表任意距离，KPI + 矩阵在面板顶部**一动不动**（因为它们在滚动容器之外）；点矩阵任一列 → 该列持续高亮、列表平滑滚到对应 Run 且行不被表头遮挡；页面不再因为面板被撑长而整体滚动；`check-served` 76/76（新增 `shellH` / `const renderHeader` / `const renderList` / `setSelected(i)`，移除 `translateY(${t}px)` 等钉住标记）；单测 43/43。

## 33. 点击矩阵不再卡顿（F156）

- **F156 一次点击只搬高亮，不重建网格**：点一下矩阵会卡顿时，主因是三个热点叠在一起：
  1. **700 个单元格被重建**：`selected`/`hover` 变化会让整个矩阵重渲染（3×175 格 + 异常行 175 格），而真正变的只有一个高亮条；
  2. **展开动画与滚动补间抢主线程**：点击会同时 ① 展开该 Run（160ms 的高度 WAAPI 动画，每帧都要重排）② 起一段 260–700ms 的 `scrollTop` 补间。两个动画在同一时间改列表高度，滚动目标在补间过程中还在变；
  3. **点击处理器同步做完整重活**：`setSelected` + 展开 + 起补间全在同一个事件任务里，浏览器要到这些都干完才绘一帧。
- **改法**：
  - **网格 memo 化**：单元格数组用 `useMemo` 缓存，依赖只有 `[rows, ranks, n, rowTexts]`；`hover`/`selected` 变化时只重渲染高亮三件套与读数。回调通过 `locateRef` 调用，避免父组件每 2s 的实时刷新把 memo 打穿；
  - **展开与滚动串行**：点击后若该 Run 原本是收起的，先把**高亮立刻画出来**，`setTimeout(…, 0)` 让定位工作落到下一个任务；`locateRun` 内部再等 **200ms**（高度动画结束）后才起滚动补间；
  - 已展开的 Run 仍立即（两帧后）定位，不做额外等待。
  - **AC**：点任意单元格时先看到该列亮起，随后列表平滑滑到目标（不与展开动画抢帧）；同一列连点不会叠加动画；`check-served` 76/76（`setSelected(i)` / `const grid = useMemo` / `locateRef` 均在线上 bundle 内）；单测 43/43。

## 34. 滚动链断开 + 矩阵选中态（F157）

- **F157 两个体验问题**：
  1. **滚到底再往回滑，表头"不见了"**：不是固定失效，而是**滚动链**——列表滚到 `scrollTop = max` 后再滚一格，滚轮事件会**链式传给页面**，于是整个面板（连同表头）被页面带走；往回滑时页面先归位，看起来就像"置顶消失了"。修法：列表容器加 `overscroll-behavior: contain`，把滚动关在自己的盒子里，页面不再被带动。
  2. **矩阵的 hover 太轻、选中感不足**：F155 里 hover 与 selected 用的是同一条 14%/1px 的淡带，既不显眼也分不出"悬停"和"已选"。现在分成两级：
     - **选中（点击）**：30% 蓝色底 + **左右各 2px** 实线边，指针移开仍保留；
     - **悬停**：20% 底 + 1px 边，跟随指针；
     - 两者可以同时存在（悬停另一列时，选中的列仍带 2px 标记）；
     - **选中胶囊**：图例行右侧出现 `Run 90 ✕` 的蓝色小胶囊（点 ✕ 取消选中），把"当前选中哪个 Run"用文字也说清楚。
  - **AC**：列表滚到底后继续滚轮/触控板，**页面不再移动**、表头始终可见；往回滚立刻作用在列表上；悬停任一列能明显看出高亮（20% + 1px），点击后该列变成 30% + 2px 并保持，同时出现 `Run N ✕` 胶囊；点 ✕ 取消后胶囊消失、高亮清除；`check-served` 79/79（新增 `sel-fill` / `bandLayer('sel-l'` / `hov-fill` / `bandLayer('hov-l'` / `overscrollBehavior`）；单测 43/43。

## 35. 整体卡顿：去掉 4 个隐藏的热点（F158）

- **F158 卡顿不是某一处，是四处叠在一起**，逐条消掉：
  1. **每一行都挂着 `will-change: transform`**（175 行 = 175 个常驻合成层）。FLIP 只在排序真正变化时才需要它，常驻只会吃 GPU 内存并拖慢滚动。现在只在 FLIP 动画期间设置、`transitionend` 后清掉。
  2. **行 hover 是 React 状态**：鼠标扫过列表时，每跨越一行就 `setState` → **整张 175 行的表重渲染一次**，指针移动速度就是渲染频率。改为纯 CSS `:hover`（颜色走根节点上的 `--hades-hover-row / --hades-sel-row / --hades-muted / --hades-text / --hades-brand` 变量，随主题更新），React 里不再有 `hoverRun` 状态。
  3. **`renderDetail(r)` 对 175 行无条件调用**：即使某行是收起的，也在每次渲染时重新构建它的 step 列表——展开的 80 步 run 等于每次渲染多建 80 个 step 行。现在只在 `open` 时构建（折叠动画仍由 `Collapse` 保留最后一帧内容）。
  4. **每 2 s 的实时 tick 无条件重渲染**：日志 seq 变动但屏幕数字没变时，也会重建 175 行 + 700 格矩阵。现在先用**可见变化签名**（counts + token 总数 + 尾行 `idx/token/time/stepCount`）比对，签名相同就只更新 seq 与缓存、不写 state；并且**用户正在滚动时（<220ms 内有 scroll）把更新延迟 240ms**，避免更新抢滚动帧。
  - **AC**：鼠标快速扫过 175 行不再触发列表重渲染（React DevTools 无 commit）；空闲时 tick 零 commit；滚轮滚动期间不会插入数据更新；展开的 run 折叠后不再构建其 step 列表；`check-served` 79/79（`.hades-run-row` / `--hades-hover-row` / `el.style.willChange` / `appliedSig` 均在 bundle 内）；单测 43/43。

## 36. Step 明细卡重做：统计条 + 时间轴卡片（F159）

- **F159 从"平铺列表"改成"统计条 + 时间轴"**（选项 B+E）：旧面板一条灰色 meta 行 + 平铺行，**所有行同样重**——两条 `system-reminder` 注入和模型的正式回答占一样的视觉重量，工具参数/结果永远展开。现在：
  1. **统计条**（E）：一行 `模型 1 · 工具 2 · 上下文 2 —— 计时 38.26s · in 3.1k / out 4.4k · cache 222.1k`，模型名挂在"模型"后；
  2. **时间轴**（B）：左侧竖轴 + 每个操作按类型着色的圆点（指令蓝 / 回复紫 / 工具橙 / 注入绿 / 失败红），每条操作是一张小卡：
     - **指令卡**：`USER` + 字数，正文全文可滚动（F147 不变）；
     - **回复卡**：`REPLY` 模型调用 + `in/out`，正文多行；
     - **工具卡**：`TOOL` + 工具名 + 耗时，`args` / `result` 各一行等宽省略（hover 看全）；
     - **注入卡**：`CTX 注入 ×N` 虚线卡，**默认折叠**成一行，点一下展开全部注入文本（`ctxOpen`）；
     - **说明行**（压缩/重试/失败等）保持点线小卡，不再与正式操作同权重；
  3. **`原文` 移到卡片右上角**，点开在原卡片内展开完整 JSON（`rawPanel`），不再是一行末尾的小字。
  - **AC**：展开一个有多条注入的 step，默认只看到 `CTX 注入 ×N` 一行（点开才展开正文）；回复与工具卡在竖轴上顺序排列、圆点颜色区分类型；工具卡 args/result 超宽显示省略号且 hover 有全文；`原文` 在卡片内展开 JSON；`check-served` 87/87（新增 `ctxOpen` / `setCtxOpen` / `rawPanel` / `注入 ×`）；单测 43/43；设计稿 `mockup/step-cards-final.png`。

## 37. 删掉图例里没解释的渐变条（F160）

- **F160 问题**：图例里有一根 84×6 的低→高渐变条，它想表达"格子颜色越深 = 该 Run 的排位越高"，但**没有刻度、没有文字、没有说明**，在 `■ Time ■ Token ■ 步数` 后面读起来像一条跑偏的进度条。
- **改法**：删掉渐变条；把"颜色越深 = 排位越高"下沉到**三个行色块的 tooltip** 里，并且按行说清楚（耗时 / token / 步数各自比较）。图例现在是五个纯色块 + 文字：`■ Time ■ Token ■ 步数 ■ 有错误 ■ 有慢操作`。
- **AC**：图例里只剩五个色块 + 文字，没有渐变条；hover `Time / Token / 步数` 任一枚，tooltip 说明"颜色越深 = 该 Run 的该项在会话里的排位越高"；`check-served` 90/90（新增 `mx.rampTime/Token/Steps`，并把 `'mx.ramp':` 加进 absent 断言）；单测 43/43。

## 38. 点矩阵后选中的 Run 行滚到列表顶部（F161）

- **F161 落点改成"顶部"**：F155 之后表头已经在滚动区外面，不再有任何东西会盖住目标行，但 `locateRun` 的落点还留着旧算法（`max(视口×0.32, 矩阵高+16)` 且上限 `视口×0.6`），于是选中的 Run 落在列表中部。现在落点固定为**列表顶部**（`target = scrollTop + 目标行相对偏移 - 2`）。
- **尾部留白**：列表到底就结束，最后几屏的 Run 在数学上不可能被滚到顶部（只能贴底）。所以在列表末尾追加一段 `tailPad = 列表视口高 − 40px` 的留白（`data-hades-tail`），让**每一行**都能滚到顶部。
- **AC**：点矩阵任一列 → 该列高亮，列表平滑滚到该 Run，**行的顶边贴近列表顶部**（实测 `rowTopInList = 2px`，抽测 8/20/30/34 四列全部为 2px，含原先贴底的 30/34）；表头保持不动（`boardTop` 恒为 103）；`check-served` 92/92（新增 `data-hades-tail` / `tailPad`）；单测 43/43。

## 39. 点击矩阵不再整表重建、不再等 200ms（F162）

- **F162 点击还剩两处真实开销**：
  1. **整表重建**：点一下矩阵会改 `expanded`（以及随后 `details` 落地），而 `DualBarChart` 每次都把 175 行**重新构建**一遍（≈2100 个元素 + React 逐节点 diff），一次点击要发生**两次**（改 expanded 时、detail 落地时）。
  2. **固定 200ms 等待**：F156 为了让开启动画先跑完，把滚动定位推迟了 200ms —— 点击后列表"不动"的那 200ms 本身就是卡顿感的主要来源。
- **改法**：
  - **行元素缓存**：`buildRows()` 按 `(rows, sort, 语言签名, 是否首帧)` 校验整表缓存，打开状态单独校验；命中的行直接复用上一轮的**同一批元素对象**，React 看到元素引用不变就整棵子树跳过。点击时只有被点的那一行重建（关闭的行不关心 detail 变化，用一个 `detailEpoch` 只让打开的行校验）。
  - **缓存不会吃掉状态**：`openRun`/`locateRun` 改读 `expandedRef.current`（活 Set），避免缓存行携带旧的 `expanded` 快照导致"该开却关"。
  - **定位不再等固定 200ms**：详情已缓存（同批次就会生效）→ 下一帧立刻滚；详情未缓存 → **detail 一到就滚**（`pendingLocate` 效应），400ms 定时器只作兜底。
  - **定位的那一行不做高度动画**（`instantOpen`），展开高度瞬时就位，不与补间打架。
- **AC**：点矩阵任一列 → 高亮立刻出现、列表**立刻**开始滚动（首次点未加载过的 Run 时最多等一次 `/run` 请求）；React DevTools 高亮更新时只有被点的那一行闪烁，其余 174 行不动；`check-served` 92/92（`buildRows` / `detailEpoch` / `pendingLocate` / `instantOpen` 均在 bundle 内）；单测 43/43。

## 40. 展开动画不丝滑的根因：一次展开跑了 3 个高度动画（F163）

- **F163 现象**：点开一个 Run/Step，面板"展开 → 跳一下 → 再展开"，很卡。
- **根因**（`Collapse` 组件的三处叠加）：
  1. `useEffect(() => setVisible(true), [open])` 让 `visible` 在**布局副作用之后**才变，而布局副作用依赖里带着 `visible` → **一次 open 触发两次布局副作用**：第一次开启动画起在占位内容高度上，第二次 cleanup 取消它、又从 0 重新起一遍 —— 这就是"跳一下再展开"。
  2. 详情是异步的：打开时先挂一行"载入 step…"占位，detail 落地后再由"follow"动画从占位高度长到真实高度 —— 第二次生长。
  3. 第二次动画**不是替换**第一次，WAAPI 对同一属性是**叠加**的，两个 `height` 动画同时跑，视觉上就是抖动。
- **改法**：
  - `visible` 改成**渲染期同步**翻转（`if (open && !visible) setVisible(true)`），布局副作用只依赖 `[open, expandMs, collapseMs]`，一次展开只跑**一个**高度动画；
  - 维护 `animRef` 记录在飞的动画，新动画前先 `cancel`，"follow" 动画在开启动画进行中直接跳过；
  - **先取数据再展开**：`openRun` 对未缓存的 Run 改为 fetch 成功后才 `setExpanded`（详情与展开同一批提交），面板一出现就是最终高度，不再有"占位→真内容"的第二次生长；已缓存/已在展开的直接立刻打开。
- **实测**（harness 复刻两条路径，统计 `Element.prototype.animate`）：**旧路径一次展开 = 3 个高度动画，新路径 = 1 个**。
- **AC**：点开一个 Run，面板从 0 一次性长到最终高度，无回跳、无二次生长；关闭同理只有一个动画；`check-served` 99/99（新增 `const cancelAnim = () => {` / `if (open && !visible) setVisible(true);` / `const detailsRef = useRef(details)`）；单测 43/43。

## 41. 图例移到右上角 + 矩阵 Run 数量滑块（F164）

- **F164 两处调整**（热力矩阵卡）：
  1. **图例搬到卡片右上角**：原来图例和悬停读数挤在矩阵**下方**同一行，既把矩阵往下顶、又让右上角空着。现在卡片顶部一行：**左边 = 悬停读数**（`Run 90 · 115.5s · 691.2k tok · 33 步 — 提示词前 40 字`），**右边 = 选中胶囊 + 五色图例**；矩阵紧接其下，滑块在矩阵下方。
  2. **Run 数量滑块**：1 列 1 个 Run 在 175 列时只有 ~4px 宽，看不出差异。新增一条 range 滑块（`data-hades-window`），范围 `12 … 全部`，标题为 `最近 N / 175 个 Run`，右侧 `全部` 一键复位；矩阵只渲染**最新的 N 个 Run**，着色 rank 按窗口内重算（这样窗口内的色阶仍然铺满 8–88%）。
- **连带改造**：悬停/选中状态从"列位置"改为**存 Run idx**，拖动滑块改变窗口时选中列不会跳位；读数、选中胶囊、高亮带都按 idx 反查当前位置。
- **AC**：图例出现在矩阵卡**右上角**、读数在同行左侧；拖动滑块，矩阵列数实时增减且标注 `最近 N / 175`；点 `全部` 回到全量；窗口内被选中的 Run 仍带 22%+2px 高亮，胶囊显示其 Run 号；拖滑块后点击任一列仍能定位到正确的 Run；`check-served` 103/103（新增 `type: 'range'` / `data-hades-window` / `mx.showRecent` / `windowN`）；单测 43/43；设计稿 `mockup/overview-window.png`。

## 42. 全英文 UI + 工业化滑块 + 细节收敛（F165）

- **F165 三件事**：
  1. **界面全英文**：`view.title`、KPI 标签、矩阵/图例、排序、Step 明细（sum strip、卡片、tooltip、占位文案）、空态/加载态、note 标签全部改英文；`zh` 与 `en` 两个 locale 槽指向**同一张英文表** —— 这样中文系统语言下也不会出现半中半英。唯一保留中文的是 `TAG_MAP` 的**键**（它们匹配 trace 里的事件原文，如「读取」「压缩」），值是英文 chip。
  2. **滑块做成产品件**：不再用原生 `input[type=range]` 的样子。自定义轨道（`--fill` 变量画已填充段）、12px 圆点拇指（白底 + 1px 品牌色描边 + 阴影）、hover 放大 1.15×、键盘 focus 有 3px 柔光环；左侧 `all 175 runs` / `latest 46 / 175 runs`，右侧 `12–175` 范围与 `all` 胶囊复位；滑块行与网格之间用 1px 分隔线隔开（"图" 与 "控" 分区）。
  3. **细节收敛**：图例 swatch 9→8px、图例项 10→12px 间距、指标组与异常组之间加 1px 竖分隔；行标签与图例统一 Title Case（Time / Token / Steps / Flags / Error / Slow，KPI 为 Runs / Steps / Events / Tokens / Errors / Slow ops / Abnormal runs / Slowest）；读数里 Run 号用品牌色加粗、数字 `tabular-nums`；网格行距 3→4px、异常行单独加 4px 间距；单元格圆角随列数自适应（>48 列用 1px，≤48 用 2px）；卡片内边距 8/12/7 → 10/12/10。
- **AC**：界面无中文（trace 数据里的提示词/事件原文除外）；滑块有填充轨道、圆点拇指、hover/focus 反馈和 `all` 复位；图例在右上角且指标与异常分组；`check-served` 103/103（新增 `MATRIX_CSS` / `hades-range` / `const EN = {` / `zh: EN, en: EN`）；单测 43/43；设计稿 `mockup/matrix-f165.png`。

## 43. 在矩阵上滚动 = 逐 Run 拨动列表（F166）

- **F166 交互**：指针在热力矩阵上滚轮，不再滚动页面/列表，而是**按 Run 逐格拨动**：
  1. **一格一个 Run**：滚轮增量累加到 26px 触发一步（触控板不会一次飞过十几行），方向决定上/下一个；到首尾自动停住；步进时同步更新矩阵高亮带与选中胶囊；
  2. **其余行变半透明**：拨动期间根节点加 `.hades-scrubbing`，Run 分组整体 `opacity: .22`，**只有焦点 Run 保持全不透明**，并带品牌色左侧轨 + 16% 底色 + Run 号为品牌色 —— 一眼看到"现在拨到哪一行"；
  3. **"哒哒哒"的定档感**：列表用 **130ms + easeOutCubic** 短补间把焦点行顶到列表顶部（不是 260–700ms 的长滑行），每滚一格就是一次干脆的"咔哒"落位；停止拨动 700ms 后自动恢复全亮；
  4. 滚轮**不会展开**该 Run（展开仍是点击），拨动只做"选中 + 定位"。
- **实现要点**：`wheel` 用原生监听 + `passive: false` 才能 `preventDefault`；处理器只挂一次，靠 `selectedRef/hoverRef/shownRef` 读最新状态；行元素缓存（F162）把焦点也纳入条目有效性，所以一格只重建**新旧两行**。
- **AC**：在矩阵上滚轮 → 列表逐行上/下拨动、页面与列表都不自由滚动；除焦点外全部变淡，焦点行有强调轨与底色；停止 700ms 后恢复；到首/尾停住不越界；点击仍照常展开；`check-served` 108/108（新增 `hades-scrubbing` / `wheelAcc` / `beginScrub` / `is-focus` / `const scrubTo = (idx) => {`）；单测 43/43；设计稿 `mockup/scrub-f166.png`。

## 44. 拨动修复 + 焦点行不再贴顶（F167）

- **F167 上一版"没生效"的两个真实原因**：
  1. **监听器没挂上**：用 `useEffect(..., [])` 去读 `ret`，但矩阵卡第一次渲染可能还没提交（列表空/数据未到时会提前 `return null`），effect 只在挂载后的那一次跑，ref 为 `null` 就直接放弃了 —— 之后再也不会重试。改成**回调 ref**（`useCallback` 稳定身份）在元素真正挂载时 `addEventListener`、卸载时 `removeEventListener`，与渲染时序无关。
  2. **hook 顺序被打断**：那段 effect 落 `if (n === 0) return null;` **之后**，一旦表格短暂为空，hook 数量就会变化（React 会报错/行为异常）。现在所有 hook 都在提前 return 之前。
  - 顺带把监听范围从"网格盒子"扩大到**整张矩阵卡**（图例/读数也能触发），命中更容易。
- **焦点行不再贴顶**：拨动定位的锚点从"列表顶部 -2px"改成 **视口高度的 34%** —— 贴顶时那一行紧贴矩阵卡下边缘，眼睛要来回扫；留出上方约 1/3 的上下文读起来才舒服。落位仍是 **130ms + easeOutCubic** 的定档补间（F166）。
- **实测**（harness 复刻 + CDP 真实滚轮事件 `Input.dispatchMouseEvent`）：滚一格 → 选中 Run 前进 1（101→102→103），**40 行里 39 行被压到 22%**，页面 `scrollY` 恒为 0（滚轮被接管）；连续拨到第 12 行后 `rowTopInViewportPct = 34`。
- **AC**：在矩阵卡上滚轮 → 逐 Run 拨动、其余行变淡、焦点行停在上方约 1/3 处；页面不滚动；`check-served` 110/110（新增 `const matrixEl = useCallback` / `host.clientHeight * 0.34`）；单测 43/43。

## 45. 工业级收敛：设计 token / 标记带 / 稳定色阶 / 键盘（F168）

- **F168 一次性收敛面板的交互与视觉**，按设计计划落地：
  1. **设计 token 底座**：新增 `DESIGN`（space 4/8/12/16 · motion 120/160/240/260 · ease out/in · alpha 浅深两套 · row 28/4）与 `CSS_VARS`，注入样式表里不再有魔法数字；`EXPAND_MS/COLLAPSE_MS/FOLLOW_MS`、scrub 时长、glide 上限全部改读 token；focus 底色也由 `applyThemePalette` 从 token 生成（`T.focusRow`）。
  2. **Flags 退出指标网格**：error/slow 变成 Time 行**上方的一条 3px 标记带**（`hades-lane`），矩阵从"4 个等权行"变成"3 个指标 + 标记"；高亮带上探到 `-8px`，选中列连标记一起被框住。
  3. **色阶稳定**：rank 改为对**全会话** rows 计算并存成 `Map(idx → rank)`，滑块只裁剪 `shown`；拖动窗口不再重算 175×3 排名、也不再给同一个 Run 换颜色。
  4. **结构化读数**：头部读数只保留 `Run N · 1.9min · 691.2k tok · 33 steps` + error/slow 标记，**提示词摘要移出头部**（它属于数据，不属于 chrome）；拨动/方向键时临时显示 `Run N / M` 刻度（`data-hades-tick`，700ms 后消失）。
  5. **键盘可达**：矩阵卡 `tabIndex=0` + `role=group`，`←/→` 逐 Run 步进（与滚轮同一路径），`Enter` 定位；`focus-visible` 有 2px 品牌色外环。
  6. **列表质感**：指标列由固定 150px 改为**分数列**（`flex: 1 1 0`，`min-width: 96px`，**已被 F169 撤销**，见 §46）、数字固定 70px `tabular-nums` 槽；行高 28px + 4px 内距落在 4px 栅格；提示词列用 `mask-image` **线性渐隐**而不是硬省略号。
  7. **首屏与空态**：`loading && !payload` 渲染 10 行 **shimmer 骨架**（`hades-skeleton`），空态/错误态改为居中卡片（图标 + 文案 + 错误态带 Retry）。
  8. **KPI 分簇**：三簇 + 1px 分隔（Runs·Steps·Events ｜ Tokens ｜ Errors·Slow ops·Abnormal·Slowest），padding 收到 `8/12` 并落在 4px 栅格。
  9. **动效统一 + reduced-motion 全链路**：`prefers-reduced-motion: reduce` 时 scrub 补间、locate glide、FLIP 全部瞬时到位（原先只有 Collapse 处理）；glide 由 `min(260, max(160, |Δ|×0.35))` 收口，长距离不再拖到 700ms。
  10. **滑块去冗余**：`12–N` 只在窗口态出现；芯片统一（`RowTag` 18px 高、4px 圆角，与图例 8px swatch 同一套）；`原文` 面板加 **Copy** 按钮与 11.5px/1.45 排版。
- **AC**：矩阵 3 指标 + 顶部标记带；拖滑块颜色不变；四种状态（hover/focus/selected/open）不叠层；`←/→` 可移动、`Enter` 定位；首屏骨架、空/错卡片；`check-served` **120/120**（新增 `const DESIGN = {` / `const CSS_VARS = {` / `hades-lane` / `hades-prompt` / `hadesSkeleton` / `onMatrixKeyDown` / `ArrowLeft` / `Copy` / `data-hades-tick` / `const markerBg = (run) =>`，并把 `const EXPAND_MS/FOLLOW_MS` 断言改为 token 形式）；单测 43/43；设计稿 `mockup/optimized-preview.html`。

## 46. Time / Token 轨道回到固定 150px（F169）

- **F169 撤销 F168 里的"分数列"**：把两条指标轨道拉到面板宽度后，一条 bar 有 600px 长，而它的信息只在**同列内部**做比较 —— 长出来的长度不携带任何信息，只增加扫读成本。
- **改法**：`MetricBar` 回到 `flex: 0 0 (150 + 6 + 70)px`，轨道固定 150px、数字独占 70px `tabular-nums` 槽；表头的两个可排序槽位回到同样的固定宽度，`sortCol` 重新接收 `barW`，保证表头与行严格对齐；提示词列继续吃剩余宽度并保留 F168 的渐隐。
- **保留的 F168 遗产**：4px 行栅格、`tabular-nums`、提示词渐隐、标记带、稳定色阶、键盘、骨架、token 表都不动。
- **AC**：两条 bar 与改动前一样长（150px 轨道），表头 `Time`/`Token` 与轨道左边缘对齐；提示词列仍占剩余空间并在末端渐隐；`check-served` 120/120；单测 43/43；渲染 harness 通过（1 条标记带 / 每行渐隐类）。

## 47. 打开即落在实况边缘 + 实时跟随（F170）

- **F170 打开面板的行为**：不再从第 0 个 Run 开始，而是**直接落在最新的 Run**（列表底部），并且默认处在"跟随"状态 —— 会话在流式进行时，2s tick 每推来新数据，视口自动贴着最新的 Run，矩阵光标（高亮带 + 读数）也一起骑到最后一列。
- **跟随状态机**：
  1. **判定**：`distanceToEdge = 最后一行底 − (scrollTop + clientHeight)`，≤ 8px 视为"在边缘"→ 跟随；否则退出跟随（不劫持用户的阅读位置）。
  2. **程序化滚动豁免**：跟随自身的滚动会写 `programmatic` 标记，滚动监听据此忽略这些事件，避免"自己把自己判成用户滚动"。
  3. **主动交互即交出控制权**：点行、点矩阵、滚轮拨动（`openRun` / `locateRun` / `beginScrub`）都调用 `stopFollowing()`；此后新数据只更新内容，**不动滚动位置**。
  4. **回到实况**：用户滚回底部（判定自动恢复）或点右下角 **`↓ Latest`** 胶囊（`data-hades-latest`）→ 平滑滚到最新并恢复跟随。
  5. **矩阵同步**：`OverviewBoard` 收到 `followLatest` 时用 effect 把 `selected` 设成最后一列，随新 Run 前进；用户一旦点击/拨动，父级关闭跟随，effect 随之失效。
- **落点算法**：`target = lastRowBottom − clientHeight + 16`（内容坐标用 `getBoundingClientRect` 差值 + `scrollTop` 换算，**不用 `offsetTop`** —— 面板根是 `position: relative`，`offsetTop` 会带上表头高度）；因为有 F161 的尾部留白，target 通常小于 `maxScroll`，视口不会停在空白区。
- **实测**（harness 复刻 + CDP）：初始 20 行 → `scrollTop = maxScroll`、`distanceToEdge = -12`、pill 隐藏；推 3 条 → 仍贴边缘、跟随保持；用户上滚 260px → `follow=false`、pill 出现、位置保留；此时再推 3 条 → **位置不动**（仍 356）、pill 仍在；点 pill → `scrollTop = maxScroll`、pill 隐藏、跟随恢复。
- **AC**：打开面板即看到最新的 Run 与最新列高亮；流式期间视口自动贴底；上滚后不再被拉回，且出现 `↓ Latest`；`check-served` **126/126**（新增 `scrollToLatest` / `lastRowBottom` / `stopFollowing` / `followRef` / `data-hades-latest` / `mx.jumpLatest`）；单测 43/43；harness `mockup/follow-harness.html` + `cdp-follow-check.mjs`。

## 48. 矩阵 hover 在快速移动时丢失的修复（F171）

- **F171 症状**：鼠标在热力矩阵上快速横扫时，高亮带/读数会**消失**（或停在别的列）。
- **两个叠加成因**：
  1. **每格一个 `onMouseEnter`**：175 列 × 4 行 ≈ 2400 个 4px 宽的小格子，快速移动时浏览器的 `mouseover/mouseout` 序列与 React 的 enter/leave 模拟在同帧内大量交错，最终状态可能落到"已离开"。
  2. **每格一个 `title`**：700 个原生 tooltip 在横扫时不断弹出/收起，**原生 tooltip 窗口会抢走 hover**（经典原因），表现就是高亮突然消失。
- **改法**：
  1. 单元格只保留 `data-idx`，**hover 由网格容器统一解析**：`onMouseMove` → `event.target.closest('[data-idx]')` → 取列号；同一列不重复 `setState`。指针落在 1px 缝隙或行标签上时**保持上一列**（不闪）；只有**离开网格容器**才 `setHover(null)`。
  2. **删掉全部格子级 `title`**；Run 号 / error / slow 信息由左侧读数与行 tooltip 承担。
- **实测**（harness + CDP 真实鼠标）：6 次大跨度横扫（175 列）后，`hover` = 指针所在列 **149**，与 `root.elementFromPoint` 命中列**完全一致**（旧 harness 因 shadow hit-test 用了 `document.elementFromPoint` 才返回 null，已修正）；每次横扫只需 6 个 `mousemove`，而每格 enter/leave 方案同样要 6 个 over + 6 个 out 且依赖模拟。
- **AC**：快速横扫矩阵不再丢高亮；停在某一列时读数稳定显示该 Run；移出网格容器后高亮消失；`check-served` **128/128**（新增 `'data-idx': r.idx` / `onMouseMove: (event) =>`）；单测 43/43；harness `mockup/hover-harness.html` + `cdp-hover-check.mjs`。

## 49. 滚轮拨动三处真实缺陷 + 回归套件（F172）

- **F172 滚轮"有问题"的三个具体原因**：
  1. **`deltaMode` 没归一**：部分 Windows 驱动用行模式（`deltaY = 3/格`），26px 阈值要 **9 格**才走一步 → 滚轮像没反应。现在 `deltaMode 1 ×16 / 2 ×400` 归一，任何模式都是**一格一 Run**。
  2. **补间从半途重启**：连续快速拨动时每次都在 `scrollTop` 当前（落后）位置重启 ease，列表追不上选中。现在用 `scrubTarget/scrubAt` 记住在飞目标，260ms 内新一步从**上一个目标**续算并瞬时跳到起点，N 格 = 一次连贯位移。
  3. **从过期选中开始拨**：`selected` 可能停在很远的位置（例如打开时是最后一 Run，用户已滚到中间），拨一格会把列表**瞬移到别处**。现在基数按"指针所在列 → 列表顶部可见行 → 选中"的顺序解析（`topVisibleRunIdx`），始终从**你正在看的地方**开始。
  4. 附带：累加器在 400ms 无滚轮后清零，避免很久以前残留的增量"预付"下一次拨动。
- **回归套件（本次同时落地）**：`node mockup/regress.mjs <GUI_URL>` 一条命令跑 9 项（syntax / unit / smoke:load / smoke:render / served / cdp:scrub / cdp:wheel / cdp:hover / cdp:follow），每项 harness 自带断言并以退出码表态；交付前必须 `ALL GREEN` 并把 summary 贴在回复里（规则写入 `agent.md` §0.2/§0.4）。
- **AC**：一格一 Run（像素/行/页三种 deltaMode 均可）；快速连拨 10 格 → 选中 +10、落点 34%、滚动**单调不倒退**、页面不滚动；在列表中部拨动不会瞬移；`node mockup/regress.mjs` **ALL GREEN（9/9）**；`check-served` 128/128；单测 43/43。

## 50. 滚轮"无法持续滚动"的根因：hover 钉住了步进基数（F173）

- **F173 现象**：在矩阵上滚动，**第一格能动，之后就不动了**（无法持续滚动）。
- **根因**：F172 把步进基数改成"**指针所在列 → 列表顶部可见行 → 选中**"。但滚轮操作时**指针始终停在矩阵上某一列**，`hover` 每格都等于同一个值 → `from = hover` → `next = hover + 1` → **每一格都算到同一列**，于是卡在第一格之后不动。选择变了，但基数没变。
- **改法**：步进基数改为**光标优先**——`selected`（可见窗口内）→ 列表顶部可见行（`topVisibleRunIdx`）→ 悬停列（仅在没有光标时兜底）。滚轮移动的是**光标**，hover 只负责预览（高亮带 + 读数），不再决定步进起点。
- **回归补齐（关键）**：上一轮的 `cdp:wheel` harness 是**简化复刻**，它只用 `selected` 算基数、根本没模拟"指针停在某列"，所以这个 bug 在绿灯下漏到了线上。现在 harness 显式引入 `hovered = 40`（全程不动的停靠列）并复刻产品规则，新增断言：**指针停靠不动的情况下连拨 3 格必须前进 3 个 Run**。
- **AC**：指针停在矩阵上不动，连续滚动可以一路拨到底（一格一 Run）；中途反向同样连续；`node mockup/regress.mjs` **ALL GREEN (9 checks)**；`check-served` 128/128；单测 43/43。

## 51. 简化交互：鼠标与滚轮统一成"单 Run 聚焦"，单击即打开（F175）

- **F175 需求简化**：不再区分"悬停预览"和"滚轮拨动"，**指针与滚轮走同一条聚焦路径**：
  1. **悬停矩阵某一列** → 该 Run 成为**唯一聚焦行**：列表其余行压到 22%，焦点行全亮 + 3px 左轨 + 16% 底色，同时把该行滚到视口 34% 处；
  2. **滚轮** → 在这个焦点上 ±1 个 Run（同一套聚焦 + 落位逻辑），指针停着不动也能连续滚动；
  3. **移出矩阵** → 清除聚焦、恢复全亮；
  4. **单击矩阵任意元素** → 直接**打开**该 Run（展开 step 列表 + 滚到列表顶部），并保留选中带与 `Run N ✕` 胶囊。
- **实现**：`OverviewBoard` 的鼠标解析器（F171）与 `onWheel` 都调用 `onScrub(idx)`；`Body.beginScrub` 改为纯聚焦函数（`null` = 清除），取消原来的 700ms 自动清除（指针在矩阵上就保持聚焦）；`onWheel` 不再改 `selected`，只移动焦点，`selected` 仅由单击写入 —— 于是"选中（带）"与"聚焦（行）"语义清晰分离。
- **顺带修掉的真 bug（F174 根因）**：列表自带的尾部留白让"是否在实况边缘"的判断在末尾附近恒为真，滚动监听把我们**自己补间产生的滚动**误判成用户滚动 → 重新开启跟随 → F170 的"光标骑最新 Run"又把光标拽回最后一行，表现就是**滚一格弹回、无法持续滚动**。现在所有程序化滚动（`scrubTo` / locate glide / `scrollToLatest`）都打 `markProgrammatic` 标记，滚动监听忽略；边缘判定同时要求 `scrollTop >= maxScroll - 8`。
- **回归升级**：新增 `mockup/integration-harness.html` —— **直接抽取 client.js 里的 `onWheel` / `scrubTo` / `beginScrub` / `stopFollowing` / `topVisibleRunIdx` 源码**在普通 DOM 里运行，并镜像 Body 的跟随/程序化滚动/实时 tick。套件项 `cdp:focus` 断言：悬停聚焦 1 行并压暗、滚轮 +5、tick 不拽回、页面不滚动。
- **AC**：悬停/滚轮效果一致且只高亮一行；单击即展开该 Run；连续滚动不弹回；`node mockup/regress.mjs` **ALL GREEN (8 checks)**；`check-served` 128/128；单测 43/43。

## 52. 去掉矩阵滚轮 + 放慢聚焦滑行（F176）

- **F176 两条调整**：
  1. **去掉鼠标滚轮效果**：矩阵不再拦截 `wheel`（监听器、`deltaMode` 归一、累加器、`programmatic` 之外的整套拨动逻辑全部删除，`-2.3 KB`）。滚轮回到浏览器默认行为；矩阵只由**指针**驱动。
  2. **放慢聚焦滑行**：`scrubTo` 的时长从 120ms 提到 **300ms**（`DESIGN.motion.focus`），缓动由 `easeOutCubic` 换成 **easeInOutCubic** —— 原来 120ms 的 cubic-out 眼睛还没跟上就结束了，"看不清挑了哪一行"。
- **保留**：悬停/方向键仍然走同一条聚焦路径（压暗其余行 + 滚到 34%）；单击仍直接打开该 Run；跟随（F170）与 `↓ Latest` 不变。
- **回归升级**：`cdp:focus` 改成断言"**滚轮不再移动焦点、不再滚动列表**"，并新增"**滑行必须仍然在途中**"的断言（悬停后 ~90ms 采样，`scrollTop` 必须尚未到达终点）—— 这条能挡住"又把时长改回瞬时"的回归。
- **AC**：矩阵上滚动鼠标 → 焦点与列表都**不动**（浏览器默认滚动）；悬停某列 → 单行高亮且约 300ms 平滑滑到位；单击 → 直接展开；`node mockup/regress.mjs` **ALL GREEN (8 checks)**；`check-served` 128/128；单测 43/43。

## 53. 矩阵卡置顶 + 去掉卡片阴影（F177）

- **F177 两条调整**：
  1. **置顶再加两道保险**：F155 起表头块本就是滚动区**外面**的 flex 兄弟（结构性不滚），本轮补上：
     - 表头块 `position: sticky; top: 0; z-index: 4` + `data-hades-header` —— 万一宿主让**页面**滚动，它仍贴在视口顶部；
     - shell 高度改用 **`ResizeObserver` 监听父容器**（原先只有 `window.resize` + 250ms 一次）—— 侧栏展开/输入框变高时父容器会变，旧逻辑留着过期高度，页面就会接管滚动、把矩阵带走。
  2. **去掉矩阵卡的投影**：`box-shadow: 0 10px 18px -14px` 删除，只留 1px 描边 —— 它是固定在顶部的仪表盘，不是浮在列表上的卡片；阴影让它读成"悬浮物"。（`↓ Latest` 胶囊仍保留投影，那确实是一个浮层。）
- **AC**：滚动 Run 列表时矩阵与 KPI **完全不动**；页面被宿主滚动时表头仍贴顶；矩阵卡**无投影**；`node mockup/regress.mjs` **ALL GREEN (8 checks)**；`check-served` 128/128（新增 `data-hades-header` / `new ResizeObserver`，并把矩阵阴影加进 absent 断言防止回潮）；单测 43/43。

## 54. 相对位置高亮：矩阵悬停不再让行乱跳（F178）

- **F178 现象**：在矩阵上移动鼠标时，下方列表**疯狂跳动** —— 因为每换一列都把该 Run 重新锚定到视口 34% 处，扫过 175 列就是 175 次滚动。
- **改法**：把"每次锚定"换成**舒适带最小滚动**：
  - 定义 `bandTop = 12% / bandBottom = 78%`（视口高度百分比）；
  - 焦点行**已在带内 → 完全不滚动**（这就是"相对位置高亮"：高亮跟着指针走，列表不动）；
  - 只在焦点行**要离开带**时才滚，且只滚**刚好**把它带回带内（回来到 12% / 推到 78%），不再拉到 34%；
  - 300ms easeInOutCubic 与 `markProgrammatic` 保护保持不变。
- **回归**：`cdp:focus` 新增断言"焦点行位于视口 40% 时悬停**不得**改变 `scrollTop`"，以及"落点必须落在 0–80% 的舒适带内"；断言基线改为"紧邻状态"（原先对比的是更早的状态，会误报）。
- **AC**：鼠标在矩阵上横向移动时，列表**基本不动**，只有高亮行跟着指针变；只有移到当前视口外的列时列表才平滑地挪最小距离；单击仍直接展开；`node mockup/regress.mjs` **ALL GREEN (8 checks)**；`check-served` 131/131；单测 43/43。

## 55. 固定焦点线：行在滚动，高亮不动（F179）

- **F179 目标**：视觉上**下方的 run 在滚动**，而高亮始终停在**同一个屏幕行位置** —— 像扫描线，而不是高亮本身在行间移动。
- **改法**：把 F178 的"舒适带最小滚动"换回**固定焦点线**：
  - 焦点行**恒定落在视口 34%**（`anchor = viewH × 0.34`）；悬停不同列时，列表移动让那一行走到这条线上，所以眼睛看到的是**列表在滚**、高亮不动；
  - 连续悬停/方向键时用 `scrubTarget/scrubAt` **合成位移**（260ms 内从上一个目标续算），所以扫过一串列是一次连贯滑动，而不是一格一跳；
  - 300ms easeInOutCubic 与 `markProgrammatic` 保护保留。
- **回归**：`cdp:focus` 改为断言"**焦点行必须落在 34% ± 6%**"（悬停远处列后也一样），并断言"悬停到线外的行**确实滚动**了列表"；同时保留"滚轮不动焦点""tick 不拽回"。
- **AC**：在矩阵上横扫，列表连续滚动、高亮稳定停在一条水平线上；单击仍直接展开；`node mockup/regress.mjs` **ALL GREEN (8 checks)**；`check-served` 131/131；单测 43/43。

## 56. 点击展开后行位置漂移的两处隐患（F180）

- **F180 现象**：hover 矩阵 → 点击某一列 → 该 Run 展开（并滚到顶部）→ 鼠标向下移出矩阵时，**行位置会变**。
- **两处已修隐患**（都属于"列表自己动了"的类别）：
  1. **焦点标记走 React props**：`focusRun` 曾是 `DualBarChart` 的 prop 并参与**行缓存键**，指针离开矩阵时（`focusRun → null`）会**重建那一行**；展开中的行被重建会重挂 `Collapse` 子树，高度短暂变化 → 列表位置跳动。现在焦点标记改为**直接操作 DOM**（`markFocusedRow` 给行节点加/去 `is-focus`，只留根节点上的 `hades-scrubbing` 控制压暗），**不再触发任何行重渲染**；payload 刷新重建行后由 `applyNow` 重新补一次标记。
  2. **浏览器滚动锚定**：列表滚动位置由我们完全接管，但 Chrome 的 scroll anchoring 会在"视口上方内容变高"时**偷偷改 `scrollTop`**（展开的行、随后到达的 step 内容都会变高）。给滚动容器加 `overflow-anchor: none`，位置只由我们的补间决定。
- **验证边界（如实记录）**：`cdp:focus` 新增了完整场景回放（hover → 点击展开 → 详情增高 240px → 指针移出），断言"点击后滚到位""详情增高不得移动列表""移出矩阵不得移动列表"，全部通过；但**在 harness 里把 `overflow-anchor` 改回 `auto` 同样通过**（harness 的增高发生在视口顶部那一行内，锚定不会触发），所以**该断言无法证明锚定就是线上那次漂移的唯一原因** —— 需要真实面板确认。
- **AC**：点击展开后把鼠标移下、移出矩阵，行位置**不再变化**；`node mockup/regress.mjs` **ALL GREEN (8 checks)**；`check-served` 131/131；单测 43/43。

## 57. 点击展开后行被"拉回中线"：定位锁（F181）

- **F181 现象（复现步骤明确）**：鼠标在矩阵上移动 → 点击某列 → 该 Run 展开并**顶到列表顶部** → 鼠标一离开矩阵，那一行**又滑回中间**（原高亮所在的 34% 焦点线）。
- **根因**：点击走 `locateRun`（把行滚到**顶部**），但指针仍停在该列上；一旦指针移动/离开，`beginScrub(idx)` 会按**悬停聚焦**语义把同一个 Run 重新滚到 **34% 焦点线** —— 两个锚点互相打架，行就被拉回中线。
- **改法**：加一把**定位锁** `locatedRunRef`：
  - `locateRun(idx)` 时记下 `idx`（这次点击把它停在顶部）；
  - `beginScrub(idx)` 若 `idx === locatedRunRef`，只更新压暗/高亮，**不再滚动**（并清空锁）；
  - 指针挪到**别的列**时照常按焦点线滚动。
- **验证**：`cdp:focus` 新增"点击后重新悬停同一列不得移动列表"断言；**并做了对照实验**——把 harness 里的定位锁去掉后，该断言与控制实验立刻变红：`leaving the matrix moved the list (3526 → 3375) · re-hovering the clicked column moved the list (3526 → 3375)`，说明这条断言确实能抓住本次回归。
- **AC**：点击 → 行展开并停在顶部；鼠标移开矩阵 → **位置不变**；再悬停别的列 → 正常按焦点线滚动；`node mockup/regress.mjs` **ALL GREEN (8 checks)**；`check-served` 134/134；单测 43/43。

## 58. 范围外（v1 不做）

- 跨会话对比（并行对比多个会话 trace）。
- 事件追加 / 自定义事件类型 / 写回。
- Typert 类型化 Remote 重写（除非 R1 结论要求）。
