# 把 Trace Lab 发布到"插件库"：调研结论 + 操作手册

> 结论先行：**DSH 没有中心化插件商店**。所谓"插件库"是用户自己在 Plugin Manager → **Discover** 里添加的 **插件索引（index JSON，format 1）**。
> 因此发布 = ① 把 bundle 发到 npm（或一个 pin 到 commit 的 Git 仓库）+ ② 生成一份 index JSON 并用任意 HTTPS 托管 + ③ 用户在 Discover 里填这个 URL。
> 官方目前**不提供默认索引**，也没有"提交入口"；想进"官方库"只能自己托管索引并让别人添加，或让上游把它加入某个公共索引。

## 1. 依据（都是本机版本实测，不是记忆）

| 事实 | 证据来源 |
|---|---|
| Discover 由 `@deepseek-ai/dsh-experimental-plugin-market-bundle` 提供，本机已安装且启用 | `plugin_manager list_bundles`：`installed: true, enabled: true`，rows = `plugin-market` + `ui-plugin-market` |
| 索引源完全由用户配置，**默认为空**（`indexes: []`，无内置默认源） | `@deepseek-ai/dsh-plugin-market` README 的 Config 表；市场包里唯一出现的 URL 是 Discover 输入提示里的 `https://example.com/index.json` |
| index 是一份 http(s) JSON，格式版本 1，由校验器 `@deepseek-ai/dsh-plugin-market-index` 定义 | `parseMarketIndex` / `marketInstallTarget` 的类型与源码 |
| 安装动作 = `pluginManager.installBundle`，目标是 `name@version`（npm）或 `git+https://…@<40位commit>[#path:…]` | `marketInstallTarget()` 返回值 |
| Discover 的长描述（详情页）从**包的 npm 文件 CDN**（jsdelivr / unpkg / npmmirror）或 Git commit 的 `path` 读取 | `readEntryDetail(url, name, version, language)` 的说明 |
| 详情页 = `meta.detail` 指向的**只含一张图的 Markdown**；功能/用法写在 `meta.description` | `references/plugin-details.md`（dsh-doc skill） |
| 图标：SVG/PNG/JPEG/WebP ≤256 KiB，**不画底砖**，36×36 画box | `references/host-plugin.md` + `references/artwork.md` |

**推论**：能被 Discover 装上的最小条件 = 一个 npm 包（`name@version` 可装）+ 一份合法 index JSON（HTTPS 可达）+ 用户添加该 URL。

## 2. 一次发布要做什么

```powershell
# 0) 准备：确认 npm 名可用（默认用 dsh-trace-analyzer，可换 --name）
# 1) 校验素材 + 打出与 npm 完全一致的 tarball（会打印 13 个文件并核对必备文件）
node scripts/publish.mjs --dry-run --name dsh-trace-analyzer

# 2) 真正发布（需要 npm 登录；脚本不代跑发布）
node scripts/publish.mjs --name dsh-trace-analyzer
#    ……然后执行它打印的那条 pnpm publish / npm publish 命令

# 3) 生成索引（图标内联为 data: URL，单文件可直接托管）
node scripts/build-index.mjs --name dsh-trace-analyzer

# 4) 用 DSH 自带的校验器验一遍（必须 OK，否则 Discover 会拒绝整份索引）
$env:ELECTRON_RUN_AS_NODE='1'
& "$env:DSH_NODE_EXECUTABLE" scripts/validate-index.mjs plugin-index.json

# 5) 托管 plugin-index.json（GitHub Pages / raw.githubusercontent.com / 任意静态站 / gist），
#    然后在 GUI：Plugin Manager → Discover → 添加索引 URL → 搜 "Trace Lab" → Install
```

- 版本升级：改 `dsh-trace-analyzer/package.json` 的 `version` → 重跑 1–4。索引里可以保留多个版本（校验器按 SemVer 降序排）。
- 私有/内网：`--registry https://your.registry/` 会写进 `source.registry`；但 **Discover 读不到私服包的长描述**（文件 CDN 只认公开 npm/npmmirror/自定义 Git），详情页会退化。
- Git 源（不发 npm 也能装）：`source: { "type": "git", "url": "...", "commit": "<40 位 SHA>", "path": "dsh-trace-analyzer" }`。

## 3. 素材清单（本仓库已产出 ✅ / 待补 ⬜）

| 用途 | 文件 | 状态 | 说明 |
|---|---|---|---|
| 图标（插件行 + 详情头图） | `dsh-trace-analyzer/icon.svg` | ✅ 重画 | 36×36、无底砖、双色（矩阵三行 + 高亮列），亮暗底都可读 |
| 详情页配图 | `dsh-trace-analyzer/docs/preview.svg` | ✅ | 640×300、纯几何无文字、无 `<script>/<style>/<image>`，一个主图 |
| 详情页文档 | `docs/DETAIL.md` / `docs/DETAIL.zh.md` | ✅ 重写 | 严格**只含一行图片**（旧的长文已迁进 `meta.description`） |
| 展示文案 | `locale/en.json` / `locale/zh.json` 的 `meta.title/description` | ✅ 重写 | 标题 `Trace Lab`；描述含"在哪、怎么读、口径、限制" |
| 包首页 | `dsh-trace-analyzer/README.md` | ✅ 新增 | npm 页面 + 无 `meta.detail` 时的回退 |
| 包元信息 | `dsh-trace-analyzer/package.json` | ✅ | 新增 `description/keywords/author/homepage/repository/engines.dsh`，`exports` 增 `./docs/*` |
| 索引 | `plugin-index.json` | ✅ 生成 | format 1，图标 base64 内联（363 B，限 32 KiB） |
| 索引校验 | `scripts/validate-index.mjs` | ✅ | 用 **DSH 自带** `parseMarketIndex` 跑，实测 `OK format 1` |
| 打包核验 | `scripts/publish.mjs` | ✅ | `pnpm pack` 实测 13 文件 / 68.8 KiB，必备文件逐一核对 |
| 真实界面截图/动图 | — | ⬜ 建议补 | 需要已登录 GUI 的浏览器；GIF 展示"指针扫矩阵 → 列表跟随 → 展开 step" |
| 宣传短文（中/英） | 见 §4 | ✅ 草稿 | 可直接贴到 issue / 群 / 博客 |

## 4. 传播素材（可直接复制）

**一句话（中）**：Trace Lab —— 把 DSH 会话的 trace 日志读成产品视图：每个 run 一列的热力矩阵 + 逐 step 的工具调用与原文，计时用官方口径，只读、实时。

**One-liner (EN)**: Trace Lab turns a DeepSeek Harness session's trace log into a product view — a heat matrix of runs, every step's tool calls and raw events, official timing, read-only and live.

**三条卖点**
1. **一眼定位贵的那一步**：热力矩阵按会话内排名着色（耗时/Token/步数），错误与慢操作单独一条标记带；点一列即展开该 run。
2. **看得懂"这一步干了什么"**：Step 行用标签+对象（`READ`/`EDIT`/`RUN`/`REPLY`…），展开是模型回复、每次工具调用的参数与结果、注入上下文、以及默认收起的 RAW。
3. **口径与官方轨迹一致，且只读**：step 耗时 = 模型 + 工具，等你回答的时间单列且不计入；不产生模型请求，只在可见时每 2 秒查一次日志偏移。

**对比内置「轨迹」**

| | 内置轨迹 | Trace Lab |
|---|---|---|
| 首屏 | 原始事件列表 | 热力矩阵 + run 表（约 55–80 KB，按需再取 step） |
| 统计单位 | 事件 | **run**（一次真实指令，run0 = 系统提示词） |
| 定位瓶颈 | 自己翻 | 矩阵按排名着色 + 错误/慢标记带 |
| step 内容 | 展开后仍偏原始 | 卡片化：回复 / 工具 args+result / CTX / RAW 下拉 |

**建议 keywords**（已写进 package.json）：`dsh`、`dsh-bundle`、`deepseek-harness`、`trace`、`observability`、`session`、`heatmap`、`debugging`。

## 5. 风险与注意

1. **npm 名占用**：`dsh-trace-analyzer` 若被占，用 `--name @<scope>/dsh-trace-analyzer`（需先建 scope）。
2. **`private: true` 不能发布**：仓库里保持 `true`（本地 link 安装需要），`scripts/publish.mjs` 在暂存目录里剥掉它。
3. **`engines.dsh` 必须覆盖用户的 DSH 版本**，否则 Discover 标为不兼容而不给装。当前写 `>=0.2.2-rc.1`。
4. **索引必须整体合法**：一条不合规（含图标超限、版本非 SemVer、相对 icon 指向不存在的文件）会让整份索引被拒；发布前跑 `validate-index.mjs`。
5. **详情页只认公开源码**：私服包没有可读文件 CDN，详情页会退回 README 或报错。
6. **官方库**：官方没有公开索引，也没有提交入口；想让更多人不加索引就装到，只能把索引 URL 放进文档/帖子，或推动上游收录。
