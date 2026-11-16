# 对话变卡：是不是 Hades Lab 带来的？—— 实测与分析

> 结论先说：**聊天界面里我们的 React 树根本不存在**（槽位 `only: viewId`），插件也没有任何定时器或会话事件订阅；
> 现在能测到的 Host 开销是"打开/刷新面板时一次性 ~50 ms"，以及最多 ~47 MB 的快照缓存。
> 这个会话本身有 **4.62 MB assistant 文本 / 2360 条消息 / 1351 个代码块**，那是内置对话视图自己的成本。
> 下面每条都有出处，最后给了 5 项仍值得做的优化和自测方法。

## 1. 证据一：聊天时我们的视图没有被渲染

`conversation.view` 是一个 **list 槽**，"rendered one at a time"（实时 Slot 目录原文）：

```
conversation.view  kind=list  purpose="Registered Conversation target Views, rendered one at a time."
  occupants: chat(order 0) · trajectory(order 10) · hades-eye(order 11)   ← 我们的
```

渲染方源码（`@deepseek-ai/dsh-client-ui-conversation` → `DefaultConversationViews.tsx`，从 `app.asar` 取原文）：

```tsx
const viewId = view ?? active?.id
return (
  <div className={css.viewArea}>
    {viewId !== undefined && renderSlot('conversation.view', {...}, { only: viewId })}
  </div>
)
```

`only: viewId` ⇒ 只有当前选中的那一个视图会被渲染。**选着「对话」时，`hades-eye` 的组件树不在 DOM 里**，
它的 `useState/useLayoutEffect`、146 行 run 表、`getBoundingClientRect` 全都不跑；反过来我们占着屏幕时聊天的树也不在。

## 2. 证据二：客户端没有"持续成本"

`dsh-trace-analyzer/client.js` 里：

| 项目 | 实测 |
|---|---|
| `setInterval` / `setTimeout` / `requestAnimationFrame` | **0** |
| 会话事件订阅（`ctx.on` / `useSession` 之类） | **0**（只用 `ctx.slots` + `ctx.locale`） |
| `fetch` 调用点 | 4 处：进面板 `/runs`（每会话 1 次，命中缓存则 0 次）、展开 run `/run`、展开 step `/step`、点「原文」`/event` |
| 首屏下行 | **49.1 KB/会话**（`/runs` 实测），浏览器缓存同量级 |
| 单步内容 | 平均 **1.4 KB**（p95 2.0 KB，max 7.5 KB），只有点开的那步才请求 |
| 模块顶层副作用 | 只有 `require('react')` + 常量定义 |

`load` 的依赖是 `useCallback(..., [sessionId])`、`useEffect(() => load(false), [load])` ⇒ **每个会话只请求一次**，不会因为父组件重渲染而重新取数。

## 3. 证据三：Host 侧的真实开销（都发生在"打开面板"那一刻）

| 动作 | 实测 | 说明 |
|---|---|---|
| `/runs` 冷构建（17.4k 事件） | **~46–67 ms**（暖态缓存命中 **5.9 ms**） | 单线程 Host 上一次同步聚合，这期间流式/日志会让路 |
| `/run`（一次展开） | 6–30 ms | 只序列化该 run 的 step 索引 |
| `/step` | 1.4 KB / 次 | 按需 |
| 快照缓存 | **5.9 MB / 条 × `SNAPSHOT_MAX=8` ≈ 上限 47 MB** | 键 = `inspectSession(s => s.seq)`；live 会话 seq 每来一个事件就变 ⇒ 反复重建 + 旧条目等 GC |
| `/health` 探针（60 次往返） | p50 **7.0 ms** / p90 7.3 ms / max 36.9 ms | Host 事件循环现在是健康的 |

`SNAPSHOT_MAX=8` 对 live 会话是"低命中高占用"：同一个会话连续打开面板，seq 一变就要重算，缓存里堆着 8 个不同 seq 的 5.9 MB 快照。

## 4. 证据四：这个会话本身有多大

| 指标 | 数值 |
|---|---|
| 事件 | 17 425 |
| assistant/message | 2 360 条，文本合计 **4.62 MB** |
| 最长单条 | **51.0 KB** |
| 代码块 | 1 351 个（每个都要走 markdown + 语法高亮） |
| user/message | 261 条 |
| 进程 RSS | 本机 6 个 `DeepSeek Harness` 进程合计 ~1.8 GB，最大一个 **893 MB**（GUI 渲染进程量级；未逐进程归属） |

内置对话视图按视口做可见性钩子（`conversation.chat.flow` 的 "viewport-bound visibility hooks"），但**单个消息 51 KB、1351 个代码块**意味着：滚动到长消息时要做一次大 markdown 解析 + 高亮；流式输出时，正在增长的那条消息每次增量都会重新解析。这是内置 chat 的成本，和插件无关。

## 5. 判定

| 现象 | 是不是插件 | 依据 |
|---|---|---|
| 聊天时一直卡 / 打字延迟 | **不是**（结构上不可能） | `only: viewId`，我们的树未挂载；客户端 0 定时器、0 订阅 |
| 打开 Hades Lab 那一下、或点开一个 200+ 步的 run 会卡顿 | **是**（一次性） | Host 聚合 ~50 ms；客户端一次渲染 146 行 + 展开 run 的 200+ step 行 |
| 切回聊天后仍然卡、越用越卡 | **大概率不是**，但值得验证 | 可能是渲染进程内存（893 MB）与 GC；也可能就是会话体量 |
| 流式输出时卡顿 | **不是**（插件无逐 token 路径） | 同上；chat 自己在重解析 growing message |

## 6. 仍值得做的 5 项优化（按性价比）

1. **快照缓存改成每会话 1–2 条**（`SNAPSHOT_MAX` 语义从"全局 8 条"改为"每会话 1 条、全局上限 4 条"）
   → Host 常驻内存 47 MB → ~12 MB，减少 GC 抖动；命中率不变（因为旧 seq 的快照本来就基本复用不到）。
2. **`/runs` 聚合分片**：每 500 个事件 `await Promise.resolve()` 让出一次事件循环 → 50 ms 的同步块切成 ~10 个 5 ms 小块，流式不再被单独卡住（代价：总耗时 +5%）。
3. **客户端把展开上限收住**：一个 run 展开时 step 行 > 60 条就折叠为"显示前 60 步 / 展开全部"；避免 200+ 行一次性挂 DOM。
4. **切走时取消在途请求**：`fetchPayload` 加 `AbortController`，组件卸载时 abort（现在只是 `cancelled` 标志，请求仍会跑完并占用连接）。
5. **给插件加自测埋点**：`performance.mark('hades-eye:runs-render')` + `/health` 里回报最近一次渲染耗时，卡顿时能直接看是不是我们。

## 7. 怎么验证（不需要我盯着你的屏幕）

```powershell
# 1) Host 事件循环是否健康（现在是 p50 7 ms）
node mockup/bench-live.mjs --url http://127.0.0.1:<port>

# 2) 我们视图不在聊天里时的成本 = 0（这条是结构性的，改代码才会变）
# 3) 对照实验：禁用插件 → 重开 GUI → 只用内置对话下一轮，感受是否仍然卡
```

如果第 3 步仍然卡，那就是会话体量/渲染进程的问题，插件这边只能帮倒忙不能帮正忙；
如果禁用后明显变好，请告诉我**卡的具体时刻**（流式中？滚动时？切 tab 时？打开 Hades Lab 之后？），我按第 6 节的清单逐项量化。

## 8. 附：本次测量用的脚本

| 脚本 | 输出 |
|---|---|
| `mockup/measure-memory.mjs` | 快照条目内存、`/runs` 下行、`/step` 全量 |
| `mockup/bench-live.mjs` | live 会话 P01/P02/P09/P10/P11 |
| `mockup/asar-scan.mjs` | 从 `app.asar` 里取槽位渲染源码（本次结论的证据一） |
