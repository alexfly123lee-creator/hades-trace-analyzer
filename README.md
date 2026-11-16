# Hades Lab — DSH Trace 分析插件

把 **DSH（DeepSeek Harness）** 会话的轨迹重新组织成 `session → run（一次指令）→ step（一次迭代）→ 操作` 的树，
替换内置「轨迹」视图的阅读体验：统计以 **run** 为单位，step 行用**标签 + 对象**说清「这一步干了什么」。

一个 bundle，两半：Host（`index.js` + `lib/aggregate.js`，只读路由）/ Client（`client.js`，`conversation.view` 槽）。

## 仓库结构

```
agent.md                 概要设计（信息架构、数据源、里程碑 M0–M11、交付铁律）
docs/SPEC.md             功能规格（F1–F137，含 AC 与数据契约）
docs/DESIGN.md           视觉与交互设计（几何、配色、列布局、标签体系）
docs/TEST.md             测试用例（V/U 用例 + P01–P11 性能门槛）
docs/REPORT-timing.md    计时口径审计报告（与官方轨迹逐值对齐）
dsh-trace-analyzer/      插件本体（bundle）
  index.js               Host 半：/api/trace-analyzer/{runs,run,step,event,…} + 快照缓存
  client.js              Client 半：Hades Lab 视图（KPI + run/step 表 + step 面板）
  lib/aggregate.js       纯函数聚合层（可单测、被两端复用）
  test/aggregate.test.js 40 个单测
mockup/                  校验脚本与设计过程稿（性能/对齐/标签行一致性）——**只在本地，不入库**
```

> 仓库只保留三块：`agent.md`、`docs/`、`dsh-trace-analyzer/`。
> `mockup/`（33 张 PNG 截图 + 18 个 HTML 预览稿 + 3 个会话数据快照 + 29 个校验脚本，约 5.1 MB）见 `.gitignore`。

## 安装（本地开发）

插件以 `link:` 方式装在 DSH profile 里：

```powershell
# 1) 让 profile 指向本仓库
#    C:\Users\<you>\.dsh\profiles\desktop\ 里把该 bundle 配成 link:E:\path\to\dsh-trace-analyzer
# 2) 打开 DSH Web GUI，主对话区上方出现「Hades Lab」标签
```

Host 半改动需要重载插件（禁用 → 启用）；Client 半改动刷新页面（Ctrl+F5）即可。

## 关键设计口径

- **run 的切分**：只有真实用户消息（`user/message` 且 `data.source.kind === 'user'`）开启新 run；run0 = 系统提示词。
- **step 边界**：日志自带的 `step/start` / `step/end`；`turn/end` 之后的迟到事件不粘到上一步。
- **step 计时**：`模型 + 工具`，**人机等待单列**（`⏸`），不计入耗时；`run 时长 = Σ 各步`。
- **标签体系**：Turn 行 = 角色（`USER` / `SYSTEM`），Step 行 = 动作（`READ` / `EDIT` / `RUN` / `REPLY` …），
  两级共用同一个 19px 标签组件（对齐官方轨迹 `kindTag`）；一个 step 有多种动作时并排多枚 chip，重复动作折叠成 `EDIT ×6`。

## 校验

仓库内可跑的只有单测（`docs/TEST.md` 的 V 用例是手工验收清单）：

```powershell
node --test dsh-trace-analyzer/test/aggregate.test.js   # 40 个单测
```

`docs/` 里引用的 P01–P11 性能门槛、与官方轨迹的计时逐值对齐、step 标签行一致性等数字，
由开发机 `mockup/` 下的校验脚本产出（该目录不入库）：`verify-perf.mjs`（P01–P11）、
`verify-traj-align.mjs`（模型段 0 差异、工具段差额 = waitMs）、`verify-chips.mjs`（chip 覆盖全部 `tool/call`）、
`bench-live.mjs`（live 端到端）、`check-served.mjs`（Host 是否已加载新代码）。

## License

[MIT](LICENSE) © 2026 Heisenberg

