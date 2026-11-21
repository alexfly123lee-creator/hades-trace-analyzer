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
| V01 | Tab 出现 | 打开任一会话，看主对话区视图环 | 视图环出现「Trace Lab」Tab，紧邻内置「轨迹」（F01） |
| V02 | 打开 Tab | 点「Trace Lab」Tab | 打开分析视图，标题走 locale（zh/en「Trace Lab」）（F01/F03） |
| V03 | 切换会话 | 切到另一会话再回 | Tab 内容跟随、无残留（F02） |
| V04 | 空态 | 新建空白会话进 Tab | 空态文案，不报错（F04） |
| V05 | KPI 卡片 | 打开 Trace Lab 视图 | 顶部大卡片统计正确（run/step/事件/Token/错误/慢/异常/最慢）（F21） |
| V40 | Hover 与展开态同色相 | 鼠标划过未展开的 Run 行、括号内的 Step 行、表头列头 | 三处都出现淡蓝底（Run 6% / Step 6% / 列头**整列** 8% + 底部 1px 55% 线），颜色比展开态（8% / 22%）更浅；移开后立即恢复（F128/F132） |
| V06 | run 表排序 | 点表头「Time / Token」 | 即时重排 + FLIP 动效；列头是**整列热区**（246px / 168px，不是标签那 64px）；再点同列 → 降序 → 升序 → 取消回自然序；Time 列与 Token 列在 Run/Step 行严格同列（F22/F132） |
| V41 | 列头可点击暗示 | 不点任何东西先看表头 | `⇅` 双箭头常驻（未排序 35% 灰）；激活列只点亮一个方向（↓ 100% / ↑ 22%），并转为列主色；标签**左边缘与下方柱子左边缘齐平**（压在柱子上，不压数字）；悬停底色/下划线只覆盖柱槽（F132） |
| V42 | 排序三态 + 状态胶囊 | 连点 Time 列三次 | 降序 → 升序 → 取消（回 run0→runN）；排序生效时列右侧出现「已按 Time ↓ 排序 ✕」，点 ✕ 或第三次点击都回到自然序；胶囊不挡住列头（F132） |
| V43 | 键盘与语义 | Tab 到列头；读屏/检查 DOM | 聚焦即出现与 hover 相同的底色 + 下划线；`aria-sort` 为 `descending` / `ascending` / `none`；title 提示下一击的行为（F132） |
| V07 | 就地展开 | 点某 run 行 | 该行下方就地展开该 run 的 step 列表（F23） |
| V08 | Step 内容直出 | 点开某 step | 直接看到模型/计时/Token/概述/工具参数/结果，无需再点一层；报错工具整块红色；「原文」按需展开（F129） |
| V23 | Step 行信息 | 展开任一 run | 每个 step 行：`step N` 与 `run N` 左边缘对齐；**条内数值位置/字号/颜色与 turn 条一致**，另一维度在条后常驻；标题是「动词 + 对象」（F23.1） |
| V44 | Step 标题规则 | 展开任一 run，逐行看标题 | 纯工具行读作 `读取 client.js:226` / `修改 DESIGN.md` / `搜 「…」` / `运行 · <描述>` / `交付 x.html`，不再出现 `tool · 名字 · 绝对路径`；有文本的行取首句（≤42 字、括号不切半），动作另由 chip 承载（多动作见 V51/F137） |
| V45 | 无文本 step 不再空白 | 找到耗时异常/看起来没内容的 step | 压缩 → `压缩 12.5k tok`；重试失败 → `失败 RATE_LIMIT` + warn 标记 `重试 2/5`；空模型回复 → `空回复`；只有注入 → `仅注入上下文`；真·无事件才显示 `—`（F23.1） |
| V46 | 状态标记 | 划过带标记的行；看颜色 | 标记最多 2 个、与标题重复时省略；`失败` error 色 / `重试` warn 色 / `文件变更`·`命令` 等 muted；标记不参与省略号截断（标题先省略）（F23.1） |
| V50 | 标签体系统一 | 同时看 Turn 行与 Step 行的标签 | 两级标签高度/字号/圆角/内边距/字重一致（20px / 11px / 650 / 0 5px）；都在指标条之后、正文之前；Turn=角色（`USER`/`SYSTEM`），Step=动作（`READ`/`EDIT`/`REPLY`/`FAIL`…），**标签一律英文大写**、中文在 tooltip；配色同源（工具类=warn、回复=assistant、失败=error、系统=system、注入=success）（F136） |
| V49 | Step 行标签式命名 | 展开任一 run 逐个看 step 行 | 每行开头是**一枚动作标签**（单项动作）/ **多枚动作标签**（多种动作，F137）——`读取/修改/运行/回复/压缩/失败…`，后面才是对象；兜底词不重复（`[运行] …` 而不是 `[运行] 运行命令`）；`失败` 红、`重试/压缩` 橙、`交付/回复` 品牌色；标签宽度不随对象变化（F135） |
| V51 | 多动作 step 的 chip 行 | 找一步干了两种事的（先读代码再跑命令、先 inspect 再读取），以及「改了 6 个文件」的一步 | 前者行上并排两枚 chip（`INSPECT ×2 READ`、`EDIT RUN`）；后者只一枚 `EDIT ×6`，不再出现 `+5 次调用` 文字后缀；回复类行是 `REPLY` + 它调用的动作 chip；chip 一律英文大写、中文在 tooltip；chip 行不参与标题省略、不改变行高与 Time/Token 列位置；`node mockup/verify-chips.mjs <session>` 报告 0 问题（F137） |
| V52 | 性能加固与自证（F138） | 打开一个 200+ 步的 run；反复切会话；观察表头 | 该 run 默认只渲染 80 行，末尾出现「显示全部 N 步（还有 M 步）」；切走瞬间在途 /runs 被 abort（DevTools Network 显示 canceled）；表头在构建 ≥8 ms 时出现「渲染 x ms」；/health 返回 cache.events / lastBuild.ms 且 sessions ≤ 4；闲置时进程 CPU ≈0（无轮询） |
| V53 | 可读性基线（F139） | 随便打开一个会话看整页 | 正文 13px、行高 1.6、行最小高 30px；Time 条 170px / Token 条 112px，表头标签仍与柱子左缘齐平；`▸ step 199`、`99.99s`、`126k`、`EDIT ×6` 都不溢出、不换行；标签 chip 20px 高、11px 字，与指标条基线对齐；整页没有 10px 文字 |
| V54 | 实时跟随（F140） | 面板开着，去对话里发一条指令（或等 agent 自己继续跑），再切回面板；然后切到别的窗口 5 秒再回来 | 面板 ≤2 s 出现新的 run/step 行；流式中 step 时间持续增长，工具结果到达后该行自动补上耗时（不用收起重开）；表头常驻 `● 实时`，切走窗口后变 `⏸ 已暂停` 且 `/health.cache.unchangedHits` 停止增长，切回后立即补一次；刷新不丢展开态/排序/高亮；DevTools 里未变化的 tick 响应 ~40 B |
| V55 | 更新像"长出来"而不是整页重刷（F141） | 面板开着不动 30 秒（空闲）；然后让新事件进来，盯住列表与打开着的 step 面板 | 空闲期间 React DevTools **无 commit**、Performance 无新的 paint；有新事件时只有新增行/变化的数值在变，其余行不重建、列表不整体位移；打开着的 step 面板**不闪「载入 step 内容…」**、不塌回空态，工具行原地从"无结果"变成"有耗时"；柱子宽度是过渡过去的（约 250 ms）而不是瞬移；切排序时仍有 FLIP 动画 |
| V56 | Step 的 token 时序切片（F142） | 展开一个多步 run，逐行看 Token 列 | 每行 step 的 token 轨道**整条 = 该 run 的总消耗**；深色块是这一步自己的份额，**左边缘 = 前面所有 step 的累计占比**，宽度 ∝ 本步 token；最后一步的块右边缘正好到 100%；淡色 = 之前已花、背景 = 剩余；tooltip 显示 	ok · x% of run · 累计 y (z%)；右侧数字仍是本步 token |
| V57 | 展开/折叠动效（F144） | 连点一个 run 行的展开/收起；再展开一个 200+ 步的 run；系统开「减少动态效果」再试 | 展开 160ms 高度+淡入、折叠 120ms；首次展开是立即出现 + 内容到达后 120ms 跟随长高；箭头同一字符旋转 90°，索引列不抖；快速连点不叠加、不错位；200+ 步的 run 是一整块淡入（不缓慢长高）；减少动态效果时瞬时切换；折叠后子节点已从 DOM 移除 |
| V58 | 时间条与 Token 条只差颜色（F145） | 展开一个多步 run，把同一行的时间条与 token 条并排比对（含 run 行、含最后一个 step） | 两根条**高度一致（8px 满轨道）、圆角一致（2px）、底衬一致（18%）**，唯一区别是色相（蓝 / 紫）；形状上不再一根内缩成胶囊、另一根满高；时间条左侧淡色 = 本步开始前已流逝、token 条左侧淡色 = 本步之前已花掉，两者结构相同；Run 行两根条同为 `left:0` 的纯条（无底衬）且一致；实时刷新或切排序时两根条一起用 `.25s ease` 生长；对照图 `mockup/bar-align.png` |
| V59 | 时间列与 Token 列等宽（F146） | 看表头两列的宽度、再看两列数字的右边缘 | `Time` 与 `Token` 两列**总宽相同（各 226px = 150 轨道 + 6 间隙 + 70 数字槽）**，两个表头按钮等宽、标签仍压在各自柱子左缘上；两列数字右对齐在同一条竖线上；Token 轨由 112px 加宽到 150px（累计切片更长）；`35.55s` / `99.99s` / `345k` 在 70px 槽内不溢出；RUN 行与 Step 行的列左缘仍严格对齐；`check-served` 52/52 |
| V60 | run prompt 到宽度才截断（F147） | 找一条长指令（>80 字）的 run，横向拉宽/收窄面板；再 hover 这一行；再点开它第 1 步看「指令」块 | 同一 prompt 在窄/中/宽窗口里显示长度递增（不再固定在 80 字处断），超出部分由省略号收尾；hover 显示原始全文（含换行）；点开 step 1 的「指令」块是**全文**（超出 96px 高度时内部滚动），不再是 400 字截断；`check-served` 55/55（含 `truncate(r.prompt` / `function truncate` 两条 absent 断言） |
| V61 | hover 反馈看得出来（F148，只用底色） | 浅色主题下鼠标扫过 run 行、step 行、列头；再对比同一行的 hover 与展开态 | run 行悬停 = 淡蓝底 9%（比展开 12% 浅）+ 箭头 `▸` 变蓝 + 索引文字提亮；step 行悬停 = 10% 底 + 箭头变蓝 + 标题提亮；列头悬停整列 14% 底 + 80% 底线；**整行没有任何描边**（1px 内环方案已否掉）；过渡 120ms 渐亮；快速扫过多行无布局跳动（只改 background/color）；`check-served` 57/57（含 `hoverRing` absent 断言）；候选档位见 `mockup/hover-options-1.png` / `hover-options-2.png` |
| V62 | 深色模式的 hover 看得见（F149） | 切到深色主题，鼠标扫过 run 行 / step 行 / 列头；再切回浅色对比；再点开一行看 hover 与展开的深浅 | 深色下 hover = accent 22%（run）/ 26%（step），明显比常态蓝；展开态 30% / 36% 仍比 hover 深；列头 26% 底 + 90% 线；切主题**不用刷新**面板立即换色；浅色仍是 9 / 10 / 12 / 22 不变；`check-served` 60/60 |
| V63 | 顶部透视卡：一眼看到问题在哪（F150） | 打开面板看顶部卡片；悬停矩阵里几个不同的列；点其中一格；再对照下方 run 表 | KPI 压成一行（不再 8 张大卡）；矩阵 4 行 × 每个 run 一列，深色列 = 又慢又贵又多步；悬停任列四行同时出现十字线并在右侧读到该 run 的 `时间 · token · 步数 · 错误/慢`；点格子后该 run 被**打开并定位**（已展开的不会被收起）；异常行红/橙点与下方 run 行的状态点一致；`最慢操作` 显示的是真实工具（如 `pwsh 2.0min`），**不会**再出现 `ask_user_question`；`check-served` 63/63、单测 43/43、`verify-perf` 9/9 |
| V64 | 顶部模块：吸顶 / 对齐 / 丝滑定位（F151） | 面板里向下滚到很后面的 run；悬停矩阵某一列；点另一格；看顶部还有没有运维条；扫一眼图例与文字 | 矩阵卡**吸顶**、KPI 模块滚走；悬停的十字线**左右边界压在单元边框上**（不从单元中心切过）；点格子后行**平滑下滑**到视口约 1/3 处（连点不叠加、已展开的 run 不被收起）；顶部**没有**缓存命中/服务端/首屏/渲染/实时徽标/刷新按钮；图例是**色块 + 渐变条**、没有"蓝 = 耗时"这类文字；所有 `Run` / `Step` 首字母大写（`Run 42` / `Step 7` / `异常 Run` / `载入 Step 内容…`）；`check-served` 68/68 |
| V65 | 吸顶真能用 + 十字线不出梯形（F152） | 滚动对话页（不是滚面板内部）把列表拉很远；悬停几个不同位置的列；再滚到列表最底；看异常行和图例 | 矩阵卡在任何滚动方式下都**钉在可视区顶部**（不跟随页面滚走），到列表末尾时停在底部不越界；十字线是**两条 1px 竖线 + 一层淡底**，窄列也不出现梯形/楔形；4 行标签颜色一致（中性灰）；图例是**色块 + 文字**；异常行红/橙**半透明**、不刺眼；`check-served` 72/72 |
| V66 | 数字与矩阵一起吸顶（F153） | 滚动对话页把列表拉远；再点矩阵里靠下的格子 | **KPI 数字与热力矩阵一起**停在面板顶部（两者都不随页面滚动），两块之间不透明、不透出后面的行；点格子后定位到的 Run 完整可见（不被吸顶块盖住）；`check-served` 73/73 |
| V67 | 吸顶在真实（shadow）宿主里生效（F154） | 打开面板，用滚轮把 run 列表滚很远；再滚回顶部；反复来回 | KPI + 矩阵**始终贴在面板顶部**（不跟随任何滚动），滚轮连续滚动时跟手无滞后；滚到列表底部时块停在底部不越界；打开 DevTools 在 `document` 上加 scroll 计数会看到 **0**（证明滚动事件不过 shadow 边界，也证明修法不依赖它）；`check-served` 76/76 |
| V68 | 结构性固定 + 矩阵可选可定位（F155） | 把 Run 列表滚到底再滚回顶；点矩阵里不同位置的列（含最右一列）；点完看该列是否还亮着 | KPI + 矩阵在面板顶部**一动不动**（它们在滚动容器之外，不是"钉"出来的）；页面不再被面板撑长而整体滚动；点任意列后该列**持续高亮**，列表平滑滚到对应 Run 且行完整可见（不被表头挡）；`check-served` 76/76 |
| V69 | 点击矩阵不卡顿（F156） | 在矩阵上换着点几列（含已展开的与未展开的 Run），边点边看列表 | 点下去**先看到该列立刻亮起**，随后列表才平滑滑过去（不与展开动画抢帧）；同一列连点不叠加、不闪；滚到位后行完整可见；`check-served` 76/76 |
| V70 | 滚到底不带走页面 + 矩阵选中态（F157） | 列表滚到最底后继续滚轮/触控板；再往回滚；然后在矩阵上悬停、再点击一列 | 滚到底继续滚**页面不动**、表头始终在顶部；往回滚立刻作用在列表；悬停某列有明显高亮（20% 底 + 1px 边）；点击后该列变 30% + 2px 并保持，图例旁出现 `Run N ✕` 胶囊，点 ✕ 取消后高亮清除；`check-served` 79/79 |
| V71 | 整体滚动/交互不卡（F158） | 打开 DevTools 的 React Profiler；① 鼠标快速扫过 175 行 ② 展开一个 80 步的 run 再折叠 ③ 空闲 30s ④ 一边滚轮滚动一边等实时更新 | ① 扫描时**无列表重渲染**（hover 是 CSS）；② 折叠后不再构建该 run 的 step 列表（Profiler 里 renderDetail 只在 open 时出现）；③ 空闲 tick **零 commit**（可见签名未变）；④ 滚动期间的更新延后到停手后 240ms 生效，滚动不掉帧；`check-served` 83/83 |
| V72 | Step 明细卡：统计条 + 时间轴（F159） | 展开一个含 2 条以上注入的 step；点 `CTX 注入 ×N`；点工具卡的 `原文` | 顶部一行统计（模型/工具/上下文 · 计时 · in/out/cache）；下面是竖轴 + 按类型着色的圆点；**注入默认折叠成一行**，点开后正文在卡片内展开；工具卡 args/result 单行省略、hover 有全文；`原文` 在原卡片内展开 JSON；`check-served` 87/87 |
| V73 | 图例无多余元素（F160） | 看矩阵卡底部图例；hover `Time` / `Token` / `步数` | 图例只有五个色块 + 文字（Time、Token、步数、有错误、有慢操作），**没有低→高渐变条**；hover 三个指标色块分别提示"颜色越深 = 该 Run 的该项在会话里的排位越高"；`check-served` 90/90 |
| V74 | 点矩阵后选中行贴顶（F161） | 点矩阵中部与**最后几个**列；观察目标 Run 停在哪里 | 选中列高亮，列表平滑滚动后目标 Run 的**行顶贴着列表顶部**（间距 ≈ 2px），**包括原本在底部的 Run**（因为有尾部留白）；表头始终不动；`check-served` 92/92 |
| V75 | 点击不再整表重建、不再等 200ms（F162） | 打开 React DevTools 的"高亮更新"；点矩阵的不同列（含第一次点某个 Run） | 点击后目标列立刻高亮、列表**立刻**开始滚动（首次点未加载的 Run 最多等一次 `/run` 请求，不会固定等 200ms）；只有被点的那一行闪烁，其余 174 行不动；`check-served` 92/92 |
| V76 | 展开/收起只有一个动画（F163） | 点开（然后收起）几个不同的 Run，其中至少一个是从未展开过的；用 DevTools Performance 录一段 | 面板从 0 **一次性**长到最终高度，没有"展开→跳一下→再展开"，也没有占位行先出现再被真内容顶开；收起同样是一次到底；一次展开只产生**一个**高度动画（旧实现是 3 个）；`check-served` 99/99 |
| V77 | 图例在右上角 + Run 数量滑块（F164） | 看矩阵卡顶部；拖动滑块从「全部」到「最近 12 个」；再点「全部」；在窗口内点一列 | 图例在卡片**右上角**、读数与选中胶囊在其左侧；拖动滑块列数实时变化并标注 `latest N / 175 runs`，点 `all` 恢复；窗口内选中的 Run 高亮不跳位，点击仍正确定位；`check-served` 103/103 |
| V78 | 全英文 + 工业化滑块（F165） | 通读整个面板（视图标签、KPI、矩阵、图例、排序、Step 明细、空态）；再操作滑块（悬停、拖动、键盘方向键） | 所有产品文案为英文（trace 数据里的提示词/事件原文除外）；滑块是自绘轨道 + 圆点拇指，hover 放大、键盘 focus 有柔光环，右侧 `12–175` 与 `all` 复位胶囊；图例指标组与异常组之间有分隔线；`check-served` 103/103 |
| V79 | 矩阵滚轮拨动列表（F166） | 指针放在热力矩阵上滚轮：连续向下滚 5 格、再向上滚 3 格；滚到第一个/最后一个 Run；停手 1 秒 | 每格**只前进一个 Run**，矩阵高亮带同步移动，列表把该行顶到顶部（130ms 定档感，不是长滑行）；拨动期间除焦点行外全部变淡，焦点行有强调轨与底色；页面与列表都不自由滚动；到首尾停住；停手约 700ms 后恢复全亮；点击仍展开；`check-served` 108/108 |
| V80 | 拨动生效 + 焦点行停在 1/3（F167） | 在矩阵卡（含图例/读数区域）上滚动；连续拨到第 10 行以后；观察焦点行停在哪里 | 滚轮**确实被接管**（页面不滚动、列表不自由滚动），每格前进一个 Run；除焦点行外整体变淡；焦点行停在列表**上方约 1/3**处而不是紧贴顶部；`check-served` 110/110 |
| V81 | 工业级收敛（F168） | 看矩阵（是否 3 指标 + 标记带）→ 拖滑块看颜色是否稳定 → Tab 进矩阵按 ←/→ 与 Enter → 断网刷新看骨架 → 开启系统"减少动态效果"再拨动 | 标记带在 Time 行上方；拖滑块同一 Run 颜色不变；方向键逐行移动且出现 `Run N / M` 刻度、Enter 定位；首屏是骨架行；reduced-motion 下拨动与定位**瞬时完成**；`check-served` 120/120 |
| V82 | 指标轨道回到 150px（F169） | 看 Run 行的 Time / Token 两条 bar 有多长；再拖窗口改宽度 | 两条 bar 是**固定 150px**（不再随窗口拉长），表头 `Time`/`Token` 与轨道左边缘对齐；提示词列仍占剩余宽度且末端渐隐；`check-served` 120/120 |
| V83 | 打开即落在实况边缘 + 实时跟随（F170） | 打开 Trace Lab（会话正在流式进行）；不动鼠标等 5 秒；再上滚 5 屏，等下一轮实时更新 | 打开时直接看到**最新的 Run**、矩阵高亮在最后一列；新数据到来时视口**自动贴底**、光标跟着前进；上滚后**不再被拉回**，右下角出现 `↓ Latest`；点它平滑回到最新并恢复跟随；`check-served` 126/126 |
| V84 | 快速横扫矩阵不丢 hover（F171） | 鼠标在矩阵上**快速左右横扫**多次，再突然停在某一列；然后移出矩阵 | 横扫过程中高亮带与读数**始终跟随**，不会中途消失；停下立刻稳定在指针所在列；移出网格后高亮才消失；`check-served` 128/128 |
| V85 | 滚轮语义 + 回归套件（F172） | ① 在矩阵上滚一格 ② 快速连拨 10 格 ③ 先把列表滚到中间再拨 ④ 跑 `node mockup/regress.mjs <GUI_URL>` | ① 一格恰好前进 1 个 Run（滚轮/触控板/行模式都一样）；② 选中 +10、焦点行落回 34%、滚动**单调不倒退**、页面不滚动；③ 从当前可见行开始，不会瞬移；④ 套件**ALL GREEN（9/9）**并在回复里贴出 summary |
| V86 | 指针不动时能持续滚动（F173） | 鼠标停在矩阵同一列上**不移动**，连续向下滚 10 格、再连续向上滚 10 格 | 每格都前进/后退 1 个 Run，**不会卡在第一格后不动**；焦点行始终跟手；页面不滚动；`node mockup/regress.mjs` **ALL GREEN**（`cdp:wheel` 含"停靠指针连拨 3 格 = +3"断言） |
| V87 | 悬停=滚轮、单击即打开（F175） | ① 在矩阵上左右移动鼠标 ② 停在某列后连续滚轮 ③ 单击该列 ④ 把指针移出矩阵 | ①②**效果一致**：只有一个 Run 高亮（其余行压暗）、并滚到 34% 处；滚轮一格一个 Run 且可连续；③ 该 Run **直接展开**（step 列表出现）并滚到列表顶部，保留选中胶囊；④ 移出后恢复全亮；`node mockup/regress.mjs` **ALL GREEN**（`cdp:focus` 跑的是从 client.js 抽取的真实代码） |
| V88 | 去掉矩阵滚轮 + 放慢滑行（F176） | ① 在矩阵上滚鼠标滚轮 ② 在矩阵上左右移动鼠标，观察高亮行滑动的速度 | ① 焦点与列表**都不动**（滚轮交给浏览器默认行为）；② 高亮行**约 300ms 平滑滑到位**，能看清是从哪一行跳到哪一行（不再是瞬间跳）；单击仍直接展开；`node mockup/regress.mjs` **ALL GREEN (8 checks)**（含"滚轮不动焦点"与"滑行仍在途中"两条断言） |
| V89 | 矩阵卡置顶、无投影（F177） | ① 滚动 Run 列表到底部再回顶 ② 展开侧栏/改变宿主尺寸 ③ 看矩阵卡外观 | ①②矩阵与 KPI **始终贴在面板顶部**（页面被宿主滚动时表头也贴顶）；③ 矩阵卡**没有投影**、只有 1px 描边；`node mockup/regress.mjs` **ALL GREEN (8 checks)**（`served` 含 `data-hades-header`/`ResizeObserver` 断言与"矩阵阴影不得回潮"断言） |
| V90 | 相对位置高亮，行不乱跳（F178） | 鼠标在矩阵上**慢慢地**从左扫到右，再快速来回扫 | 视口内的行**基本不动**，只有高亮行随指针切换；只有当指针扫到当前视口之外的列时，列表才**平滑地挪最小距离**把该行带回 12–78% 舒适带；单击仍直接展开；`node mockup/regress.mjs` **ALL GREEN**（含"带内悬停不得滚动"断言） |
| V91 | 固定焦点线：行滚、高亮不动（F179） | 鼠标在矩阵上从左扫到右（慢速、快速各一遍），盯住高亮那条 | 列表在**连续滚动**，而高亮**始终停在同一条水平位置**（约视口 34%）；扫过一串列是一次连贯滑动、不是逐格跳；单击仍直接展开；`node mockup/regress.mjs` **ALL GREEN (8 checks)**（含"焦点行必须落在 34%±6%"断言） |
| V92 | 点击展开后行位置不漂移（F180） | hover 矩阵某列 → 点击 → 等它展开 → 把鼠标往下移出矩阵；重复 3 次 | 展开后滚到位的那一行**不再移动**；移出矩阵只取消压暗，不改变滚动位置；`node mockup/regress.mjs` **ALL GREEN (8 checks)**（`cdp:focus` 含"点击滚到位""详情增高不移动列表""移出矩阵不移动列表"三条断言） |
| V93 | 点击定位后不被拉回中线（F181） | ① 在矩阵上移动鼠标 ② 点击某列（该行展开并顶到顶部）③ 鼠标移出矩阵 ④ 再把鼠标移回**同一列** | ②之后该行**一直停在顶部**：③④都不会把它滑回 34% 焦点线；④再移到**别的列**则正常按焦点线滚动；`node mockup/regress.mjs` **ALL GREEN (8 checks)**（含"重新悬停点击过的列不得移动列表"断言，去掉定位锁该断言立刻变红） |
| V94 | 定位保持 + 滚动诊断（F182） | ① 点击矩阵某列使其展开顶到顶部 ② 鼠标离开矩阵 ③ 再滚列表/拖滚动条（模拟用户操作）④ 需要时在控制台执行 `__hadesScrollLog()` | ②之后若有"没人要求"的滚动，列表**回滚一次**回到定位位置；③用户自己的 `wheel`/`pointerdown`/`keydown` **正常生效**（hold 被清除）；④能打印出最近 60 条 `locate/glide/scrub/scroll/user-input` 记录；`node mockup/regress.mjs` **ALL GREEN (8 checks)**（含"外部滚动必须被回滚"断言） |
| V95 | 点击后悬停锁：只有高亮、不再滚动（F183） | ① 点击矩阵某列（行展开顶到顶部）② 指针**在矩阵上继续左右移动**（扫过别的列）③ 移出矩阵 ④ 再重新进入矩阵悬停某列 | ②只有**高亮**跟着指针变，列表**一动不动**（不会再被拉回 34% 焦点线）；③离开后仍在顶部；④重新进入后恢复"固定焦点线"滚动；`node mockup/regress.mjs` **ALL GREEN (8 checks)**（含"点击后悬停另一列不得滚动"断言，去掉悬停锁该断言立刻变红） |
| V96 | 撤掉 hold 兜底、日志带 viewport（F184） | ① 点击矩阵某列 ② 指针在矩阵上移动后移出 ③ 观察列表是否有"补回"式位移 ④ 需要诊断时 `__hadesScrollLog()` | ②③列表**不再出现一次性回滚/补位**；④每条日志含 `top` 与 `sh`，焦点变化有 `focus` 事件，可区分"滚动"与"内容变高"；`node mockup/regress.mjs` **ALL GREEN (8 checks)** |
| V97 | 矩阵整块可点、整块手形（F185） | ① 鼠标在矩阵上**慢慢**移动（尤其格子之间的缝、行与行之间、左侧标签栏上）② 在这些位置**点击** | ①光标**始终是手形**，不会变回箭头；②任意位置点击都能定位到对应列（含 1px gap 与 4px 行距）；③从三条指标行点进去后，指针移动**也不会**把已定位的行拉回焦点线；`node mockup/regress.mjs` **ALL GREEN (8 checks)**（`smoke:render` 含"1 个标记带点击容器 + 3 个指标行容器 + 手形光标"断言） |
| V98 | 打开 Step 不再"先上后下"（F186） | 对一个 Run 展开后，逐个点开/收起其中的 Step（含首次加载与再次打开） | 盒子**只在下方展开**，上方边界纹丝不动；收起同样只向上收，不会先弹一下；`node mockup/regress.mjs` **ALL GREEN (8 checks)**（`smoke:render` 逐项比较 closed/open 的边框宽度、margin、上内边距必须一致） |
| V99 | 去掉顶层统计指标面板（F187） | 打开 Trace Lab 看面板顶部 | 上方**只剩热力矩阵**，不再有 Runs/Steps/Events/Tokens/Errors 那一行统计；列表可用高度相应变大；矩阵图例、悬停读数、滑块、跟随与 `↓ Latest` 均保留；`node mockup/regress.mjs` **ALL GREEN**（`served` 含"KpiSummary / stat.* 不得出现"的反向断言） |
| V100 | 乱序打开 Step 不再跳动（F188） | 展开一个 Run 后**乱序**点开 Step（先开第 5 个、再开第 2 个；保持另一个 Step 展开时再点开新的） | 盒子**只从当前位置向下展开**，不会先塌到 0 再长回、也不会被外层面板的跟随动画拉扯；关闭同样平滑；`node mockup/regress.mjs` **ALL GREEN (9 checks)**（`collapse` 检查直接跑 client.js 里两个 `useLayoutEffect` 的真实函数体；回退任一修复都会变红） |
| V102 | 操作卡片内部切面 Tab（F191） | 展开任一 Step：① 在 REPLY 卡右上切 reply / raw ② 在 TOOL 卡右上切 args / result / raw ③ 各卡之间来回切 | REPLY 卡默认显示回复正文，切 raw 就地显示 JSON；TOOL 卡默认显示**入参正文**（可换行、超出滚动），切 result 显示结果（错误红框 + 错误色，空结果提示 (no output)），切 raw 显示 call+result JSON；**切面互不影响**（一张卡切换不会改变另一张卡）、不重新加载；整张 Step 卡片**没有**全局切换条；node mockup/regress.mjs **ALL GREEN (9 checks)** |
| V103 | 操作卡：args/result 直接展开 + raw 下拉（F192） | ① 展开一个带工具调用的 Step ② 看工具卡内容 点工具卡右下角 `▸ raw`；④ 再点 REPLY 卡右下角 `▸ raw` | 工具卡里 **args 与 result 同时可见**（各有小标题、可换行、超出滚动，失败时 result 报错色 + 卡片红边）；两处 raw **默认收起**，点一下就地展开完整 JSON、再点收起；REPLY 卡同样有 raw 下拉；node mockup/regress.mjs **ALL GREEN (9 checks)** |
| V104 | Step 面板去赘述 + 工具名标签（F193） | 展开一个含工具调用的 Step，逐块看文字 | 工具卡徽标是**工具名**（如 `pwsh`），不再出现 `TOOL`；REPLY 卡不再重复 `model call`；指令卡没有 `N chars`；注入组只显示 `▸/▾`；摘要条不出现 `model 1`、也不出现 `tools 0` / `contexts 0`；`ARGS/RESULT`、耗时、错误标记、raw 下拉都还在；node mockup/regress.mjs **ALL GREEN (9 checks)** |
| V105 | 卡片标签统一大写（F194） | 展开 Step，看卡片里的小标签：ARGS / RESULT / USER / REPLY / raw 下拉 | 全部**大写**，raw 下拉显示为 `▸ RAW`（展开后 `▾ RAW`），没有小写混用；node mockup/regress.mjs **ALL GREEN (9 checks)** |
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
| V30 | 角色标签（对齐轨迹） | 展开 run + 点开 step | Run 行指标条后出现「用户」（run0 为「系统」）标签，样式与轨迹 kindTag 一致（20px 高 / 11px / 650）；**Step 行没有角色标签**；容器内每行按 `[用户] 指令` / `[助手] 模型调用` / `[工具] tool · …` / `[上下文] 注入` 标注，颜色与轨迹一致（F131） |
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
| V19 | 首屏计量 | 打开 Trace Lab | 表头显示「首屏 xx ms · xx KB · 服务端 xx ms」，KPI + run 表即时出现（F124） |
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

- 用 **1 个 subagent** 做 UI/UX 专家评审（`references/verification.md` 要求），提供：用户目标、插件位置（主对话区视图环「Trace Lab」）、可用运行态证据。
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
