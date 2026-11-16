# Step 展开后的结构化展示（方案 B0）

> 状态：**设计稿，未实现**。样张见 `mockup/step-box-v2.png`（真实数据渲染），原型脚本 `mockup/build-box-mockup.mjs`。
> 关联：F129（Step 括号容器 + 有序活动清单）、F131（角色标签）、F23.2（说明行）。

## 1. 现在的问题

Step 展开后，每个操作是「一枚角色 chip + 一行标题 + 一块 mono 文本」，参数与结果视觉权重相同、都截断到 400 字符：

| 数据（参考会话 2381 步） | 实测 |
|---|---|
| `/step` 平均体积 | 1.4 KB（p95 2.0 KB / max 7.5 KB） |
| 每 step 工具调用 | 平均 1.03 次 |
| 参数/结果截断 | 各 400 字符，长内容只能点「原文」看整块 JSON |
| 用户实际要答的问题 | 改了哪个文件、改了几行、命令退出码几、读到哪段、多久 |

也就是说：**信息都在，但需要"读"而不是"看"**。一条 `edit` 的 255 B 参数和一条 `read` 的 7.7 KB 结果，现在长得一模一样。

## 2. 目标（3 秒内回答四个问题）

1. **做了什么**：动作（chip）+ 对象（文件 / 命令 / 模式 / URL）
2. **多大**：`−3 行 / +5 行`、`190 行 · 7.9 KB`、`命中 32 处`
3. **结果如何**：成功/失败、退出码、`1 replacement`
4. **花了多久**：耗时固定右上角，hover 出模型/工具/等待三段

## 3. 卡片结构（每次工具调用 = 一张卡）

```
│ [EDIT] agent.md                                                    86ms │  ← 动作 chip + 对象 + 耗时
│   path     <workspace>\agent.md                                          │  ← 字段网格：64px label + 值
│   change   − 1 行 / + 1 行                                               │
│   改动摘要                                                                │
│   ┌──────────────────────────────────────────────────────────────┐       │  ← 类型化结果区
│   │ −  形态与位置 │ 挂进当前会话…                                   │       │
│   │ +  形态与位置 │ 右侧栏（rightbar）独立 Tab…                     │       │
│   └──────────────────────────────────────────────────────────────┘       │
│   结果                                                                    │
│   The file … has been updated successfully.                              │
```

- 卡片之间 **10px**，左侧 **2px 轨道**（沿用 step 括号内已有的视觉语言，不新增容器）
- 一个 step 里 1–3 张卡默认展开；多于 3 张时第 4 张起折叠成标题行，点开再铺
- 「原文」保留为每张卡右上角的次级入口（现状不变）

## 4. 类型矩阵

| 工具 | 卡片标题 | 字段（label: value） | 结果渲染器 |
|---|---|---|---|
| `read` | 文件名 | `path`、`range`（offset/limit） | 带行号的前 4 行 |
| `read_image` | 文件名 | `path` | 尺寸 + 缩略图（复用附件呈现） |
| `edit` | 文件名 | `path`、`change`（−N/+N 行） | 改动摘要：− 前 3 行 / + 前 3 行 + 结果单行 |
| `write` | 文件名 | `path`、`content`（行数 · KB） | 新文件前 3 行（带行号） |
| `grep` | `「pattern」` | `pattern`、`scope` | 命中列表（前 4 条 `path:line`） |
| `glob` | `「pattern」` | `pattern` | 文件列表（前 6 条） |
| `pwsh` | 描述或命令首行 | `desc`、`command` | `stdout` 前 4 行 + 退出码 chip |
| `todo_write` | 清单 N 项 | —（不重复） | 勾选清单（done/doing/pending 三色） |
| `present` | 交付 N 个文件 | — | 文件名列表（点击走既有 `deliverables.file.actions`） |
| `ask_user_question` | 提问 N 问 | `questions` | 问题 + 选项（选中项高亮） |
| `web_search` | 查询词 | `queries`、`mode` | 引用列表（title + 域名）或 JSON 折叠 |
| `web_fetch` | `host/path` | `url` | 状态 + 前 4 行 |
| `cordis_inspect_*` | method | `service`、`method` | JSON 折叠树 |
| 其它 / MCP | `tool · name` | 前 2 个标量字段 | JSON 折叠树（默认展开 2 层） |
| 模型调用 | `模型调用` | `in/out/cache/think` | 文本折叠 3 行，可展开 |
| 说明行 | chip 行（现状） | — | 单行说明（现状） |

## 5. 数据契约

`/step` 的 `operations[]` 每人新增三块（全部可选，缺省走今天的纯文本渲染）：

```ts
fields?: { k: string; v: string; mono?: boolean }[]        // ≤ 6 条，v ≤ 96 字符
diff?: { minus: string[]; plus: string[] }                 // 仅 edit/write，各 ≤ 3 行 × 96 字符
resultView?: {
  kind: 'note' | 'code' | 'list' | 'json'
  label: string                                            // '结果' / 'stdout' / '命中 32 处'
  lines?: string[]                                         // ≤ 4 行 × 96 字符
  lang?: string
  truncated: boolean                                       // true → 显示「全文」
}
```

Host 新增纯函数（`lib/aggregate.js`，可单测）：

```js
describeToolCall(name, argsText, resultText, isError) -> { fields, diff?, resultView? }
```

- 复用现有 `argString / argNumber / argArrayLength / argFirstArrayString` 扫描器，**不做全量 `JSON.parse`**（`write` 的 8.3 KB 参数会让 P02/P11 超预算）；仅当 `argsText` ≤ 2 KB 时才尝试 `JSON.parse`
- 只在 `/step` 路径执行（每 step 平均 1.4 KB、1 次调用），**不碰 `/runs` 首屏**
- 参数被 400 字符截断时，字段值写「…（已截断）」，绝不用猜测值

## 6. 截断与全文

- 字段值：96 字符单行省略 + `title` 全文
- 结果：取前 4 行；`truncated: true` 时给「全文」按钮 → 复用已有 `/event` 原文懒加载（现状）
- `edit` 的 `−/+` 预览只取前 3 行；**真 diff（对齐算法）不在本期**

## 7. 交互

| 行为 | 结果 |
|---|---|
| 默认 | 1–3 张卡展开，其余折叠标题行 |
| 点击字段值 | 该值展开为多行（`pre-wrap`），再点收起 |
| 点击「全文」 | 懒加载整段原文（复用现有 `EventDetail`） |
| hover 耗时 | `耗时 · 模型 x · 工具 y · 等待 z` |
| ⌘/Ctrl + 点击值 | 复制该值（短暂「已复制」提示） |
| 键盘 | 卡片 `tabIndex=0`，Enter 展开/收起，Esc 收起 |

## 8. 视觉规格

- 卡片左轨 2px `accent 20%`；错误卡 `error 40%`
- 字段网格：`grid-template-columns: 64px minmax(0,1fr)`，行距 2px；label 10px `--faint` mono，值 11px mono
- 结果块：底 `#fafbfc`（暗色 `--dsw-alias-bg-layer-1`）、1px `border-l1`、`radius-sm`、行高 1.55、带行号列 22px
- diff：行底 `error 6%` / `success 6%`，gutter `−` / `+` 10px
- 语义色只用于语义：错误 = error、成功/退出码 0 = teal、运行中 = warn
- 不引入新的圆角/字重/字号档位——全部复用 F136 既有的 token 与 10/11px 两档

## 9. 分阶段

**B1（建议先做）**：`describeToolCall` + 6 类渲染器（read / edit / write / grep / pwsh / 兜底 JSON 树）+ 单测
- AC：`mockup/box-samples.json` 里 6 类样例都渲染成卡片；`/step` 体积 p95 ≤ 8 KB（现 2.0 KB，允许 +25%）；`node --test` 新增 ≥ 6 用例；无 JSON.parse 大参数（用 8.3 KB 的 `write` 样例做守卫测试）

**B2**：todo / present / ask_user_question / web_* / cordis_inspect_* 专用渲染、复制、hover 分段耗时
- AC：这 5 类不再出现裸 JSON；复制成功有反馈

**B3**：真 diff（`edit` 的 old/new 全量按需拉取）、结果高亮、`grep` 命中可跳转原文
- AC：`edit` 卡片显示真实上下文行；跳转落到对应 `seq`

## 10. 风险

| 风险 | 处理 |
|---|---|
| 解析开销 | 只走 `/step`；用扫描器；2 KB 以上不 parse |
| 截断导致字段错 | 显式「已截断」，不猜 |
| 渲染器膨胀 | 复用 `h()` 与既有 token，不引第三方 JSON 树库 |
| 信息丢失 | 原文入口保留；卡片只是"更快读"，不是"替代原文" |

## 11. 未决

- `edit` 真 diff 是否值得（需完整 old/new，单条最大 8 KB，得走懒加载）
- 「原文」是否收进卡片菜单（现状是每行一个链接，卡片化后位置需要重排）
- 模型调用卡是否显示 `reasoning` 摘要
