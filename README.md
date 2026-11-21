# Trace Lab — DSH Trace 分析插件

把 **DeepSeek Harness（DSH）** 会话的轨迹重组为 `session → run（一次指令）→ step（一次迭代）→ 操作`，
替换内置「轨迹」视图的阅读体验：统计以 **run** 为单位，step 行用**标签 + 对象**说清「这一步干了什么」。

一个 bundle，两半：**Host**（只读 JSON 路由 + 纯函数投影）/ **Client**（`conversation.view` 槽里的 React 视图）。

## 仓库结构

```
agent.md                  架构与交付铁律
docs/SPEC.md              数据契约与行为不变量
docs/DESIGN.md            表现层规则（几何、主题、动效）
docs/TEST.md              验收矩阵
dsh-trace-analyzer/       插件本体
  index.js                Host：/runs /run /step /event（+ loopback /health /bench）
  client.js               Client：Trace Lab 视图
  lib/trace.js            事件 → run/step 树
  lib/titles.js           工具/动作命名
  lib/project.js          三段投影
  lib/bench.js            loopback 性能探针
  test/trace.test.js      40 个纯函数单测
mockup/                   回归套件与交互 harness（脚本入库，截图/草稿忽略）
```

## 安装（本地开发）

插件以 `link:` 方式装在 DSH profile 里：把该 bundle 配成 `link:E:\path\to\dsh-trace-analyzer`，
打开 DSH Web GUI，主对话区视图环出现「Trace Lab」。

Host 半改动需重载插件（禁用 → 启用）；Client 半改动刷新页面（Ctrl+F5）。

## 关键口径

- **run 切分**：只有真实用户消息（`user/message` 且 `data.source.kind === 'user'`）开启新 run；run0 = 系统提示词。
- **step 边界**：日志自带的 `step/start` / `step/end`；`turn/end` 之后的迟到事件不粘到上一步。
- **step 计时**：`模型 + 工具`，人机等待单列（`⏸`）不计入；`run 时长 = Σ 各步`。
- **标签**：Run 行 = 角色（`USER` / `SYSTEM`），Step 行 = 动作（`READ` / `EDIT` / `RUN` / `REPLY` …），
  两级共用同一枚 18px 标签；一个 step 有多种动作时并排多枚 chip，重复动作折叠成 `EDIT ×6`。

## 校验

```powershell
node mockup/regress.mjs http://127.0.0.1:49877     # 17 项：语法/单测/渲染/线上产物/CDP 交互/文档
node --test dsh-trace-analyzer/test/trace.test.js  # 40 个单测
```

`mockup/regress.mjs` 需要本机 Edge；CDP 项会用真实鼠标事件驱动**从 `client.js` 提取的线上代码**。

## License

[MIT](LICENSE) © 2026 Heisenberg
