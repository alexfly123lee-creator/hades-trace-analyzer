# Trace 分析面板 — 表现层设计（DESIGN）

> 视觉、交互与样式**统一规范**（设计原则 + DSH 设计令牌，合并为单一事实来源）。
> 数据模型见 `agent.md` §3.4（`session → run(一次指令) → step(迭代) → 操作`）。
> 设计范式来源见 §0；DSH 样式令牌见 §5（**唯一样式基准**：颜色/字体/圆角/动效，严格遵循，禁止写死）。

## 0. 调研来源与结论

| 来源 | 关键范式 |
|---|---|
| [Dashboard Layout Best Practices (Datadog/Stripe/Google 案例)](https://kindatechnical.com/data-visualization/dashboard-layout-best-practices-and-design-patterns.html) | F/Z 扫描模式：左上角最高关注、顶部放 KPI、第二层放趋势、底层放明细 |
| [Header KPI strip (Konigi)](https://patterns.konigi.com/dashboards/header-kpi-strip/) | 顶部一排关键指标卡，统一 label/value/context 布局，**带趋势/对比，不只放大数字** |
| [Grafana 布局参考](https://raw.githubusercontent.com/xobotyi/cc-foundry/refs/heads/master/plugins/grafana/skills/dataviz/references/layout.md) | 顶部 = 当前值 stat 面板；第二行 = 趋势；更低 = 明细；SLO/错误率放最显眼 |
| [SigNoz 新版 trace 详情](https://signoz.io/blog/new-trace-detail-view/) | trace 的标准视图 = **flame graph + waterfall + 搜索 + span 详情**，十万 span 也要能一眼定位失败 |
| [Agent Observability: Why Traces Stay Green (MorphLLM)](https://www.morphllm.com/agent-observability) | 完整 span 树在 200 span 时不可读；**回答「这次跑得对不对」靠 summary，排查具体失败才要完整树** |
| [Langfuse session 详情重设计](https://github.com/langfuse/langfuse/pull/15346) | 用 **accordion 折叠密集细节**、compact 视图、scores 摘要，避免一屏塞满 |

**提炼出的核心结论**：

1. 用户扫描路径是「先看左上 → 顶部 KPI → 再趋势 → 最后明细」。所以**统计摘要必须在最顶部、用大数字高亮**，明细下移或折叠。
2. **「这次 run 是否健康」用 summary 回答，而不是把完整 trace 树铺满**——密集树只在用户主动下钻时才展开。
3. trace 的**标准可视化是瀑布（waterfall）+ 火焰图（flame graph）**，用时间条表达时序和耗时，而不是文字表格。
4. 密集细节用 **accordion / 折叠**渐进披露；KPI 卡片要带上下文（如「最慢 13m05s / ask_user_question」），不能只有光秃数字。

## 1. 核心设计原则

1. **摘要优先，明细下钻（summary-first）**：先给「健康结论」（KPI + 异常），再让用户按需下钻到具体 run / step / 操作。
2. **KPI 一行 + 透视矩阵（F150）**：顶部不再是一排大数字卡片，而是「一行紧凑 KPI（数字 + 标签 + 上下文）+ 4 行热力矩阵（每个 run 一列）」；矩阵负责回答"哪个 turn 值得看 / 问题在哪"，KPI 负责总量。异常用语义色（红/橙）点在矩阵上，而不是分散在 8 张卡里。
3. **时间即空间**：执行明细一律用瀑布（时间条），条的位置=开始、宽度=耗时，父子「条包条」。
4. **渐进披露**：run 默认展开、step 默认收起、操作日志默认收起；点击才展开，避免密集铺满。
5. **语义色板**：`error=红`、`slow/warn=橙`、`ok=绿`、`模型/时间=蓝`、`Token=紫`，全局一致，配合图标/文字（色盲可读）。
6. **F/Z 布局 + 全宽自适应**：顶部 KPI、次行趋势图、底部明细；面板随窗口无限铺满，卡片列数自适应。
7. **一图双维度**：同一张图里同时表达「时间」和「Token」两个资源维度（双条/双轴），让每层 run 的资源消耗一眼可对比。
8. **表格优先、痕迹淡、不加粗**：run 列表用表格化列对齐；分隔线用最淡边框；所有字体一律 400（不加粗）。

## 2. 信息架构

```
┌ Trace Lab（主对话区视图环）─────────────────────────┐
│ 运行总览（单一视图，无 tab）                          │
├─────────────────────────────────────────────────────┤
│ KPI 一行 + 透视矩阵（F150）                          │
│ ⇅Time | ⇅Token      ← 整列热区 · 三态排序（F132）   │
│ run 表：run 文字 280px 定宽 + 时间/Token 双条撑满      │
│          + 耗时/Token 数字固定右（上下两行 gap 6）     │
│    ▾ 点行 → 就地展开 step → 操作 局部瀑布             │
└─────────────────────────────────────────────────────┘
```

- **统计单位 = run**（一条真实用户指令的执行，0-based：run0 = 系统提示词，run1 = 第一条真实 prompt）。
- **单一视图**：原「概览（聚合）」与「时间线（展开）」合并为一张可展开的 run 表，点行**就地展开** step/操作，不再跨 tab 下钻。
- 已去掉「血缘」tab（官方轨迹无此数据类目）。
- **加载方式**：首屏只取 `/runs`（KPI + run 行），展开 run 才取 `/run`，展开操作才取 `/event` 原文（§7）。

## 3. 运行总览（单视图）

### 3.1 顶部模块（F150/F151：KPI 卡 + 吸顶矩阵卡）

**两个模块，不是一个卡**：

1. **KPI 模块**（F153 起与矩阵一起吸顶）：`Run 数 / Step 数 / 事件数 / Token 总量` + `错误 / 慢操作 / 异常 Run / 最慢操作` 压成一行（15px 数字 + 11px 标签 + mono 上下文）。
2. **KPI + 矩阵整块**（**F152/F153：`transform` 钉住**，不是 `position: sticky`）：两块装在同尺寸占位 `div` 里，滚动时按占位盒的视口坐标算 `translateY(max(0, min(pinTop − wrapTop, maxT)))` 写到块的 `transform` 上，布局空间无关、不依赖谁在滚、到列表底部停住；占位盒铺 `surface` 底色，避免两块之间 8px 的缝透出后面的行。矩阵 4 行 × 每个 run 一列。

| 行 | 含义 | 颜色 | 计算 |
|---|---|---|---|
| Time | 该 Run 的耗时排位 | 蓝 `accent` | 会话内**排名**映射到 8%–88% 透明度 |
| Token | 该 Run 的 token 排位 | 紫 `chart-tools` | 同上 |
| 步数 | 该 Run 的 step 数排位 | 绿 `success` | 同上 |
| 异常 | 是否有错/慢 | 红 / 橙（**58% 半透明**）/ 发丝灰 | `hasError` → 红，`hasSlow` → 橙 |

- **行标签同色（F152）**：4 行标签一律 `label-secondary` 中性灰——颜色只出现在色块与单元格上，不再让标签本身带色。
- **为什么用排名**：本会话 token 中位 13.4k、最大 691k（52× 偏斜），线性映射只会亮一格。
- **十字线（F151/F152）**：`track = (100% − 标签列 − 间隙总数) / n`、`left = 标签列 + i × (track + 1px)`、`width = track` —— 线与单元边界重合；F152 起拆成**三个独立矩形**（14% 淡底 + 左右各 1px 线，无边框/无圆角）并画在单元之后，避免列宽 2–4px 时 1px 边框把盒子压成梯形。
- **读数**：悬停时同一行右侧显示 `Run 90 · 1.9min · 691.2k tok · 33 步 · 有错误 — <prompt>`；未悬停显示操作提示（共用一行，卡片不跳高）。
- **点击定位（F151）**：`rAF` 手写补间（`easeInOutCubic`，260–700ms 按距离），落点为行距容器顶部 32% 处（避开吸顶卡），连点取消上一段；`prefers-reduced-motion` 直接跳。滚动所有者可能是面板自己，也可能是对话页（F152 自动判断）。
- **图例（F152 / F160）**：**纯色块 + 文字** —— `■ Time ■ Token ■ 步数 ■ 有错误 ■ 有慢操作`。F160 删掉了 `▭低→高渐变`：它没有任何刻度或标签，看起来像一条跑偏的进度条；"颜色越深 = 排位越高"改为挂在三个行色块的 tooltip 上。
- **无头部运维条（F151）**：不显示缓存命中 / 服务端 ms / 首屏 / 渲染 / 实时徽标 / 刷新按钮；实时 tick 照旧在后台跑。
- **最慢操作口径（F150）**：`kpi.slowest` / `kpi.slow` / run 的 `hasSlow` 一律**排除人机等待**（`ask_user_question` / `exit_plan_mode` / `plugin_manager` 且 ≥5s）；等待仍以 `⏸` 出现在 Step 行。

### 3.2 run 表（表格化，可展开）

- 每 run 一行（表格化，行底 `--dsw-alias-border-l1` 淡分隔线，**不加粗**），列序从左到右：
  - **Turn index 64px**（最左：`run N` + 展开箭头 ▸/▾）。
  - **单条 180px**（固定宽，紧挨 index；随排序键只显示一个指标：按时间=时间蓝条 `--dsw-alias-trajectory-accent`、按 Token=Token 紫条 `--dsw-alias-chart-tools`；**数值右对齐显示在条内**，颜色 `--dsw-alias-label-primary`）。
  - **Turn 内容（prompt）自适应撑满**（`flex:1` + `min-width:0` + ellipsis + hover 全文；**F147：全文进 DOM，只在真实宽度处由 CSS 截断**，不再有 80 字上限；run0 显示「系统提示词」）。
  - 状态点 8px（错误/慢）。
- **展开即一组（F130，无分隔线）**：组内不画任何分隔线（Run 行与 Step 之间、Step 之间、明细行之间都是留白），纯靠括号 + 空白间隔表达结构，更接近"极简大纲"。Run 行 + 它的全部 Step 共用一个分组容器——**括号描边保留、底色去掉**：Run 分组 = 1px `accent 25%` 描边 + 3px 蓝轨 + `radius-md` 圆角；Step 括号 = 同样的描边/蓝轨/圆角，整体缩进一级；两者**都不填充底色**，只有展开的行有填色（Run 8% / Step 22%）；Run 块"很淡"、Step 块"更深"，两块靠明度差区分。折叠时恢复普通行。**整体性是「展开」给的，不依赖选中**。
- **点行 → 就地展开**该 run 的 step 列表；**层级靠缩进**：Step 行（连同它的括号）整体内缩 **12px**，`run N` 在 0；Step 行的 index 列相应收窄到 49px（12 + 3px 轨），使**时间列与 Token 列和 Run 行严格同列**；明细再在括号内缩进 74px。
- **Step 行（F128）**：`step N`｜**150px 时间条**｜**150px Token 条**（**轨道定长且两列等宽**（F146）：时间 150px / Token 150px，数字槽同为 70px；轨道底色 12% 同色相、无边框；数值放在条右侧**固定宽度**的格子里右对齐，位置不随数值变化；**统一以秒显示、数字与单位不留空格**——`0.58s` / `19.10s` / `94.6s`（<10s 两位小数，≥10s 一位小数）；Token 不重复 `tok`，只显示 `18.3k`；表头 `Time` / `Token` 右对齐压在各自数字列上，与 Run 行共用 `MetricBar`）｜**标题**（F23.1）｜错误点。
- **计时口径（F133，对齐官方轨迹）**：step 耗时 = **模型 + 工具**（`assistant/message − step/start` 加上 Σ 工具 durationMs），与官方"组头含工具跨度 + assistant 总耗时"同源；**人机等待**（`ask_user_question` / 审批类工具 ≥5s）单列为 `⏸`，不进耗时；`run 时长 = Σ 各步执行耗时`。没有模型且无工具的步显示 `—`。
- **Step 标题（F23.1 + F135 + F137，标签式）**：行上第一个元素是**动作标签**（`读取` / `修改` / `运行` / `回复` / `压缩` / `失败` / `交付` …，19px 高、10px、650、1px 边框，几何同 F136），后面跟对象文本——`[读取] client.js:226`、`[修改] DESIGN.md`、`[回复] 现在完全摸清了…`。
  - **多动作（F137）**：一个 step 里有几种不同动作就给几枚 chip（最多 3 枚，按调用顺序），**同一动作重复折叠成计数** `EDIT ×6`，超出的动作收进一枚中性 `+N` chip。回复类行是 `REPLY` 打头 + 它实际调用的动作 chip（`REPLY` + `EDIT ×6`）；原先写成文字后缀的 `· 修改 ×3` / `· +2 次调用` 已取消——次数由 chip 的 `×n` 承载。chip 名词一律取自 `leadTag()`，客户端只有一张 `STEP_TAG_EN` 映射表，所以不会出现两个词指同一动作。
  - 无文本无工具但有压缩/重试时用该事件当标签（`[压缩] 12.5k tok`、`[失败] RATE_LIMIT`）。标签配色只承载语义：失败=error、重试/压缩=warn、交付/回复=品牌色、其余中性。**状态标记最多 2 个**；原始长摘要保留在 `text` 里做 tooltip。
- **Step 说明行（F23.2）**：压缩 / 重试 / 失败 / 文件变更 / 斜杠命令 / 计划 / 清单 / 交付 / 审批 在详情面板里各占一行 muted 说明行（左侧 19px 标签 + mono 说明），按事件顺序插在原位；`job/*`、`session-log-deepseek/*`、`request/header` 等纯传输/包装事件不渲染。
- **列头排序控件（F132，可点击暗示）**：列头不是纯文字，而是**整列热区**的按钮（条槽 + 数字槽，220px / 152px；高度 = 表头整行）。三档视觉状态：**未排序** = `⇅` 两枚箭头各 35%，标签 `label-secondary`；**悬停/聚焦** = 整列 8% accent 底 + 底部 1px 55% 线（把热区画出来），双箭头提到 55%；**排序生效** = 只点亮当前方向（100%，另一枚 22%），标签转列主色。点击循环 **默认 → 降序 → 升序 → 默认**；生效时列右侧出现状态胶囊「已按 Time ↓ 排序 ✕」。图标占固定 7px 槽位、悬停底色不改布局，排序时文字不位移。
- **表头对齐（对齐柱子，不对齐数字）**：表头 `Time` / `Token` 是**柱子列**上的按钮——热区只有条槽（各 150px，F146 前为 170 / 112px），文字左边缘与柱子左边缘重合，方向箭头跟在文字右侧（固定 7px 槽）；数字列不设表头。表头单元格宽度仍与行一致（各 226px），列位置不漂移。
- **行标签统一（F136）**：Turn 行与 Step 行共用**同一个标签组件**（20px 高 / 11px / 650 / `padding 0 6px` / 1px 透明边框 / radius-xs），位置也相同（指标条之后、正文之前，独立 flex 子项、gap 10）。Turn 放**角色**（`USER` / `SYSTEM`），Step 放**动作**（`READ` / `EDIT` / `RUN` / `REPLY` / `FAIL` / `DELIVER` / `COMPACT` / `SYSTEM` / `CONTEXT`）；**标签一律英文大写**（中文放 tooltip），与 `run` / `step` / `Time` / `Token` 一致；动作标签的颜色映射到角色调色板：工具类动作=warn（同「工具」）、回复=assistant、系统提示词=system、仅注入=success、失败=error、重试/压缩=warn。**两级只换词表，不换外观**；Step 行可以并排多枚同一几何的动作 chip（F137），不引入第二套尺寸。
- **角色标签（F131，与内置「轨迹」逐项对齐）**：kind 集合、中文标签、配色与标签几何全部照抄轨迹的 `kindTag`（`TrajectoryTable.module.css`）。
  - **落位**：Run 行在指标条之后放一枚（触发者：run0=系统、其余=用户）；**Step 行不放**；点开 Step 后，每条明细行各放一枚（用户指令 / 上下文 / 助手概述 / 每个工具块）。
  - **标签几何**：高 20px、`padding: 0 6px`、1px 透明边框、`--dsw-radius-xs`、`font-size 10px / line-height 16px`、`font-weight 650`、`letter-spacing .035em`、无圆点（与轨迹一致）。

| kind | 中文 / 英文 | 前景 | 背景 |
|---|---|---|---|
| `user` | 用户 / USER | `--dsw-alias-state-business-primary` | `--dsw-alias-state-business-tertiary` |
| `assistant` | 助手 / ASSISTANT | `color-mix(in srgb, var(--dsw-alias-brand-primary-new-colorprimary-new-color) 60%, var(--dsw-alias-state-error-secondary))` | `color-mix(in srgb, color-mix(in srgb, var(--dsw-alias-brand-primary-new-colorprimary-new-color) 55%, var(--dsw-alias-state-error-secondary)) 15%, var(--dsw-alias-bg-layer-1))` |
| `context` | 上下文 / CONTEXT | `color-mix(in srgb, var(--dsw-alias-state-success-primary) 68%, var(--dsw-alias-label-secondary))` | `--dsw-alias-state-success-tertiary` |
| `system` | 系统 / SYSTEM | `--dsw-alias-label-secondary` | `--dsw-alias-bg-module-platform` |
| `tool` | 工具 / TOOL | `--dsw-alias-state-warn-label` | `--dsw-alias-state-warn-tertiary` |

> 轨迹另有 `subtool`（子项）/`compacted`（已压缩）两类，本插件当前数据模型不产生，暂不实现。
- **展开的 Step = 括号容器（Step 行 + 明细同框，F129，无嵌套）**：点开 step 后，**该 step 行与它下面的明细一起**被一个括号容器托住——**描边不变、底色去掉**：1px `accent 38%` 描边 + `border-left: 3px` 蓝轨 + `radius-md`，`background: transparent`；**容器整体 `margin-left: 12px`**（Step 层级内缩，与 Run 分组轨道错开）；明细区在容器内再缩进 74px、自身透明。收起时 Step 行仍保持 16px 缩进，所以展开/收起不会左右跳。层级：Run 分组（中性灰底 + 灰轨）→ Step 括号（accent 6% 底 + 蓝轨）→ 展开的 Step 行（accent 16% + 60% 环），**颜色焦点落在 Step 这一层**，所以「行被展开」和「下面那块容器」是同一个状态的颜色暗示。结构：
  - **构成概览行**（10px muted、等宽数字）：`模型 provider/model · 模型调用 N · 工具调用 N · 上下文 N · 计时 · Token in/out/cache`；
  - 行按事件 `seq` **顺序**排列（不按类型分组）：`[用户] 指令`（run 由用户发起且是首个 step，≤400）→ `[助手] 模型调用`（token + 文本 ≤400，6 行滚动）→ `[工具] tool · 名称 · 耗时`（错误红/慢橙；**参数** ≤400 → **结果** ≤400）→ `[上下文] 注入`（≤400）→ `[系统] 系统提示词`；
  - 行间用 **1px `--dsw-alias-border-l2`** 分隔（容器有底色，l1 会看不见；外层表格仍用 l1）；每行尾部可选「原文」按钮，就地展开该事件原始 JSON（单层 `<pre>`，默认收起）；
  - 工具结果已折叠进对应工具行，不再单独成行。
- **Step 行文字摘要（暂定，下一轮再改）**：优先 assistant 文本 → developer/system 文本；纯工具 step 为 `tool · 名称 · 参数预览`（多工具最多 3 个名字）；没有则 `—`。
- `run` 标签 = `run N · <prompt 文本>`；run0 恒标「系统提示词」；follow-up 无 prompt 时以「续跑」兜底；异常结束标红。
- 异常向上冒泡：某 step 有错 → step 和 run 行红点；折叠时也能看到。

## 5. 视觉规范 / DSH 设计令牌（唯一样式基准，严格遵循）

> 来源：`Theme.listTokens`（Inspect）+ `@deepseek-ai/dsh-client-ui-theme` 的 `design-platform.css` / `base.css` / `corner-shape.css`（运行版本 0.2.2-rc.3）。

### 5.1 颜色（语义别名 `--dsw-alias-*`，随明暗主题自动切换）

| 用途 | Token | 说明 |
|---|---|---|
| 文本主色 | `--dsw-alias-label-primary` | 主文字 |
| 文本次色 | `--dsw-alias-label-secondary` | 次级文字/辅助 |
| 文本三级 | `--dsw-alias-label-tertiary` | 更弱文字 |
| 弱文字/说明 | `--dsw-alias-label-caption` | 图注 |
| 背景基底 | `--dsw-alias-bg-base` | 应用基底背景 |
| 表层 1 | `--dsw-alias-bg-layer-1` | 抬升表面（卡片/行） |
| 表层 2 | `--dsw-alias-bg-layer-2` | 嵌套表面 |
| 边框 L1 | `--dsw-alias-border-l1` | **最淡**边框（表格分隔线；浅色 4% 黑 / 深色 6% 白） |
| 边框 L2 | `--dsw-alias-border-l2` | 较强边框（**容器内分隔线**用它：浅色 10% 黑 / 深色 12% 白） |
| 边框 L3/L4 | `--dsw-alias-border-l3` / `--dsw-alias-border-l4` | 更强/强调边框 |
| 链接/强调蓝 | `--dsw-alias-link` | deepseek 蓝 |
| 轨迹强调 | `--dsw-alias-trajectory-accent` | 蓝色（= blue-500），轨迹视图强调色 |
| 图表-消息 | `--dsw-alias-chart-messages` | 蓝色（= blue-450），模型/消息 |
| 图表-系统 | `--dsw-alias-chart-system` | 中性灰（系统） |
| 图表-工具 | `--dsw-alias-chart-tools` | 紫色（= violet-400），工具/第二指标 |
| 成功 | `--dsw-alias-state-success-primary` | 绿 |
| 错误 | `--dsw-alias-state-error-primary` | 红 |
| 警告 | `--dsw-alias-state-warn-primary` | 琥珀 |
| 失效 | `--dsw-alias-state-idle-primary` | 中性灰 |
| 选中边框 | `--dsw-alias-border-selected` | DSH 原生「选中」边框（neutral-bluish-400） |
| Run 行 hover 底（F148/F149） | 浅 `<accent 9%>` / 深 `<accent 22%>`（混 `layer-1`） | 未展开的 Run 行悬停；只用底色、不加描边；深色单独一套值（22%），展开态深色 30% |
| Step 行 hover 底（F148/F149） | 浅 `<accent 10%>` / 深 `<accent 26%>` | 括号内 Step 行悬停；深色单独一套值，展开态深色 36% |
| 主题切换（F149） | `body[data-ds-dark-theme]` → `DARK_TINT` | 调色板在渲染时解析 + `MutationObserver` 跟随，切主题即时生效 |
| 括号轨 | `--dsw-alias-trajectory-accent`（3px） | Run / Step 范围的标识：左轨 + 1px 描边 + 圆角（括号样式不变），**容器不填底色** |
| ~~分组边框~~ | 已移除 | 无 box 底色/整圈边框，只用括号标范围 |
| Run 展开底（派生） | `color-mix(accent 12%, layer-1)` | 展开的 Run 行淡蓝填色，比 hover 的 9% 深一档（F148 起从 8% 提到 12%，保证 hover 不会盖过展开态） |
| ~~Run 展开环~~ | 已移除 | 方案 1 取消行环，避免与外框形成双层边界 |
| Step 展开底（派生） | `color-mix(accent 22%, transparent)` | 展开的 Step 行底色（最深一档，浅 `#c3d8fc`），无环，由括号裁切 |
| ~~Step 括号底~~ | 已移除 | Step 范围同样只用缩进括号，不填充 |
| Step 括号描边 | `color-mix(accent 38%, transparent)` | 1px 描边，与 Run 的 25% 描边同色系；仅描边，无底色 |
| 容器描边/行分隔 | `--dsw-alias-border-l2` | Step 面板 1px 描边与行间分隔线（浅 10% 黑 / 深 12% 白） |
| 角色-用户 | `--dsw-alias-state-business-primary` / `-tertiary` | 轨迹 `kindTag.user` |
| 角色-助手 | `--dsw-alias-brand-primary-new-colorprimary-new-color` + `--dsw-alias-state-error-secondary` 混色 | 轨迹 `kindTag.message`（`assistantVioletBright`） |
| 角色-上下文 | `--dsw-alias-state-success-primary` 混 `--dsw-alias-label-secondary` / `--dsw-alias-state-success-tertiary` | 轨迹 `kindTag.context`（`contextGreen`） |
| 角色-系统 | `--dsw-alias-label-secondary` / `--dsw-alias-bg-module-platform` | 轨迹 `kindTag.system`（`systemNeutral`） |
| 角色-工具 | `--dsw-alias-state-warn-label` / `--dsw-alias-state-warn-tertiary` | 轨迹 `kindTag.tool`（`toolAmber`） |

> ⚠️ 关键：`--dsw-alias-brand-primary` 在 DSH 里是**中性色**（浅色近黑 / 深色近白），**不是品牌蓝**。需要蓝色强调时用 `--dsw-alias-link` / `--dsw-alias-trajectory-accent` / `--dsw-alias-chart-messages`。

### 5.2 字体

- 文本：`var(--dsw-font-family)`（系统栈：-apple-system / BlinkMacSystemFont / Segoe UI / PingFang SC / Hiragino Sans GB / Microsoft YaHei / Helvetica / Arial）。
- 代码/等宽：`var(--ds-font-family-code)`（SF Mono / JetBrains Mono / Fira Code / Consolas / Menlo / Courier / PingFang SC / Microsoft YaHei）。
- **字重：正文一律 400（不加粗）**。本插件的表格/列表内**禁止**使用 `fontWeight` 600 / 650 / 700；**唯一例外**是角色标签（F131）——它照抄平台轨迹的 `kindTag`，固定 `font-weight: 650` / 11px / 20px 高，属于「对齐平台既有控件」而非自造加粗。

#### 可读性基线（F139）

整页在 2026-11 放大了一档（原 10/11/12px 的字号读起来偏小）：

| 元素 | 旧 | 新 |
|---|---|---|
| 正文 / 行高 | 12px / 1.45 | **13px / 1.6** |
| 次要文字（行标题、面板行） | 11px | **12px** |
| 极次要（标签、元信息、数字） | 10px | **11px** |
| KPI 大数字 | 28px | **32px** |
| 行最小高 / 行内 gap | 26px / 10px | **30px / 12px** |
| 行索引列 | 64px | **78px**（`▸ step 199` 不溢出） |
| Time 条 / Token 条（含数字槽） | 150 / 100（64 / 46） | **170 / 112（70 / 50）** → F146 起 **150 / 150（70 / 70）** 等宽 |
| 标签 chip | 19px 高 / 10px | **20px 高 / 11px**（line-height 17、padding 0 6px） |

不变量照旧：表头标签与柱子左缘齐平、Run/Step 两列严格同宽、标签与指标条基线对齐；
字号只用 11 / 12 / 13 / 32 四档，不再出现 10px。

### 5.2.1 指标条只有一种画法（F145），两列等宽（F146）

| 属性 | 值 | 说明 |
|---|---|---|
| 列宽（F146） | 轨道 **150px** + 间隙 6px + 数字槽 **70px** = **226px**，两列相同 | `METRIC_W` / `METRIC_NUM_W` 一对常量，表头与两级行共用 |
| 轨道高 | `8px`（`borderRadius: 99`，`overflow: hidden`） | 所有列、所有层级共用 |
| 底衬 `SpentFill` | `opacity: 0.18`，`0 → 本行之前已消费` | Time = 本步开始前已流逝；Token = 本步之前已花掉 |
| 本行份额 `SliceFill` | 满轨道高，`borderRadius: 2px`，solid 色 | 位置/宽度由调用方给（Run 恒为 `left: 0`） |
| 轨道底色 | `color-mix(in srgb, <tone> 12%, transparent)` | 未消费部分 |
| 色相 | Time `--dsw-alias-trajectory-accent`（`#3b82f6`）／Token `--dsw-alias-chart-tools`（`#a78bfa`） | **唯一的差别** |
| 过渡 | `left .25s ease, width .25s ease` | 两根条同步生长 |

- 反例（已删除）：Step 的 Time 曾用 `top/bottom: 1px` + `radius 99` 的 6px 内缩胶囊，看起来"浮"在轨道里，与 Token 的满高切片不是同一个控件。
- 任何新的指标列都必须用这两个 helper，不允许再写内联的绝对定位条。

### 5.3 圆角（`--dsw-radius-*`）

| Token | 值 |
|---|---|
| `--dsw-radius-xs` | 4px |
| `--dsw-radius-sm` | 8px |
| `--dsw-radius-md` | 12px |
| `--dsw-radius-lg` | 16px |
| `--dsw-radius-xl` | 20px |
| `--dsw-radius-panel` | 28px |

- 小元素（条形/标签）用 `xs`(4) 或 `sm`(8)；卡片/面板用 `md`(12) 或 `lg`(16)。

### 5.4 动效

- 缓动：`cubic-bezier(0.4, 0, 0.2, 1)`（`--ds-ease-in-out`）。
- 时长：快 `0.1s` / 常规 `0.2s` / 慢 `0.3s`。

### 5.5 本插件强制约定

1. **颜色只用上面列出的 `--dsw-alias-*` 语义别名**，不写死十六进制色。
2. **表格/分隔线用 `--dsw-alias-border-l1`**（最淡），保持「表格痕迹淡」。
3. **所有字体不加粗**（正文 400）；数字列用 `font-variant-numeric: tabular-nums` 对齐。
4. **圆角用 `--dsw-radius-*`**。
5. 时间/轨迹强调 = 蓝（`--dsw-alias-trajectory-accent`）；Token/第二指标 = 紫（`--dsw-alias-chart-tools`）。
6. 等宽内容（JSON、时间、seq）用 `var(--ds-font-family-code)`。

## 6. 交互

- **就地展开**：点 run 行 → 展开该 run 的 step 列表；点 step → 选中该 step 并**直接铺开内容面板**（模型/计时/Token/概述/工具参数与结果），不再要求逐层点击；只有「原文」是可选的单层 JSON 开关。
- **分组即整体（F130）**：展开的 run 与它下面的全部 step 处于同一个中性分组容器（`--dsw-alias-card-fill` 底 + 3px `--dsw-alias-chart-system` 灰轨 + 圆角），颜色焦点让给内层 Step 括号；折叠后回到普通行。
- **高亮跟随展开（F128）**：不单独维护"选中某一行"，**展开即高亮、收起即恢复**。
  - 展开的 Run 行：`color-mix(accent 12%, layer-1)` 淡蓝底（F148 起从 8% 提到 12%），**没有自己的环和圆角**——填色由分组的 `overflow: hidden` 按外圆角裁切，边界只有一条，不会出现双层线；
  - 展开的 Step 行：`color-mix(accent 22%)` 底色（无裁剪、无容器底），hover 用同色相 10%（只换底色，无描边），比展开态浅一档；**不再叠 3px 左侧轨**——那条轨与 Run 分组自带的轨重叠在同一像素上，等于没有；
  - 可以同时展开多条 Run / 多条 Step，**每条展开的明细都各自保持高亮**；收起某一条即恢复普通行。
- **选中不改变行高**：只用 `background` / `box-shadow: inset` / `border-radius`，绝不改 border 宽度或 padding，避免破坏 FLIP 动画。
- **排序 + FLIP 动效**：列头就是排序控件——点 `Time` 列按耗时、点 `Token` 列按 token，**三态循环：默认 → 降序 → 升序 → 默认（run0→runN）**；`⇅` 常驻、只点亮当前方向，生效时出现「已按 Time ↓ 排序 ✕」胶囊（F132）。重排行用 FLIP 平滑滑动 —— 实现上先同步写 `translateY(Δ)` + 强制 reflow 让起点生效，再切 CSS transition 归零（不用 `el.animate`，避免重排闪烁）。切换排序保持当前 step 选中（身份按 `run.idx + stepIdx`，与排序位置无关）。
- **hover（F148 加强，只用底色）**：条上悬停显示精确起止/耗时/token；Run 行悬停 = `accent 9%` 底（展开态 12%）+ 箭头变蓝 + 索引文字提亮；Step 行悬停 = `accent 10%` 底（展开态 22%）+ 箭头变蓝 + 标题提亮；**不加任何描边**——1px `inset` 环那版在密集列表里显脏，已否掉；`background` / `color` 带 120ms 过渡，鼠标扫过是"渐亮"而不是"跳色"；列头悬停是**整列** 14% 底 + 底部 1px 80% 线。原本 6% / 8% 的淡色在白底上几乎看不见，等于没有 hover 反馈；标签悬停仍显示完整 prompt / step 摘要。其它候选档位见 `mockup/hover-options.html`（A–G 七版）。
- **异常冒泡**：折叠态也能看到红/橙圆点。
- **键盘可达**：step 行为 `role="button"` + `tabIndex=0`，Enter/Space 切换选中，`aria-expanded` / `aria-pressed` 标注状态。
- **时间轴缩放**（后续）：滚轮缩放时间域、拖拽聚焦区间（对齐内置 Trajectory 的 timing overview）。

## 7. 加载与性能表现（M6）

> 数据契约与实测基线见 `agent.md` §4.7；验收见 `TEST.md` §5（P 系列）。

- **骨架即首屏**：打开视图只拉 `/runs`（约 25 KB；服务端 1–8 ms、解析 0.1–0.2 ms，含 KPI + 全部 run 行），直接渲染，不出现整页「加载中」空屏；KB 级解析避免长任务造成的卡顿感。
- **渐进披露 + 按需拉取**：点 run 行才拉该 run 的 `/run`（中位约 3 KB），展开某操作才拉 `/event` 原文。占位文案是原地小字（「载入 step…」），**已渲染内容不因新请求消失**。
- **缓存**：runs / run 详情 / event 按 `sessionId` 缓存在客户端；切走会话再切回、重复展开同一 run 都零请求。「刷新」清缓存重建，表头计量随之更新。
- **计量字幕**：表头右侧常驻「首屏 42 ms · 25 KB · 服务端 12 ms」，缓存命中显示「缓存命中」。既是性能提示，也是可复核的验收证据（F124）。
- **与轨迹的体感差距来源**：内置轨迹读的是客户端**已加载的会话内存**（无 HTTP 往返）；本插件拿不到该内存，因此用「KB 级首屏 + 按需明细 + 缓存」把往返成本压到与本地读取同量级。
