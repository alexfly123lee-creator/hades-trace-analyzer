# 计时核查报告：Trace Lab vs 官方轨迹

> 触发问题："面板里出现了 3000 多秒、甚至 9000 多秒，我用的时候没有这种感觉。"
> 结论：**两个真 bug（都已修）+ 一个口径差异（不是算错）。**

参考会话：`session-f4e4fa41…`（135 run / 1983 step / 14451 事件，2026-11-15 23:5x 快照）。

---

## 一、结论先讲

1. **9000+s / 3000+s 出现在 run 行，是两个 bug 叠加的结果**：
   - **Bug A**：把"下一条用户消息的入队事件"`agent/inbox/spliced` 粘到了上一回合的最后一步 → run 跨度被拉到"用户下次开口"的时刻（run 16 = 9,677s、run 65 = 35,425s）。
   - **Bug B**：会话恢复后日志会**重复投递 `tool/result`**，配对时取了最后一个 → 同一个工具调用的耗时被算成"到几小时后的重复结果"（最长 **54,413s**，`最慢操作` KPI 因此失真）。
2. **step 行最大 820s，而且全部是"等用户 / 等审批"的工具等待**（`ask_user_question` 785s、`plugin_manager` 审批 682s、`exit_plan_mode` 审批 396s…），不是模型慢、也不是算错。
3. ~~与官方轨迹口径不同~~ → **已按官方对齐（2026-11-15 晚）**：step 耗时改为**模型调用耗时**（`step/start` → `assistant/message`），工具执行与等人时间都不计入；独立重算官方公式逐步对比 **1993 步、0 差异**。

---

## 二、Bug A：跨回合粘附

原始日志（seq 956–970，`+Ns` 相对 seq 950）：

```
955  +80.3s   step/end                turn=15 step=1
956  +80.3s   turn/end                turn=15
957  +96.2s   agent/inbox/spliced          ← 下一条用户消息入队（本回合已结束）
958  +96.2s   turn/start              turn=16
959  +96.2s   agent/inbox/spliced
960  +96.3s   step/start              turn=16 step=1
961  +96.3s   user/message                 ← 真正的用户输入
966  +9773s   agent/inbox/spliced          ← 2.7 小时后的下一条消息
```

旧逻辑：无 `data.step` 的事件一律挂"当前 run 的最后一个 step"。于是 seq 966 的 spliced（2.7 小时后）落到了 **run 16 的 step 1**，把该 run 的跨度拉成 2.7 小时。

修复（`lib/aggregate.js`）：

| 改动 | 说明 |
|---|---|
| 丢弃 `agent/inbox/spliced` | 它是"下一条用户消息的入队"，永远不属于当前 step（真正的 `user/message` 开新 run） |
| 引入 `tailStep` | 回合尾部事件（`workspace/changes` 等）只挂到**本回合刚结束的那一步**；`turn/start` / `turn/end` 即清空 |
| run 跨度 = 各步窗口并集 | 叶子时间只作为"无标记 step"的兜底 |

| run | 修复前 | 修复后 |
|---|---|---|
| run 65 | 35,425s（9.8h） | **408s** |
| run 132 | 10,768s（3.0h） | **120s** |
| run 16 | 9,677s（2.7h） | **30s** |
| run 127 | 6,188s | **40s** |
| run 1 | 3,630s | **3,339s**（66 步，见下） |

run 1 的 3,339s 是真的：66 步窗口合计 3,338s、步间空档仅 1s，其中 **2,297s（69%）** 是三个"等人"的 step（两次 `ask_user_question` 共 26 分钟 + 一次插件安装审批 11 分钟）。

修复后：`runs > 1h` 为 **0**；最长 run = 3,339s（55.7 min）。

---

## 三、Bug B：重复投递的 tool/result

```
tool/call   #30  @05:14:35.081  callId=call_01_Bp1…
tool/result #33  @05:14:35.109  callId=call_01_Bp1…   ← 真正的结果（28ms）
tool/result #1763 @12:48:01.653 callId=call_01_Bp1…   ← 恢复会话后重复投递
```

旧逻辑 `results.set(callId, event)` 后写覆盖，配对拿到的是 7.5 小时后的那份 → `durationMs = 27,207s`。

修复：**同一 `callId` 只取第一个 result**，且 `durationMs = max(0, result.time − call.time)`。

| 指标 | 修复前 | 修复后 |
|---|---|---|
| 工具耗时 > 10min 的调用 | 48 个 | **3 个**（785s / 784s / 682s，全是真等人的工具） |
| 最长工具耗时 | 54,413s（15h） | **785.4s** |
| `最慢操作` KPI | 失真的小时级 | `ask_user_question` 785.4s |
| 工具时长 > 步窗口 的 step | 42 个 | **1 个**（run1/29，20s vs 15s，疑似并行工具） |

---

## 四、官方轨迹的计时口径（源码依据）

官方包 `@deepseek-ai/dsh-client-ui-trajectory`（app.asar 内）：

| 位置 | 代码 | 含义 |
|---|---|---|
| `trajectory-assistant-definition.ts` `start:` | `match.event.type !== 'step/start'` → 抛错，`initialState(turn, step, seq, time)` | assistant 步**从 `step/start` 开始** |
| 同上 `timing` | `{ stepStartTime: state.startTime, firstTokenTime, completedTime: event.time }` | 完成时间 = **`assistant/message` 的 time** |
| `TrajectoryTable.tsx` `totalTime()` | `completedTime − stepStartTime` | **总耗时 = 模型调用耗时（含 TTFT）** |
| 同上 `firstToken()` / `generationTime()` | `firstTokenTime − stepStartTime` / `completedTime − firstTokenTime` | 首 token / 生成 |
| `layout.ts` 工具记录 | `timeSeconds = completedAt − startedAt`（call → result） | **工具耗时单独计在工具行** |

即：官方"step 耗时"= 模型这一跳多慢；工具执行和等人等待只出现在工具记录上。

## 五、同批 step 对比

| run/step | 官方口径（模型） | 本插件（墙钟） | 差值来源 |
|---|---|---|---|
| 1/9 | 34.9s | 820.3s | `ask_user_question` 785.4s |
| 1/23 | 7.7s | 791.4s | `ask_user_question` 783.7s |
| 1/45 | 4.6s | 686.4s | `plugin_manager` 审批 681.8s |
| 83/3 | 15.1s | 411.5s | `exit_plan_mode` 审批 396.4s |
| 80/14 | 18.9s | 285.6s | `exit_plan_mode` 审批 266.7s |
| 84/1 | 25.1s | 238.8s | `exit_plan_mode` 审批 213.7s |
| **39/2** | **200.8s** | 201.5s | 真·慢模型（工具 0.7s），两边都大 |
| 43/1 | 66.5s | 158.5s | `ask_user_question` 92.1s |
| 42/5 | 8.0s | 128.1s | `pwsh` 120.0s |
| 75/6 | 40.6s | 125.1s | `exit_plan_mode` 84.5s |

分布（1980 步）：墙钟中位数 3.92s、模型中位数 3.29s；**>60s**：墙钟 44 步（2.2%）/ 模型 31 步（1.6%）；**>600s**：墙钟 3 步 / 模型 0 步。只有 6.7% 的 step 是"工具 > 模型"。

## 五之二、run 1 为什么是 55 分钟（拆解）

run 1 = 第一个用户指令（"我用了系统自带的 trace 记录面板……"，2026-11-14 05:14:27 → 06:10:06），66 个 step：

| 段 | 时长 | 占比 | 构成 |
|---|---|---|---|
| 模型调用 | 1070.1s（17.8min） | 32% | 66 次模型调用的 step/start → assistant/message |
| **等你回答/审批** | **2251s（37.5min）** | **67%** | `ask_user_question` 785.4s + 783.7s；`plugin_manager` 安装审批 681.8s |
| 其它工具 | 28s（0.5min） | 1% | read/edit/write/grep 等 |
| 步间空档 | 1s | ~0% | — |
| 合计（墙钟） | 3338s（55.6min） | 100% | — |

也就是说：**这个 run 的"执行"其实只有 18.3 分钟**（模型 17.8 + 工具 0.5），另外 37.5 分钟是你在回答问题、点审批。官方轨迹按"模型耗时"显示，等价于 17.8 分钟——和你的体感一致。

会话级（全部 135 run、1980 步）的同一拆分：

| 段 | 时长 | 占比 |
|---|---|---|
| 模型调用 | 15,527s（258.8min） | 76% |
| 等人（提问/审批） | 3,523s（58.7min） | 17% |
| 其它工具 | 1,168s（19.5min） | 6% |
| 未归属（调度/收尾） | 135s（2.3min） | 0.7% |
| 合计 | 20,354s（339.2min） | 100% |

> 注：界面上现在若仍显示 **3,629.9s**，那是修复前的缓存值（旧代码 3630s）；刷新后应为 **3,339.2s**，但它仍是"墙钟"，不是"执行"。

### 口径问题（需要决策）

- 现在的 `run.time / step.timeMs` = **墙钟跨度**（含等人）；
- "执行时间"应 = **模型 + 工具**（排除等人）；
- 建议：行上主数字改为工作耗时，等人时间单独标记（`⏸ 37.5min`），概要区给三段完整拆分；检测依据：`ask_user_question` 的调用→结果、`approval/asked`→`approval/decided`、以及等审批类工具（`exit_plan_mode` / `plugin_manager` 安装）的长时间阻塞。
## 六、最终口径（已落地）：模型 + 工具，等待单列

官方轨迹其实有**两处时间**，我上一轮只对齐了其中一处：

| 官方位置 | 公式 | 含义 |
|---|---|---|
| **Step 组头**（`layout.ts groupDescription`） | `max(组内记录时间) − min(...)`，工具记录按 call→result 展开 | **含工具执行**的墙钟跨度 + 工具直方图（`bash×6`） |
| **assistant 详情**（`TrajectoryTable.totalTime`） | `completedTime − stepStartTime` | 仅模型调用 |

所以"轨迹里工具时间也放上了"指的就是**组头那一行**。本插件现在把两者合成一个数、并把"等人"剥出来：

- `modelMs` = `assistant/message − step/start` → 与官方 assistant 总耗时**逐值一致**；
- `toolMs` = Σ 工具 `durationMs`（剔除人机等待）→ 与官方工具记录的 `timeSeconds` 一致（等待步除外）；
- `waitMs` = `ask_user_question` / `exit_plan_mode` / `plugin_manager` 且 ≥5s 的时长 → **单独标记 `⏸`，不加入耗时**；
- `timeMs = modelMs + toolMs`（行上数字与时间条）；`run.time = Σ 各步 timeMs`。

| | 上一轮（只有模型） | 现在（模型 + 工具） |
|---|---|---|
| run 1 | 1,070.1s（17.8min） | **1,097.7s（18.3min）** |
| 39/2（真慢工具/模型） | 200.8s | **201.5s** |
| 1/9（等你 13 分钟） | 34.9s | **34.9s + ⏸ 785.4s** |
| 全会话合计 | 15,794s | **16,972s（+ 等待 3,556s）** |

## 七、与官方模块的对齐验证（两段都验）

`mockup/verify-traj-align.mjs` 不经过本插件的树，直接用官方公式从原始日志重算：

```
对齐步数 2030（跳过无 assistant 消息的步：21）
模型段不一致（>1ms）：0                           合计 15,794.07s = 15,794.07s
工具段不一致（>1ms）：14                          ← 正是「等人」步
   工具 我们 1,177.63s / 官方 4,733.84s
   差额 = waitMs 3,556.21s → 4,733.84 − 3,556.21 = 1,177.63 ✓
执行 = 模型 + 工具 = 16,971.70s（等待另计 3,556.21s）
payload run.time 合计 16,971.70s = 各步之和 ✓
```

也就是：**模型段与官方完全相等；工具段与官方的差额精确等于我们单列的"等待"** —— 不是口径漂移，而是你要的"把等人拿掉"。
## 八、验证

```
node --test                   38/38 通过
离线 P01–P11                  9/9 通过（P02 35.9 ms，P04 8.2 KB，P06 基线一致）
live /bench (port 59087)      hostRev m8.5 · 135 run / 1983 step · warm /runs 36.9 ms
                               payload 45.4 KB · /run detail p90 8.2 KB · /step p95 2.0 KB
```
