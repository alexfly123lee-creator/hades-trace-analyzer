# Trace 分析面板插件 — 测试规格（TEST）

> 配套 `../agent.md` 与 `SPEC.md`。用例 ID 对应 SPEC 的 F/NF 编号。测试分三层：纯函数单测、Host 集成测试、UI 手动验收 + UX 评审。执行环境以当前运行安装为准。

## 1. 测试策略

1. **纯函数单测**：把聚合/判定/分组逻辑抽成纯函数（`lib/`），用 Node 内置测试或最小测试框架跑，无外部依赖。
2. **Host 集成测试**：用真实（或合成）会话调用 `sessionQuery`，验证数据桥返回结构正确、边界（空会话/不存在会话）正确。
3. **UI 手动验收**：在已连接的 Web GUI 上人工验证（见 `references/verification.md`），并用一个 subagent 做 UX 评审。

> 若 pwsh 因沙箱 ACL 受限无法跑子进程，改用「纯函数在 Node 内联执行」验证，或先修复 ACL（见 diagnose-windows-sandbox-acl skill），并在交付说明中标注哪些自动化未跑通。

## 2. 纯函数单测

被测函数位于 `lib/aggregate.js`（已实现，签名如下）：

```
buildTraceTree(events) -> runs[{ prompt, isSystemPrompt, steps[{ step, startSeq, endSeq, events[leaf] }] }]
aggregateTokens(events) -> { total:{input,output,cacheRead,cacheWrite,reasoning}, byTurn:[...] }
pairToolCalls(events) -> [{ callId, name, call, result, durationMs, error }]
judgeToolAnomaly(pair, thresholds) -> 'error' | 'duration' | null
normalizeLineage(trace) -> [{ record, depth, role }]
groupTimeline(events) -> turns[{ turn, steps[{ step, events[] }] }]   // 早期平铺版，已不用于 UI
buildRunsPayload(events, opts) -> { payload:{header,meta,counts,tokens,kpi,runs[]}, tree, tokens, tools }   // M6 首屏投影
buildRunDetail(events, idx, opts) -> { payload:{idx,prompt,isSystemPrompt,steps[],tools[],serverMs}, tree }  // M6 单 run 详情
```

| ID | 用例 | 输入 | 期望 |
|---|---|---|---|
| U01 | `buildTraceTree` run/step 分组 | 混合 run/step 事件 | 按 run→step 分组，叶子归到正确 step |
| U02 | `buildTraceTree` 真实用户切分 | 多条 `user/message`（`source.kind==='user'`） | 每条真实用户消息开启新 run；`run.prompt` 正确 |
| U03 | `buildTraceTree` 系统提示词 run0 | 真实用户消息前有 `system/message` 等 | run0 `isSystemPrompt=true`、`prompt=null`；run1 才是第一条真实 prompt |
| U04 | `buildTraceTree` 忽略上下文注入 | 含 `source.kind!=='user'` 的 `user/message`（runtime-context/skill-catalog/time-context） | 不开新 run，归入当前 run 或 run0 |
| U05 | `buildTraceTree` 空输入 | `[]` | 返回 `[]` |
| U06 | `pairToolCalls` 配对 | `tool/call` + 同名 `callId` 的 `tool/result` | `durationMs = result.time - call.time` |
| U07 | `pairToolCalls` 未配对 | 只有 call 无 result | `result: undefined`，不产负数 |
| U08 | `aggregateTokens` 汇总 | 多条 `assistant/message` 含 `usage` | 分项求和正确；缺失字段记 0 |
| U09 | `aggregateTokens` 无 usage | 事件无 `usage` | 不抛错，总量为 0 |
| U10 | `judgeToolAnomaly` 错误 | `pair.error` 非空 | 返回 `error` |
| U11 | `judgeToolAnomaly` 时长 | `durationMs > toolDurationMs` | 返回 `duration` |
| U12 | `judgeToolAnomaly` 正常 | `durationMs <= toolDurationMs` | 返回 `null` |
| U13 | `normalizeLineage` | `traceSession` 结果 | 扁平化 roles/depth 正确，去重 |
| U14 | 空输入 | `[]` | 各函数返回空结构，不抛错 |
| U15 | `buildRunsPayload` 体积 | 真实/合成大会话 | 序列化 ≤ 64 KB；不含 `events` 字段 |
| U16 | `buildRunsPayload` 数字 | 与 `buildTraceTree+aggregateTokens+pairToolCalls` 比对 | runs/steps/events/tokens/errors/slow/abnormal/slowest 全相等 |
| U17 | `buildRunDetail` 结构 | 指定 idx | steps 与 tree 一致；tools 配对含 durationMs/error；不含事件 `data` |
| U18 | `buildRunDetail` 越界 | idx 超出范围 | 返回 `null`，不抛错 |
| U19 | `buildTraceTree` 文本 | 消息类事件（system/developer/assistant） | 叶子带 `text`（空白折叠、≤400 字符 + `…`）；tool/result 无 `text`；真实 user/message 不作为叶子 |
| U20 | `buildRunDetail` step 摘要 | 含 assistant 文本 / 纯工具 / 无文本的 step | `steps[].text` 优先级正确；单工具为 `tool · <名> · <参数预览>`；无内容为 `null`；`timeMs` 正确；**step 不再携带 `events[]`/`tools[]`** |
| U21 | `buildStepContent` 有序清单 | 文本 step / 工具 step / 注入 step / 越界 | `operations[]` 按事件顺序；`counts{models,tools,contexts}` 正确；工具 result 折叠进 call 行；`assistant`/`tool` 字段齐全；越界返回 `null` |
| U22 | 树叶子补字段 | `assistant` / `tool/call` / `tool/result` / `request/header` | `usage` 分项、`toolName`/`argsText`、`resultText`/`isError`、`provider`/`model` 均存在；叶子带 `actor` |
| U23 | 角色投影（F131） | 五类 kind + run/step 落位 | `actorOf`：真实 user→`user`、注入与 developer→`context`、system→`system`、assistant/`request/*`→`assistant`、tool→`tool`；run0=`system`、其余 run=`user`；**`/run` 的 step 不带 `actor`**；`operations` 的 kind 与来源一致 |

## 3. Host 集成测试

前置：能访问 `sessionQuery`（Host 侧）。

| ID | 用例 | 步骤 | 期望 |
|---|---|---|---|
| I01 | 数据桥读取 | 桥接方法传当前 `sessionId` 调 `listEvents` | 返回 `SessionEventRecord[]`，`seq` 升序，字段齐全 |
| I02 | 事件详情 | `readEvent({sessionId, seq})` | 返回 `SessionEventWindow`，`target.seq === seq` |
| I03 | 血缘 | `traceSession(sessionId)` | 返回 `SessionLineageTrace`，含 target，后代树结构合法 |
| I04 | 事件溯源 | `traceEvent({sessionId, seq})` | 返回替换链/来源字段（可为空数组） |
| I05 | 过滤 | `filterEvents(sessionId, [{kind:'type',...}])` | 只返回该类型事件，按 `seq` 升序 |
| I06 | 空会话 | 新建空会话 sessionId | 各方法返回空/无异常，不 throw |
| I07 | 不存在会话 | 随机非法 sessionId | 返回明确错误（走 §F13 错误态），不崩溃 |
| I08 | 只读校验 | 桥接调用前后 `readSession` 事件数 | 事件数不变（桥不产生副作用） |

## 4. UI 手动验收（在已连接页面）

按 `references/verification.md` 执行，逐条对照 SPEC。

| ID | 场景 | 步骤 | 期望（对应 SPEC） |
|---|---|---|---|
| V01 | Tab 出现 | 打开任一会话，看主对话区视图环 | 视图环出现「Hades Lab」Tab，紧邻内置「轨迹」（F01） |
| V02 | 打开 Tab | 点「Hades Lab」Tab | 打开分析视图，标题走 locale（zh/en「Hades Lab」）（F01/F03） |
| V03 | 切换会话 | 切到另一会话再回 | Tab 内容跟随、无残留（F02） |
| V04 | 空态 | 新建空白会话进 Tab | 空态文案，不报错（F04） |
| V05 | KPI 卡片 | 打开 Hades Lab 视图 | 顶部大卡片统计正确（run/step/事件/Token/错误/慢/异常/最慢）（F21） |
| V40 | Hover 与展开态同色相 | 鼠标划过未展开的 Run 行、括号内的 Step 行、表头列头 | 三处都出现淡蓝底（Run 6% / Step 6% / 列头**整列** 8% + 底部 1px 55% 线），颜色比展开态（8% / 22%）更浅；移开后立即恢复（F128/F132） |
| V06 | run 表排序 | 点表头「Time / Token」 | 即时重排 + FLIP 动效；列头是**整列热区**（220px / 152px，不是标签那 64px）；再点同列 → 降序 → 升序 → 取消回自然序；Time 列与 Token 列在 Run/Step 行严格同列（F22/F132） |
| V41 | 列头可点击暗示 | 不点任何东西先看表头 | `⇅` 双箭头常驻（未排序 35% 灰）；激活列只点亮一个方向（↓ 100% / ↑ 22%），并转为列主色；标签**左边缘与下方柱子左边缘齐平**（压在柱子上，不压数字）；悬停底色/下划线只覆盖柱槽（F132） |
| V42 | 排序三态 + 状态胶囊 | 连点 Time 列三次 | 降序 → 升序 → 取消（回 run0→runN）；排序生效时列右侧出现「已按 Time ↓ 排序 ✕」，点 ✕ 或第三次点击都回到自然序；胶囊不挡住列头（F132） |
| V43 | 键盘与语义 | Tab 到列头；读屏/检查 DOM | 聚焦即出现与 hover 相同的底色 + 下划线；`aria-sort` 为 `descending` / `ascending` / `none`；title 提示下一击的行为（F132） |
| V07 | 就地展开 | 点某 run 行 | 该行下方就地展开该 run 的 step 列表（F23） |
| V08 | Step 内容直出 | 点开某 step | 直接看到模型/计时/Token/概述/工具参数/结果，无需再点一层；报错工具整块红色；「原文」按需展开（F129） |
| V23 | Step 行信息 | 展开任一 run | 每个 step 行：`step N` 与 `run N` 左边缘对齐；**条内数值位置/字号/颜色与 turn 条一致**，另一维度在条后常驻；标题是「动词 + 对象」（F23.1） |
| V44 | Step 标题规则 | 展开任一 run，逐行看标题 | 纯工具行读作 `读取 client.js:226` / `修改 DESIGN.md` / `搜 「…」` / `运行 · <描述>` / `交付 x.html`，不再出现 `tool · 名字 · 绝对路径`；有文本的行取首句（≤42 字、括号不切半），动作另由 chip 承载（多动作见 V51/F137） |
| V45 | 无文本 step 不再空白 | 找到耗时异常/看起来没内容的 step | 压缩 → `压缩 12.5k tok`；重试失败 → `失败 RATE_LIMIT` + warn 标记 `重试 2/5`；空模型回复 → `空回复`；只有注入 → `仅注入上下文`；真·无事件才显示 `—`（F23.1） |
| V46 | 状态标记 | 划过带标记的行；看颜色 | 标记最多 2 个、与标题重复时省略；`失败` error 色 / `重试` warn 色 / `文件变更`·`命令` 等 muted；标记不参与省略号截断（标题先省略）（F23.1） |
| V50 | 标签体系统一 | 同时看 Turn 行与 Step 行的标签 | 两级标签高度/字号/圆角/内边距/字重一致（19px / 10px / 650 / 0 5px）；都在指标条之后、正文之前；Turn=角色（`USER`/`SYSTEM`），Step=动作（`READ`/`EDIT`/`REPLY`/`FAIL`…），**标签一律英文大写**、中文在 tooltip；配色同源（工具类=warn、回复=assistant、失败=error、系统=system、注入=success）（F136） |
| V49 | Step 行标签式命名 | 展开任一 run 逐个看 step 行 | 每行开头是**一枚动作标签**（单项动作）/ **多枚动作标签**（多种动作，F137）——`读取/修改/运行/回复/压缩/失败…`，后面才是对象；兜底词不重复（`[运行] …` 而不是 `[运行] 运行命令`）；`失败` 红、`重试/压缩` 橙、`交付/回复` 品牌色；标签宽度不随对象变化（F135） |
| V51 | 多动作 step 的 chip 行 | 找一步干了两种事的（先读代码再跑命令、先 inspect 再读取），以及「改了 6 个文件」的一步 | 前者行上并排两枚 chip（`INSPECT ×2 READ`、`EDIT RUN`）；后者只一枚 `EDIT ×6`，不再出现 `+5 次调用` 文字后缀；回复类行是 `REPLY` + 它调用的动作 chip；chip 一律英文大写、中文在 tooltip；chip 行不参与标题省略、不改变行高与 Time/Token 列位置；`node mockup/verify-chips.mjs <session>` 报告 0 问题（F137） |
| V48 | step 耗时含工具、不含等人 | 找一个跑了几分钟工具的 step；再找一个等你回答/审批的 step | 前者行上显示 模型+工具 的合计（工具时间算进去）；后者行上只显示模型的几十秒，旁边有 `⏸ 13.1min` 等待标记；`run.time = Σ 各步`；`mockup/verify-traj-align.mjs` 校验模型段 0 差异、工具段差额 = waitMs（F133） |
| V47 | 标题可回原文 | hover 任一 step 标题 | tooltip 显示原始长摘要（正文全段 / `tool · 名字 · 参数`），压缩不丢信息；展开后详情面板按事件顺序出现说明行 `[压缩]`/`[命令]`/`[审批]`（F23.2） |
| V24 | Run/Step 共同选中 | 点一个 step，再点另一 run 的 step；再点同一 step；折叠该 run | 选中 step 与其 run 分组出现同色轨道/加深底色；选中转移且旧选中消失；再次点击取消并收起；折叠 run 后选中清除（F128） |
| V25 | 展开不改布局 | 展开某 step 后切换「按时间/按 Token」 | 展开状态与高亮保持、行高不跳、FLIP 平滑（F128） |
| V35 | 展开的 Step 保持高亮 | 展开某个 step | 该 step 行保持蓝底（16%）+ 1px 60% 蓝环，面板描边同色 45%；再点一次收起 → 行立即恢复普通态（F128） |
| V36 | 展开的 Run 保持高亮 | 展开一个 run（不点 step）；再展开另一个 run；随后收起第一个 | 每条展开的 run 行都保持 8% 淡蓝底 + 1px 35% 环；收起的那条立即恢复普通行；同时展开 step 时 Run 与 Step 各自保持高亮（F128） |
| V26 | 分组整体性 | 展开 run，观察 run 行与 step 区 | run 行与其全部 step 处于同一淡蓝底 + 连续 3px 左轨 + 圆角，视觉上是一个整体；折叠后恢复普通行（F130） |
| V27 | 长 step 面板 | 打开一个含很多工具的 step | 面板按顺序列出全部工具参数/结果，区域可滚动，不影响其它行（F129） |
| V28 | Step 内容按需 | 打开 step 时看网络 | 仅新增一次 `/step` 请求；重复打开同一 step 命中缓存不再请求（F120/F123） |
| V29 | Step 空/异常 | 打开无内容 step；断开 Host 后打开 | 空态显示「该 step 无内容」；失败显示可读错误 + 重试（F129） |
| V30 | 角色标签（对齐轨迹） | 展开 run + 点开 step | Run 行指标条后出现「用户」（run0 为「系统」）标签，样式与轨迹 kindTag 一致（19px 高 / 10px / 650）；**Step 行没有角色标签**；容器内每行按 `[用户] 指令` / `[助手] 模型调用` / `[工具] tool · …` / `[上下文] 注入` 标注，颜色与轨迹一致（F131） |
| V31 | Step 括号 | 点开任一步 | Step 行与它下面的明细落在同一个括号里（缩进 3px 蓝轨 + 1px 38% 描边 + 圆角，**括号样式与之前一致**），但**没有底色**；只有 Step 行本身有 22% 填色，明细再缩进 74px，顶部一行构成概览（F129） |
| V37 | 层级缩进 | 观察 run 行、step 行、step 明细 | 三层的左边缘依次为 0 / 16px / 16+74px；括号轨道不与 Run 分组轨道重叠；收起/展开 step 时该行不左右跳（F129/F130） |
| V32 | 痕迹清单顺序 | 点开一个含模型+多个工具+注入的 step | 行按事件顺序排列（用户指令→模型调用→工具…→上下文），工具结果折叠在工具行内；报错行红色；「原文」默认收起（F129） |
| V33 | 无分隔线 | 展开 run、点开 step | Run 行与 Step 行之间、Step 行之间、step 内部活动行之间**都没有线**，只有留白；结构由括号 + 缩进 + 色带表达 | 每条活动行之间有清晰可见的 1px 分隔线（`--dsw-alias-border-l2`），明/暗主题下都可见，且不抢主内容（F129） |
| V34 | 括号无底色 | 展开 run 并点开 step | Run / Step 括号的描边、蓝轨、圆角与之前完全一致；只是两层都**没有 box 底色**，只有展开的 Run 行（8%）和 Step 行（22%）有填色（F129/F130/F131） | |
| V10 | 异常高亮 | 制造失败/慢工具调用 | 错误/超阈值事件高亮 + 汇总过滤（F60–F63） |
| V11 | 搜索过滤 | 输入关键词/选类型 | 命中过滤、可清除（F80–F82） |
| V12 | 导出 | 导出单事件 + 整段 | 内容合法、序正确（F90–F92） |
| V13 | 实时 | 运行中观察 | 新事件实时追加，无重复（F11） |
| V14 | 手动刷新 | 点刷新 | 快照重建，与增量不重复（F12） |
| V15 | 主题 | 切明/暗 | 对比度正常，无写死色（F100） |
| V16 | 本地化 | 切宿主语言 | 文案切换（F101） |
| V17 | 无崩溃 | 控制台 | 无 `slot entry crashed`（NF2） |
| V18 | 大会话 | 5000+ 事件 | 滚动流畅（F24/NF4） |
| V19 | 首屏计量 | 打开 Hades Lab | 表头显示「首屏 xx ms · xx KB · 服务端 xx ms」，KPI + run 表即时出现（F124） |
| V20 | 按 run 懒加载 | 点某 run 行 | step 列表在 200 ms 内出现；该次只新增一条 `/run` 请求（F120） |
| V21 | 缓存命中 | 切到别的会话再切回 | 表头显示「缓存命中」，无新的 `/runs` 请求；点刷新后重新请求（F123） |
| V22 | 原文按需 | 点某 step 内的「原文」 | 此时才出现 `/event` 请求；JSON 完整可读（F121/NF6） |

## 5. 性能验收（P 系列，M6/M8 阶段化加载）

> 对应 SPEC §15 F120–F127、§16 F129。两层证据：
> 1. **离线**：`node mockup/verify-perf.mjs "<session.v4.jsonl.zstd 路径>"` —— 用真实会话日志跑与 Host 路由**同一份** `lib/aggregate.js` 代码路径，输出实测值并断言。
> 2. **在线**：`GET /api/trace-analyzer/bench?sessionId=latest`（仅 loopback，返回体积/耗时/计数，不含会话内容）——在运行中的 Host 上量真实路由耗时。

| ID | 用例 | 方法 | 门槛（实测 → 目标） |
|---|---|---|---|
| P01 | 首屏 payload 体积 | `JSON.stringify(buildRunsPayload(events).payload)` 字节数 | ≤ 64 KB（基线 27.5 MB → 实测 ~31 KB） |
| P02 | 首屏 Host 生成耗时 | 同一函数执行时间（中位/最大） | ≤ 50 ms（实测 3–18 ms） |
| P03 | 首屏客户端解析+建模 | 对 P01 的 JSON 文本 `JSON.parse` 并建行模型 | ≤ 10 ms（实测 0.1–0.2 ms） |
| P04 | run 步索引体积 | 全部 run 的 `buildRunDetail` 序列化体积，取 p50 / p90 / max | p50 ≤ 4 KB（1.8）、p90 ≤ 16 KB（6.5）、max ≤ 128 KB（39.8） |
| P05 | stream 裁剪 | P01/P04/P11 文本中 `"stream"` 出现次数 | = 0 |
| P06 | 数字一致性 | 与 `buildTraceTree + aggregateTokens + pairToolCalls` 全量基线逐字段比对（run/step/事件/token 分项/错误/慢/异常/最慢） | 全相等 |
| P07 | 事件原文按需 | `/event` 等价窗口（`readEvent` 目标事件）序列化体积 | ≤ 64 KB（实测 9.7 KB） |
| P08 | 单测回归 | `node --test dsh-trace-analyzer/test/aggregate.test.js` | 全通过（29 项） |
| P09 | 产物含新代码 | `/health` 的 `hostRev` + 服务端返回的 `client.js` grep `StepContent`/`MetricBar`/`stepSelBg` 标记 | 命中，且 `hostRev` 为当前版本 |
| P10 | live 内存路径耗时 | `/bench`（或等价内联）对比 `inspectSession` 与 `readSession` | `/runs` 服务端 ≤ 50 ms（实测 ~20–37 ms，对照 1000–1600 ms） |
| P11 | Step 内容体积 | 全部 step 的 `buildStepContent` 序列化体积，取 p50 / p95 / max | p50 ≤ 2 KB（1.2）、p95 ≤ 8 KB（2.2）、max ≤ 16 KB（7.5） |

补充观察（打印，不计入门槛）：连续展开 5 个 run 的服务端总耗时（F126）与「缓存命中」重投影耗时。

## 6. UX 评审

- 用 **1 个 subagent** 做 UI/UX 专家评审（`references/verification.md` 要求），提供：用户目标、插件位置（主对话区视图环「Hades Lab」）、可用运行态证据。
- 评审维度：可发现性（入口是否易找）、主流程（打开→执行树→详情→过滤→导出）、反馈（加载/错误/空态）、视觉一致性（与宿主组件观感、主题 token）。
- 记录评审结论，修复被证实的缺陷后复验。

## 7. 缺陷记录与复验

- 所有未通过用例记录到缺陷列表（用例 ID、现象、证据、修复提交）。
- 修复后重跑对应用例并标注通过。

## 8. 交付门槛（Done 定义）

- U01–U23、I01–I08 全部通过（自动化或等价内联验证）。
- P01–P11 全部通过（`mockup/verify-perf.mjs` 离线 + `/bench` 在线实测）。
- V01–V29 在连接页面通过，或明确标注无法验证项及原因。
- UX 评审完成，实质性问题已修复。
- 主题 token、locale、图标、详情页元数据校验通过（`references/host-plugin.md`）。
- 无 `slot entry crashed`、无未清理的资源。
