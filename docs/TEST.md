# Trace Lab · 验收（TEST）

> 一条命令跑完：`node mockup/regress.mjs http://127.0.0.1:<GUI端口>`。**红项不交付**，summary 表原样贴进回复。

## 1. 自动化矩阵

| # | 检查 | 覆盖 | 判定来源 |
|---|---|---|---|
| 1 | `syntax` | client bundle 可解析 | `node --check` |
| 2 | `syntax:host` | Host `index.js` | 同上 |
| 3 | `syntax:lib` ×4 | `lib/{trace,titles,project,bench}.js` | 同上 |
| 4 | `unit` | run/step 切分、计时、token、标题/chip、KPI 口径（40 项） | `node --test` |
| 5 | `smoke:load` | 模块加载、`apply`、locale 表、视图注册（`hades-eye` / order 11） | 脚本断言 |
| 6 | `smoke:render` | 矩阵三行 + 标记带 + 标签带；指针挂在卡片、plot 无 leave；Step 卡片 RAW 顺序/大写/无摘要条；行几何不随开合变化；RAW 预览上限；指标轨 100px | 渲染树断言 |
| 7 | `collapse` | Collapse 的打开/关闭/跟随高度效果体（用假元素执行） | 脚本断言 |
| 8 | `build:harness` | 交互 harness 从 `client.js` **重新提取线上代码** | 生成脚本退出码 |
| 9 | `build:hover` | hover harness 同上（含旧实现对照组） | 同上 |
| 10 | `served` | 运行中 Host 真正吐出的 bundle 含本轮标记（160+ 条 / 6 组）+ 反向断言（被否的方案不得复活） | fetch 服务端产物 |
| 11 | `cdp:focus` | 指针/滚轮的聚焦路径跑**线上代码**：一列一 Run、落点 34%、快速连扫不倒退、点击后不漂移 | CDP 真实鼠标事件 |
| 12 | `cdp:hover` | 矩阵 hover：缝里进入即解析、缝隙/行缝更新、卡内死区保留、wobble 全程不丢、离开才清空、**hover 条几何与单元格一致**、焦点被抹后自愈 | 同上 |
| 13 | `control:hover` | **对照组**：旧实现必须仍能复现三处缺陷，否则上面那条断言是空转 | 同上 |
| 14 | `cdp:follow` | 打开落在实况边缘、上滚释放、pill 复位 | 同上 |
| 15 | `docs` | 每份文档 ≤ 2000 字 | `mockup/check-docs.mjs` |

- 新增重点交互：**必须同时补 harness 与套件项**，否则不算交付。
- harness 页面里的被测代码由 `mockup/build-*harness.mjs` 从 `client.js` 原样提取（"跑真码，不跑复刻"）；`regress` 每次先重建，避免用旧 harness 空过。

## 2. 手工验收（自动化看不到的）

1. Ctrl+F5 后视图环出现「Trace Lab」，与「轨迹」同排。
2. 深/浅色切换即时生效（无需刷新），hover/选中/焦点三档可区分。
3. 指针在矩阵上来回扫：读数跟手，列表压暗且焦点行稳定落在 34% 线附近。
4. 点击某一列：该 Run 停到列表顶部并展开；指针继续移动只换高亮，列表不再滚动。
5. 展开一个 30 步以上的 Run，再乱序展开若干 Step：不出现"先上后下"跳一下。
6. 实时：对话继续跑时新 Run 在底部追加，读最新时自动贴底；上滚后出现「↓ Latest」。

## 3. 性能

门槛与实测见 SPEC §4；live 数字来自 `/bench`（`mockup/bench-live.mjs`）与 `check-served`。

## 4. 交付流程

1. 改代码。
2. `node mockup/regress.mjs <GUI>` 全绿；有红项先修，修完重跑。
3. 更新受影响的文档，过 `docs` 检查。
4. 提交：正文写"为什么"，不写"改了什么"（"改了什么"看 diff）。
5. Host 半改动需 `plugin_manager` 关→开插件；Client 半改动刷新页面。
6. 报告必须给出：跑了什么、真实结果、未验证项及原因。
