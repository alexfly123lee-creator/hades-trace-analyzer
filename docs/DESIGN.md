# Trace Lab · 表现层设计（DESIGN）

> 只写当前生效规则的**唯一样式基准**。颜色只用 DSH 设计令牌，不写死十六进制。

## 1. 骨架

面板是**有确定高度的 app shell**：`高度 = clamp(320, 视口高 − 面板顶, 父容器可见底 − 面板顶)`。

```
shell (flex column, position: relative)
├─ header (flex: 0 0 auto, 矩阵卡片)   ← 滚动区之外的兄弟节点，结构上不会滚走
├─ list   (flex: 1 1 auto, overflow-y: auto, overscroll-behavior: contain,
│          overflow-anchor: none)      ← 唯一的滚动容器
└─ pill   (absolute, "↓ Latest")       ← 只在离开实况边缘时出现
```

`ResizeObserver` 监听父容器（侧栏/composer 变化不触发 window resize）。列表底部留一屏 `tailPad`，让最后一行也能滚到顶部。

## 2. 行几何

| 元素 | 尺寸 |
|---|---|
| Run 行高 / 内距 | 28px / 4px |
| Step 行高 | 30px，缩进 12px + 3px 轨 |
| Run 序号列 | 78px（`RUN_IDX_W`） |
| 指标条 | 轨道 100px + 间隙 6 + 数字槽 70 = 176px（两列等宽） |
| 标签 chip | 18px 高 / 11px / 650 / `radius-xs` / 全大写 |
| 明细缩进 | Run 内 74px；Step 卡片 `marginLeft 74` |

字号只用 13 / 12 / 11 三档；正文 400，仅标签 chip 650。数字一律 `tabular-nums` + mono。

## 3. 指标条（Time / Token 同一画法）

| 部分 | 规则 |
|---|---|
| 轨道 | 8px 高，`radius 99`，底色 `color-mix(tone 12%, transparent)` |
| 底衬 `SpentFill` | 本行之前已消费部分，`opacity .18` |
| 本行份额 `SliceFill` | 满轨道高，`radius 2`，实色；`left/width` 过渡 `.25s` |
| 色相 | Time = `--dsw-alias-trajectory-accent`；Token = `--dsw-alias-chart-tools` |

Step 的 Time 条 = run 时间轴上的位置；Token 条 = run 总量的累计切片（第 k 步占 `[cum(k−1), cum(k)]`）。

## 4. 热力矩阵

三行指标（Time / Token / Steps）+ 一行 3px 标记带（错误红 / 慢橙）。每行一列，列宽 `(宽 − 间隙)/n`。

- **着色按会话内排名**：`8% + 80% × rank`，与列表长度无关（新增 Run 不会让旧列变色）。原因是 token 分布 52× 偏斜，线性映射只会亮一格。
- **十字线** = 三个独立矩形（淡底 + 左右各 1px 线），画在单元之后；用带边框的盒子会在 2–4px 列宽时塌成梯形。
- **读数行**在卡片顶部：`Run N · 时长 · token · 步数 · error/slow`；未悬停时显示操作提示，同一行不跳高。

### 4.1 命中区（F202，必须保持）

| 规则 | 原因 |
|---|---|
| 指针事件挂**卡片**，不是 plot 条 | plot 只有约 52px 高，指针上下漂 3px 就离开，会同时清空 hover 与列表聚焦 |
| 解析用**几何**（x 比例），不用 `closest('[data-idx]')` | 175 列下 1px 列缝 + 4px 行缝约占 28% 面积，节点命中会冻结在旧列 |
| `y` 必须在 plot 带内（±4px），`x` 在 grid 内 | 图例与卡片内边距是死区，不该解析出列 |
| 卡片内死区**保留上一列**；只有离开卡片才清空 | 去读图例不该打断读数 |
| 聚焦高亮由 `syncFocusRow` 每次提交重放 | 该行开合时 React 会重写 className，命令式 class 会被抹掉 |

## 5. 状态优先级（同名变量见 `THEME_CSS`）

```
hover（9%/22%） < 展开 Run 行（12%/30%） < focus（16%/34%） < 展开 Step 行（22%/36%）
```

- 指针聚焦另有 `.hades-scrubbing`：整表压暗到 `opacity .22`，只有 `.is-focus` 保持 1。
- 悬停/选中/聚焦**只用底色**，无描边（1px inset 环在密集列表里显脏，已否）。
- 列头悬停 = 整列 14% 底 + 底部 1px 80% 线。

## 6. 主题

深色不是"同一套值"：9% accent 混进深色 `layer-1` 几乎不可见，所以深色约 ×2.4。

| 变量 | 浅色 | 深色 |
|---|---|---|
| `--hades-hover-row` | 9% + layer-1 | 22% + layer-1 |
| `--hades-sel-row` | 12% | 30% |
| `--hades-focus-row` | 16% | 34% |
| `--hades-step-hover` | 10% | 26% |
| `--hades-step-sel` | 22% | 36% |
| `--hades-sort-hover` / `-line` | 14% / 80% | 26% / 90% |

主题来源：`body[data-ds-dark-theme]` → 面板根 `data-hades-theme="dark"`（**属性 + CSS 变量**，不再在渲染时改写调色板对象）。面板可能在 shadow root 内，`body[...]` 后代选择器在那里匹配不到。

## 7. 动效

| 场景 | 时长 / 曲线 |
|---|---|
| 行 hover 变色 | 120ms ease-out |
| 展开 / 收起（高度） | 160ms / 120ms，`cubic-bezier(.2,.7,.3,1)` |
| 指针聚焦滑行 | 300ms easeInOutCubic，落点 = 视口 34%（固定焦点线） |
| 点击定位滑行 | `clamp(160, 距离×0.35, 260)` ms，同一曲线 |
| 实时新增行 | 220ms 淡入 + 下沉 4px |

- 两种滑行共用一个 `glideScroll`（同一曲线、可取消）。
- `prefers-reduced-motion: reduce` 下全部直跳；排序 FLIP 也跳过。

## 8. 状态与数据

- **展开即高亮**，不另设"选中"：收起即恢复。
- 排序三态：默认 → 降序 → 升序 → 默认；切换排序保持展开的 Step。
- 空/错误/首屏：骨架行按真实行高铺 10 行，数据到达不跳高。

## 9. 可访问性

矩阵可聚焦，`←/→` 逐 Run 聚焦，`Enter` 定位；Step 行 `role=button` + `tabIndex=0`，`Enter/Space` 切换，`aria-expanded` / `aria-pressed` 标注。
