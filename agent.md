# Trace Lab — 架构与交付准则

> DSH 插件 bundle：把会话事件日志变成 `session → run → step → operation` 的可读视图，挂在主对话区视图环（`conversation.view`，id `hades-eye`，order 11）。
> 契约见 [SPEC](docs/SPEC.md)，视觉规则见 [DESIGN](docs/DESIGN.md)，验收见 [TEST](docs/TEST.md)。

## 0. 交付铁律

1. **"语法通过"不等于完成**。必须端到端：运行中的 Host 真的吐出这份代码、界面真的变了、数字真的对。
2. **一条命令回归**：`node mockup/regress.mjs http://127.0.0.1:<GUI端口>` 必须 `ALL GREEN`；红项不交付，summary 表原样贴出。
3. **性能问题先量化**（payload 字节数、parse 毫秒、请求数），再动手；交付时给改造后的真实数字。
4. **重点交互必须有 harness**：指针/滚动/展开这类只能真机验证的行为，用 CDP 驱动**线上代码**（从 `client.js` 提取，不写复刻），并附对照组证明断言不是空转。
5. **未验证必须标注**：哪一步没测、为什么，不许用"应该没问题"结案。

## 1. 分层

```
Host (index.js)           路由表 + 快照/原文 LRU + 只读 JSON
  lib/trace.js            原始事件 → run/step 树（纯函数）
  lib/titles.js           工具/动作/备注的命名与标题（纯函数）
  lib/project.js          /runs /run /step 三段投影（纯函数）
  lib/bench.js            仅 loopback 的性能探针
Client (client.js)        conversation.view：主题变量 + 数据 hook + 组件
  useRuns                 /runs 首屏、会话切换、缓存、可见变化签名
  Body                    app shell、实时节拍、跟随/聚焦/定位、渲染
  OverviewBoard           热力矩阵（读数、窗口、命中解析）
  DualBarChart            run 表（排序、FLIP、行缓存、焦点重放）
  StepRow / StepContent   step 行与内容卡片（REPLY / 工具 / CTX / RAW）
  EventDetail             原文 JSON（loader 去重 + 预览上限）
```

数据流：`sessionQuery` →（Host 投影，KB 级）→ `/runs` → `useRuns` → `DualBarChart`；展开 run 取 `/run`，点开 step 取 `/step`，点 RAW 取 `/event`。客户端不建树，Host 是唯一实现。

## 2. 必须守住的边界

- **只读**：不改会话事件、不写别的插件 DOM、不 `require` Harness Client 包（只 `require('react')`）。
- **主题**：颜色只用 `--dsw-alias-*`；深浅色走面板根的 `data-hades-theme` + CSS 变量（面板可能在 shadow root 内）。
- **滚动所有权**：面板自己拥有滚动（app shell + 单滚动容器），不依赖宿主页面滚动。
- **焦点高亮**由渲染结果驱动（`syncFocusRow`），不留"只写一次"的命令式状态。
- **矩阵命中**按几何解析、卡片级清空（详见 DESIGN §4.1）。破坏它会直接表现为"hover 经常丢"。

## 3. 仓库

```
agent.md                  本文（架构 + 铁律）
docs/SPEC.md              契约与不变量
docs/DESIGN.md            表现层规则
docs/TEST.md              验收矩阵
README.md                 安装与快速上手
dsh-trace-analyzer/       插件本体
  index.js  client.js
  lib/{trace,titles,project,bench}.js
  test/trace.test.js      40 个纯函数单测
  locale/{en,zh}.json     插件元信息（视图标题走 locale）
  docs/DETAIL.md          插件详情页
mockup/                   回归套件与 harness（只入脚本，不入截图）
```

## 4. 开发循环

- Client 改动：刷新页面（Ctrl+F5）即生效。
- Host 改动：`plugin_manager` 关闭 → 启用该 bundle 才会重载。
- 回归入口：`mockup/regress.mjs`（17 项）；单测：`node --test dsh-trace-analyzer/test/trace.test.js`。
- 文档规模由 `mockup/check-docs.mjs` 强制（每份 ≤ 2000 字），它是回归套件的一项。

## 5. 里程碑索引

M0–M72 的逐条记录在 git 提交正文里（`git log --oneline`，每条提交都写了当时的问题与验证数字）。当前状态由本文 + SPEC + DESIGN + TEST 四份文档描述，**不另存历史**。
