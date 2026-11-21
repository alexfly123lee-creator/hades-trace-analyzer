# 发布 TODO（明天逐条做）

> 状态：⬜ 未开始 · 🟨 进行中 · ✅ 完成 · ⛔ 阻塞（等你决定）
> 每条都写了**验收标准**，做完就能勾掉；顺序即建议执行顺序。
> 背景与依据见 [PUBLISH.md](../PUBLISH.md)；官方发布指南 [Plugin indexes](https://deepseek-harness.github.io/deepseek-harness/en/guide/plugin-market)。

## A. 发布前必备（P0，不做完不发）

| # | 事项 | 做什么 | 验收标准 | 估时 |
|---|---|---|---|---|
| A1 | **回归套件入库** | `.gitignore` 改为 `mockup/*` + 白名单（`regress` / `cdp-*` / `check-*` / `smoke-*` / `build-*-harness` / `control-hover` / `cdp-lib`）；截图与草稿继续忽略 | 干净 clone 后 `node mockup/regress.mjs <GUI>` 能跑出与本地一致的 15 项 | 1h |
| A2 | **CI（GitHub Actions）** | 新 workflow：`node --check`（client/index/lib）→ `node --test`（39 项）→ `smoke-load` / `smoke-render` / `check-collapse`（不需要浏览器）；`served` 与 `cdp:*` 标 `skip` 并注释说明需要本机 GUI | PR 与 push 到 main 自动跑，全绿徽章可贴进 README | 1–2h |
| A3 | **交互状态机定稿** | 把 F202–F210 的最终规则画成一张表（指针在矩阵内/漂移带内外 × 是否点击停靠 × 是否展开），写进 `docs/DESIGN.md`；harness 按格子逐条断言（现在只覆盖 4 条） | 表里每一格都有对应断言；`cdp:focus` 从"4 条断言"扩到覆盖整张表 | 3h |
| A4 | **异常兜底** | 客户端加 error boundary（渲染抛错显示"面板出错 + 重试"而非白屏）；Host 500 / 路由失败在面板内显示可重试的错误态 | 人为注入一次渲染异常与一次 500，面板不白屏且能重试恢复 | 2h |
| A5 | **三档会话验证** | 小（<2k 事件）、中（3–4 万）、超大（10 万+）各跑一次：首屏 payload、`/runs` cold/warm、hover 扫描帧率、`/step` p95 | 三档数字写进 `docs/SPEC.md` §4 性能门槛表（含超大档的上限说明） | 2h |
| A6 | **发布卫生** | 版本 → `0.2.0`（或 `0.1.0-preview.1`）；新增 `CHANGELOG.md`；`engines.dsh` 覆盖实际测试过的版本区间；`LICENSE` 进包（现在在仓库根，`files` 未含）；README 首屏放 GIF | `pnpm pack` 的 tarball 含 LICENSE，`CHANGELOG` 有 0.2.0 段，`engines.dsh` 与实测版本一致 | 1h |

## B. 发布动作（P1，A 完成后）

| # | 事项 | 做什么 | 验收标准 | 估时 |
|---|---|---|---|---|
| B1 | **npm 首发（preview 通道）** | `node scripts/publish.mjs --name <名字>` 核对 tarball → `pnpm publish --tag next`（**不占 `latest`**） | `npm view <name> dist-tags` 显示 `next`；`npm view <name> versions` 出现该版本 | 1h |
| B2 | **索引（优先用官方生成器）** | 用 `apps/plugin-market-generator`（输入 npm 名列表）产出 `index.json` + `icons/`；我们的 `scripts/build-index.mjs` 仅作离线兜底 | 生成器产物通过 `scripts/validate-index.mjs`；索引用 `https:` 托管、**2xx 且无重定向** | 1–2h |
| B3 | **在真实 GUI 里验一遍** | Discover → 添加索引 URL → 搜 "Trace Lab" → 看卡片（标题/图标/描述/版本/兼容性）→ 安装 → 打开面板 | 截图存档：卡片、版本列表、安装后插件行图标、详情页配图 | 1h |
| B4 | **发布报告** | 记录：版本、索引 URL、安装方式、验证证据（截图 + 命令输出） | 可直接贴给用户/群 | 0.5h |

## C. 推广（P2，B 完成后）

| # | 事项 | 做什么 | 验收标准 | 估时 |
|---|---|---|---|---|
| C1 | **awesome 列表 PR** | 向 [dshworks/awesome-dsh-plugins](https://github.com/dshworks/awesome-dsh-plugins) 提 PR（bundles 表一行：名称、链接、一句话） | PR 合入，或拿到维护者反馈 | 1h |
| C2 | **GIF（转化的关键素材）** | 6 秒：指针扫矩阵 → 列表跟随高亮 → 展开 step → 点开 RAW。CDP 驱动录制 + ffmpeg 转 GIF | GIF ≤2 MB，README 首屏可见，动作无跳帧 | 2h |
| C3 | **中文帖 + 英文 one-liner** | 用 `PUBLISH.md` §4 的文案扩成一段（解决什么问题、和内置轨迹的差别、怎么装） | 发到至少一个渠道（issue/群/博客） | 1h |
| C4 | **版本升级流程演练** | 改版本 → build-index → 重新发布 → 验证 Discover 出现 "Update available" | 用户侧能看到更新提示 | 1h |

## D. 需要你先给答案的四件事（⛔ 阻塞 A6/B1/B2/C2）

1. **npm 名**：`dsh-trace-analyzer`（先查占用）还是 `@scope/dsh-trace-analyzer`？
2. **索引托管在哪**：仓库 `main` 的 `raw.githubusercontent.com`？GitHub Pages？还是你自己的静态站？
3. **首发版本号**：`0.2.0`（正式号，但仍用 `next` tag）还是 `0.1.0-preview.1`（明确 preview）？
4. **GIF 怎么来**：我写 CDP 录制脚本 + 你确认本机能装 ffmpeg，还是你自己录一次？

## E. 明确不做（这一轮）

- 重做架构（client.js 拆模块 / 加构建步骤）—— 上次试过被回滚，等交互与测试稳定后再单独评估。
- 引入 TypeScript / 打包器。
- 多语言 UI（除视图环标题外仍为英文）。
- 跨会话对比、血缘、搜索、导出（SPEC 已列为范围外）。

## 明天的开工顺序

`A1 → A2 → A6 → B1 → B2 → B3`（先让"能装、能被 CI 证明"，再谈素材与推广），
A3/A4/A5 与 B 并行推进；C 全部等 B3 的真实截图到手后再做。
