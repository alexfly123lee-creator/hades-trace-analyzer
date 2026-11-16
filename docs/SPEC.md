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
  - AC：对话区视图环（紧邻内置「轨迹」右侧）出现「Hades Lab」Tab（zh/en「Hades Lab」）；点击打开分析视图，标题走 locale。
- **F02 作用域**：仅分析当前打开会话，跟随 session 切换。
  - AC：切换会话后 Tab 内容自动重建为对应会话数据，不残留上一会话。
- **F03 打开入口**：视图环上的「Hades Lab」Tab 即入口，点击打开/切换。
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
  - **行宽（列宽）**：Time 条 150 → **170**、Token 条 100 → **112**、数字槽 64/46 → **70/50**（排序热区随之 220/152 → **246/168**）；行索引列 64 → **78**（12px 下 `▸ step 199` 约 62px，不能溢出到柱子）；
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
  - **柱子宽度过渡**：Time/Token 条的 `width`（以及 `TimeBar` 的 `left`）加 `transition .25s`，新值不再硬跳，缩放看起来是"长过去"的；
  - **行按 `idx` 复用**：run 行 key = `idx`、step 行 key = 序号、面板活动行 key = `seq`，新事件只新增尾部行、只有数值变更的行重绘。
  - **AC**：面板开着空闲 30 s，React DevTools 里**无 commit**、Performance 面板无 paint；新事件到达时只有新增/变化的行更新，其余行的 DOM 不重建；打开某个 step 观察，面板内容**不出现空态闪烁**，工具行在结果到达时原地长出耗时；切换排序时仍有 FLIP 动画；`check-served` 37/37；单测 41/41。

## 20. Token 的时序切片（F142）

- **F142 step 行的 Token 条 = run 总量的百分比切片，按顺序累加**：展开一个 run 后，**每一行 step 的 token 轨道整条就代表该 run 的总消耗**；第 k 个 step 占据 [累计(k−1), 累计(k)] 那一段——左边缘 = 前面所有 step 的累计占比，宽度 = 它自己占 run 的百分比，各段首尾相接一直铺到 100%。
  - 轨道里：**淡色 = 这一步之前已经花掉的部分**，**深色块 = 这一步自己的份额**，**背景 = 还没花的剩余**；
  - 数字列仍显示这一 step 自己的 token；tooltip 给 1.6k tok · 0.6% of run · 累计 37.7k (14%)；
  - 时间列不变（step 在 run 时间轴上的位置），所以同一行同时给出「时间位置」与「token 位置」；
  - **不用新增字段**：只用 /run 里已有的 per-step 	oken 在客户端累加（/runs 仍是 51.8 KB，P01 门槛维持 64 KB）。初版曾把分布画在 run 行并为此加了 segments 字段，已按反馈改掉。
  - **AC**：112px 轨道上，最后一步切片右边缘恰好 100%；每段宽度 ∝ 该步 token；Σ step.token = run.token（单测断言 5 步累计序列 [110,330,660,1100,1650] 与 run 总量相等）；展开 211 步的 run 仍只渲染 80 行（F138 分页）；样例见 mockup/step-token-preview.png。
## 21. 展开动效（F144）

- **F144 点击展开有平滑动效（方案 A）**：展开/折叠不再瞬时切换，而是**高度 + 淡入**，一条统一曲线、**没有逐行 stagger**（最克制的一版，见 mockup/expand-motion-demo.html）。
  - **展开 200ms / 折叠 140ms**：打开时 height 0 → 内容高度、opacity 0 → 1，曲线 cubic-bezier(.2,.7,.3,1)；折叠用更短的 140ms 和 cubic-bezier(.4,0,1,1)，收回要"跟手"。
  - **实现**：Collapse 组件用 WAAPI——打开时量一次 scrollHeight 再 element.animate，动画结束把 height 落回 uto（避免内容再变化时被固定高度裁掉）；**关闭时保留最后一次内容 140ms** 完成收起后才卸载，所以折叠也有动画而不是"啪"地消失。
  - **按需挂载**：关闭的 run/step 不渲染子树（CSS  fr→1fr 那套要求常驻 DOM，200 步的 run 会白挂几百个节点，故不用）。
  - **长 run 降级**：run 的 step 数 > 60 时跳过高度动画，改为 **160ms 纯淡入**——7000px 的高度动画每帧都要重排，必然掉帧。
  - **箭头**：▸ 用同一个字符**旋转 90°**（160ms），不再替换 ▸/▾，展开时索引列不会抖动。
  - **只响应用户点击**：动画只在 open 变化时触发；F140 的实时刷新（efreshToken/payload 替换）不会重放动画。
  - **无障碍**：prefers-reduced-motion: reduce 时直接切换，不做任何动画。
  - **AC**：DevTools Performance 录一次展开，动画期间**无 >50ms 长任务**、每帧 ≤16.7ms；快速连点 10 次不出现动画叠加或高度错位；折叠后该 run 的子节点已从 DOM 移除；200 步的 run 是一整块淡入而非缓慢长高；系统开启"减少动态效果"后瞬时切换；check-served 44/44（新增 unction Collapse / prefers-reduced-motion 两个标记）；单测 42/42 不变。
## 22. 范围外（v1 不做）

- 跨会话对比（并行对比多个会话 trace）。
- 事件追加 / 自定义事件类型 / 写回。
- Typert 类型化 Remote 重写（除非 R1 结论要求）。
