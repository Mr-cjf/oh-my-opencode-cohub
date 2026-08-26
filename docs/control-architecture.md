# CoHub 多级分层控制架构（T10 架构文档）

> 文档性质：只读产出。基于当前仓库快照撰写，不修改任何业务代码。
> 依据源码：src/index.ts、src/tools/council.ts、src/task-manager/、src/context/、src/prompts/（orchestrator / council）。
> 落点标注约定：`文件:行号` 或 `文件 函数名`。标注为【现状】表示已实现；标注为【改进点】表示当前缺失、属于规划项。

---

## 1. 三层职责表

CoHub 的三层控制架构并非三个独立进程，而是由「提示词角色定义 + opencode 工具权限 + hook 管线段」组合实现的职责分层。三层与权限边界如下：

| 层 | 主体 | 职责 | 权限边界 | 代码落点 |
|---|---|---|---|---|
| 编排层 | co-orchestrator（primary agent） | 调度决策：分析需求 → 委派信息收集 → 委派 @co-planner 制定方案 → 审核 → todowrite 创建任务 → 调度执行 → 委派验证；汇总各子代理结果 | 仅允许调度工具（task / todowrite）；禁止任何文件/代码操作工具（read/grep/glob/bash/edit/write），硬性规则见 orchestrator 提示词 | 【现状】src/prompts/orchestrator.md（角色/工作流/硬性规则 1-3）；src/index.ts:350-401（agent 注册，L366 默认兜底 co-orchestrator） |
| 代理层 | 12 个专职代理：co-orchestrator、co-oracle、co-librarian、co-explorer、co-designer、co-fixer、co-observer、co-council、co-rule-user、co-rule-project、co-rule-app、co-planner | 按自包含任务执行：只读研究/搜索/审查/规则分析/方案制定（9 个只读类）、读写执行（co-fixer 代码修改、co-designer UI/UX）、多模型共识（co-council）；返回结构化结果 | 各代理提示词定义自己的工具边界：只读类代理不得写文件；co-fixer/co-designer 可读写；council_session 工具权限仅 co-council 独享（其余 11 个代理配置层 deny） | 【现状】src/index.ts:224（co-council permission: council_session allow）；src/index.ts:342-349（agentConfigs 组装，集中对 11 个非 co-council 代理统一注入 council_session deny）；src/index.ts:361-402（config hook 对 permission 做键级合并并强制写回 allow/deny）；src/prompts/*（12 组提示词，.ts + .md 各一） |
| 工具层 | co-tool（唯一工具执行者）+ 平台工具面（task 工具、council_session 工具、只读工具集、上下文引擎） | 文件读写/搜索/命令执行（co-tool）；并行多模型调用与超时/重试（council）；任务注册与状态跟踪（tracker）；上下文提取与注入（context engine） | co-tool 只执行不决策、不规划；council 子会话只开放只读工具（读写/edit/bash 全部置 false）；council_session 仅允许 co-council 代理调用（配置层 permission + 运行时白名单双重保证） | 【现状】src/index.ts:403-499（tool.execute.before/after hook：task 注册、状态更新、上下文注入）；src/index.ts:361-402（config hook 对 permission 键级合并写回，构成配置层可见性控制）；src/tools/council.ts:518-526（只读工具集）、L990-997（运行时 context.agent 白名单校验，纵深防御兜底）；src/task-manager/tracker.ts（TaskTracker）；src/context/*（ContextEngine） |

**层间关系**：编排层只下达目标与检查点（目标协调）；代理层在自包含 prompt 内自治执行（局部自治）；工具层是唯一的动作执行面与信息采集面，同时是反馈回路的数据源（见第 2 节）。

---

## 2. 反馈回路位置图/表

### 回路 1：任务完成事件 → 质量判定 → 决策输入（闭环【现状：完成事件与结果回送已实现；质量判定仅雏形】）

```
task 派发
  → tool.execute.before（index.ts:403，L415 tracker.registerBeforeTask 注册任务；L424-473 上下文构建与注入）
  → 子代理执行
  → 完成事件：tool.execute.after（index.ts:481-499，L493 updateAfterTask 标 completed）
                 / event hook session.idle（index.ts:502-527，L508 → L515 contextEngine.captureResult）
  → 结果捕获：captureResult（src/context/engine.ts），截取子代理最终 assistant 输出前 500 字符存入 dependencyCache
  → 决策输入：fillContextAsync（engine.ts）提取 relevantFiles/decisions/errors/dependencies
               → formatTaskContext（src/context/formatter.ts）格式化
               → messages.transform hook（index.ts:530-612）消费 CONTEXT 标记并注入后续子代理
```

| 环节 | 落点 | 说明 |
|---|---|---|
| 任务完成事件 | 【现状】src/index.ts:481-499（tool.execute.after）、src/index.ts:502-527（event hook，session.idle L508 / session.deleted L517 / session.error L520） | 非背景任务在 after hook 标记；背景任务等 session.idle |
| 结果捕获 | 【现状】src/context/engine.ts captureResult() | 最后一条 assistant 消息前 500 字符作为 keyOutput；失败静默 |
| 质量判定 | 【现状-雏形】src/context/engine.ts captureResult()（长度截取）+ src/prompts/orchestrator.md 工作流第 5 步（co-fixer 编译测试 → co-oracle 代码审查 / co-designer UI 审查并行，发现问题重新委派）；【改进点】src 内 quality/feedback 关键词零命中——无独立质量评分模块 | 当前质量把关在提示词层的验证步骤，非代码化判定 |
| 决策输入 | 【现状】src/context/engine.ts fillContextAsync()（extractRelevantFiles / extractDecisions / extractErrors，见 src/context/extractor.ts）；src/context/formatter.ts（标记替换）；src/index.ts:530-612（messages.transform 消费） | 前置决策/错误/依赖注入后续子代理，形成决策闭环 |

### 回路 2：council 收敛判定

| 环节 | 落点 | 说明 |
|---|---|---|
| 并行执行 | 【现状】src/tools/council.ts:379-419 runCouncillors() | parallel 模式 Promise.allSettled，serial 模式逐个；配置 councillor_execution_mode 默认 parallel（index.ts:279） |
| 超时控制 | 【现状】src/tools/council.ts:107-154 promptWithTimeout()；默认 timeout 180s（L343） | 超时 abortSession 回收子会话，状态 timed_out（L455） |
| 收敛判定 | 【现状-提示词层】src/prompts/council.md（co-council 综合流程：逐一审查 → 识别一致/矛盾 → 解决矛盾 → 综合 → 共识信心评级「一致/多数/分歧」）；【改进点】src/tools/council.ts 代码层 consensus/converge/agree 零命中——无代码级一致度计算，收敛完全由 LLM 提示词承担 | 任务 P1「一致度判据」即针对此缺口 |
| 失败兜底 | 【现状】src/tools/council.ts:359-365（全部失败 → error）；L619-623（footer 完成统计 completed/total councillors responded） | 失败信息回传给 co-council，由其按原始提示词单独作答 |

### 回路 3：重试预算

| 环节 | 落点 | 说明 |
|---|---|---|
| councillor 级重试 | 【现状】src/tools/council.ts:425-469 runCouncillorWithRetry() | totalAttempts = 1 + maxRetries（L433）；仅对 'Empty response from provider' 重试（L448-449）；councillor_retries 默认 3（index.ts:280） |
| 任务级超时清理 | 【现状】src/task-manager/tracker.ts cleanupStaleJobs()；src/index.ts:324-332（30 分钟清理定时器，每 30s 执行） | 超时背景任务标 errored |
| 全局预算 | 【改进点】budget 关键词零命中——仅有 councillor 单层重试预算，无任务级/会话级预算限幅 | 任务 P1「预算限幅」针对此缺口 |

### 回路 4：参数自适应

| 环节 | 落点 | 说明 |
|---|---|---|
| 上下文策略选择 | 【现状】src/context/strategy.ts resolveStrategy()（优先级：task 覆盖参数 > 代理默认配置 > none） | 已有参数面，但为静态配置 |
| 静态策略表 | 【现状】src/context/types.ts DEFAULT_CONTEXT_CONFIG（co-fixer/co-designer/co-planner=relevant；co-oracle/co-council=summary；其余 none） | 无运行时调整 |
| 模型/变体覆盖 | 【现状】src/index.ts:350-401（hub config 的 model/variant 覆盖链） | 静态覆盖 |
| 动态自适应 | 【改进点】adaptive 关键词零命中——未实现基于反馈的自动参数调整 | 任务 P2「参数自适应」针对此缺口 |

---

## 3. 改进点归属

改进点按「影响面」归属到三层；标注现状依据。

| 优先级 | 改进点 | 归属层 | 现状依据 / 缺口 |
|---|---|---|---|
| P0 | 质量回送（任务结果质量评分并回送决策输入） | 代理层（判定者）+ 工具层（回送通道） | 【现状】captureResult（engine.ts）仅截取 500 字符，无质量评分；【缺口】需在捕获处增加质量判定，或将 co-oracle 审查结果代码化回送 |
| P0 | 误差驱动决策表（由错误统计驱动后续调度决策） | 编排层 | 【现状】extractErrors（extractor.ts）已提取错误注入子代理，但决策表逻辑属调度决策，当前由 orchestrator 提示词人工判断；【缺口】需代码化误差→决策映射 |
| P1 | 一致度判据（council 代码级收敛判定） | 工具层 | 【现状】收敛在提示词层（council.md 综合流程）；【缺口】src/tools/council.ts 无 consensus 算法 |
| P1 | 预算限幅（任务/会话级重试预算） | 编排层（任务预算）+ 工具层（council 重试） | 【现状】仅 councillor 单层重试（council.ts:425-469）+ 30 分钟超时清理（index.ts:324-332）；【缺口】budget 零命中 |
| P1 | TUI 退避（状态同步写入节流） | 编排层 | 【现状】src/index.ts syncTrackerState()（约 L115）定时全量写 tracker-state.json；【缺口】无退避/增量同步 |
| P2 | summary 控噪（上下文摘要噪音控制） | 工具层 | 【现状】extractor.ts summary 规则（oldString 优先于 output 前 100 字符）；【缺口】无噪音过滤/去重策略 |
| P2 | 模型前馈降级（模型不可用时的降级链） | 编排层 | 【现状】src/index.ts:350-401 覆盖链 + council parseModelReference 校验（council.ts）与超时降级；【缺口】无系统化前馈降级（模型 A 失败 → 模型 B） |
| P2 | 参数自适应（基于反馈动态调参） | 编排层 + 工具层 | 【现状】strategy.ts resolveStrategy + DEFAULT_CONTEXT_CONFIG 静态；【缺口】adaptive 零命中 |
| P2 | 指标统计（完成率/耗时/失败率） | 工具层 | 【现状】tracker.ts 已采集 running/completed/errored/cancelled 与 createdAt；【缺口】无聚合统计与指标输出 |

**归属原则**：凡涉及「调度决策、目标设定、资源分配」归编排层；凡涉及「执行质量、结果判定、参数规则」归代理层；凡涉及「动作执行、数据采集、算法计算」归工具层。

---

## 4. 设计原则

1. **上层协调目标、下层局部自治**
   - 编排层只承担「分析 → 委派 → 审核 → 调度」的目标协调，通过 orchestrator 提示词（src/prompts/orchestrator.md）与 task/todowrite 工具实现；每个子代理拿到自包含的完整 prompt 独立执行（src/prompts/*），不依赖编排层逐步干预。
   - 上下文引擎只做信息注入（fillContextAsync → messages.transform），不做子代理的决策干预——注入信息、不干预决策，是「协调目标」与「局部自治」的分界线。

2. **已知扰动前馈预补偿 + 未知偏差反馈修正**
   - 前馈预补偿：在派发前把已知状态注入子代理——前置决策（extractDecisions）、相关文件（extractRelevantFiles）、依赖结果（captureResult → dependencyCache → fillContextAsync）、上下文标记消费（src/index.ts:530-612）。已知扰动（决策/错误/依赖）在任务开始前补偿，避免子代理重复探索。
   - 反馈修正：任务完成后通过 session.idle / tool.execute.after 捕获实际结果与错误（captureResult、extractErrors），回送为后续子代理与编排决策输入；council 失败统计（council.ts:619-623）与重试（runCouncillorWithRetry）同样属于反馈修正通道。未知偏差由实测结果修正，而非预测。

3. **权限最小化**
   - 编排层无文件工具（orchestrator 硬性规则 2）；council 子会话只读（council.ts:518-526）；council_session 配置层仅 co-council 可调——唯一 allow 显式写于 co-council 的 permission（index.ts:224），其余 11 个代理在 agentConfigs 组装处统一注入 deny（index.ts:342-349），并由 config hook 做 permission 键级合并、强制写回 allow/deny（index.ts:361-402）防止用户 opencode.json 其他键误覆盖；运行时再以 context.agent 白名单兜底（council.ts:990-997），即使配置被覆盖也能拦截。co-tool 是唯一工具执行者。权限边界由「配置层可见性控制（permission）+ 运行时校验（council.ts）」双重保证。

4. **回环短、失败可观测**
   - 每次任务完成即触发状态更新（tracker）与结果捕获（captureResult），回路周期短；失败以 errored / timed_out / cancelled 状态与 footer 统计显式暴露（tracker getBoardText / council footer），供编排层与 TUI 观测。
