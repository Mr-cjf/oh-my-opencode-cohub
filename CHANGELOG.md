# CHANGELOG

## [1.11.1] - 2026-07-28

### 修复
- 修复 v1.11.0 中 `install` 覆盖 `opencode.json` 的问题——`readJSON` 不支持 JSONC 格式导致解析失败后创建空对象覆盖全部配置（包括 provider 和 agent）
- 修复 agent model/variant 与 `opencode.json` 存在冲突的问题

### 变更
- agent 架构重构：`opencode.json` 只存 agent 结构（description/mode/prompt），model/variant 由 `oh-my-opencode-cohub.json` 唯一管理，消除一切覆盖冲突
- `co-orchestrator` 改为 `mode: "primary"`，install 自动写入 `default_agent`
- 移除 v1.11.0 引入的 `syncAgentConfigToOpencode` 同步机制

## [1.11.0] - 2026-07-28

### 新增
- 插件启动时自动将 `oh-my-opencode-cohub.json` 中 agent model/variant 同步写入 `opencode.json`，解决 OpenCode 内部配置合并优先级导致用户覆盖不生效的问题（采用原子写入、类型守卫、诊断日志）

## [1.10.3] - 2026-07-25

### 新增
- co-rule-app 代理支持并行分片分析：Orchestrator 可按规则文件数量并行派发多个实例（每实例负责 1-2 个文件），替代原先的串行全量分析

### 变更
- orchestrator.md：新增"规则分析并行策略"指导段落，更新 @co-rule-app 子代理描述
- rule-app.md：从简短描述重写为完整的结构化代理定义，支持接收指定文件子集分析

## [1.10.2] - 2026-07-25

### 新增
- 新增诊断日志工具 `src/utils/log.ts`，异常信息写入 `~/.local/share/opencode/log/oh-my-opencode-cohub.YYYYMMDD.log`，按天轮转保留 7 天

### 修复
- 修复 `messages.169: all messages must have non-empty content` 错误——消息对象 `m.info` 增加可选链、`lastUserMsg.parts` 增加数组防御、`part.text` 安全拼接、`system.transform` 加 try-catch 容错
- 修复 `tracker label` 在 `description` 为空字符串时显示空白标签的问题

### 变更
- 所有 `throw` 异常消息统一加 `[oh-my-opencode-cohub]` 前缀，便于快速溯源
- 12 处静默 `catch {}` 和 `console.warn` 迁移到 `appendLog` 结构化日志文件
- `council.ts` 新增 `promptText` 空值断言防御
- 日志工具增加 `mkdir` 兜底、UTC 时区统一、`escapeRegex` 防御

## [1.10.1] - 2026-07-25

### 修复
- 修复 CI 发布缺失构建步骤导致 dist/ 版本号与源码不一致的问题

### 变更
- 发版技能文档同步更新，构建职责从本地转移到 CI
- 添加 @babel/core 版本锁定（overrides）

## [1.10.0] - 2026-07-25

### 新增
- CLI install 命令添加版本号显示，从 package.json 动态读取当前版本

### 变更
- 产品显示名称统一为 `oh-my-opencode-cohub`

## [1.9.3] - 2026-07-25

### 移除
- 移除 co-guardian 代理及 context-guard 上下文卫士模块（11个文件），回归精简架构

### 变更
- 代理数量从 12 个减少为 11 个
- 移除 context-guard 全部 hooks（event/chat.params/messages.transform/chat.message）
- CLI install 默认配置不再包含 co-guardian

### 修复
- 移除 filterEmptyMessages 幽灵消息过滤逻辑（该方案未能解决 empty content 错误）

## [1.9.2] - 2026-07-25

### 修复
- 修复上下文压缩产生幽灵消息（text part 全空）导致 LLM API 报 `empty content` 错误的问题，在 `messages.transform` 钩子入口添加 `filterEmptyMessages` 过滤

## [1.9.1] - 2026-07-25

### 修复
- chat.message hook 回复改为追加而非清空 parts，避免 LLM API "empty content" 错误

## [1.9.0] - 2026-07-25

### 新增
- messages.transform 末尾注入核心规则：从 orchestrator 提示词动态提取 `<critical_rules>` 并注入到消息末尾，利用 recency bias 对抗长会话注意力衰减

### 变更
- 核心规则注入采用单一事实来源：从 resolved prompt 正则提取，消除硬编码双写，用户覆盖提示词后自动同步

## [1.8.2] - 2026-07-24

### 修复
- Token 累计算法从覆盖改为累加（+=），修复阈值永不触发的问题
- 添加消息去重（防重播事件重复计数）

### 新增
- 上下文卫士菜单新增"稍后提醒"选项，阶梯阈值 20%→40%→60%→80%

## [1.8.1] - 2026-07-24

### 修复
- 安装脚本硬编码 agent 列表缺少 co-guardian，bunx install 无法注册该代理

## [1.8.0] - 2026-07-24

### 新增
- 新增 ContextGuard 上下文卫士模块：20% 阈值时主动弹出三选一菜单（自动压缩 / 会话压缩 / 分析迁移）
- 新增 co-guardian 子代理：启发式分析会话状态，推荐最优上下文处理策略
- CJK 中文 token 修正估算（1.8 chars/token），避免中文文本被低估 2-3 倍
- TUI 面板新增 co-guardian agent 展示

### 变更
- 拆除 PlanGate 方案批准门禁：orchestrator 回归纯提示词 + 用户选择模式
- Background Job Board：getBoardText 返回值类型优化，无任务时不再注入空表格
- oracle 提示词增强：新增 @council vs @oracle 选择指南

### 修复
- event hook sessionID 路径修正（properties.info.sessionID 替代 properties.sessionID）
- chat.message hook 改为 output.parts 直接变异（符合 SDK 类型签名）

### 移除
- 移除 PlanGate 门禁系统（plan-gate.ts / plan-gate-audit.ts 及测试文件）
- 移除 request_plan_approval 工具

## [1.7.0] - 2026-07-23

### 新增
- PlanGate 有界审计日志：记录批准生命周期事件（50 条环形缓冲区 + 原子写入 + fail-open）
- messages.transform 末尾注入核心规则：利用 recency bias 对抗长会话注意力衰减，不持久化

### 修复
- 修复 plan-execute 权限弹窗不弹出：co-orchestrator 配置新增 "plan-execute": "ask" 规则

## [1.6.0] - 2026-07-23

### 新增
- request_plan_approval 自定义工具：通过 OpenCode 原生权限确认框发起方案批准
- PlanApprovalManager 许可租约：generation 机制，新用户消息自动撤销旧批准
- tool.execute.before 可写代理执行门禁：未批准方案时拒绝 co-fixer/co-designer 委派
- system.transform 动态注入 plan gate 状态，每次 LLM 请求刷新

### 变更
- orchestrator 提示词升级：todowrite 状态锁 → 方案批准门禁，覆盖范围扩展至 co-designer
- 替代旧的 RuleInjector 周期性提醒机制（用户可见注入 → 程序化硬门禁）

### 移除
- src/rule-injector.ts：L2 周期性规则提醒注入器

## [1.5.3] - 2026-07-22

### 修复
- 修复 Background Job Board "reusable by alias" 指令导致 orchestrator 误用 alias 作为 task_id，session 复用不生效。重写为正向指引（用 Session ID 列），陈述传 alias 的真实后果（静默创建新 session 而非复用）
- 新增 task_id 防御拦截：非 ses_ 前缀的非法值在 tool.execute.before hook 中直接删除，不依赖 OpenCode 静默兜底

### 变更
- Background Job Board 输出格式重构：Active Jobs 字段重排（agent 在前，alias 后置加 alias= 标注），Reusable Sessions 改为表格格式
- 删除 Board 中未实现的"超时恢复"指令（运行中任务无 sessionId，功能从未存在）
- orchestrator 提示词优化：规则 3 强调"方案检查→使用 co-explorer 搜索→co-librarian 验证方案信息"

### 移除
- Board 中 "Timed-out running sessions are recoverable by alias" 指令（幻影功能）

## [1.5.2] - 2026-07-22

### 修复
- 诊断日志增加自动截断：超过 50KB 保留最后 30 条，防止无限累计

## [1.5.1] - 2026-07-22

### 修复
- 修复子代理上下文提取器使用不存在的 SDK Part 类型名（`tool_call`/`tool_result`），改为 SDK 实际 `type: 'tool'` + `state` 结构，使 Read/Edit/Write 等工具调用信息能正确提取
- 修复 `extractErrors` 中 `||` 短路语义问题，改为显式 `status === 'error'` 判断
- 修复诊断日志硬编码路径，改用 `os.tmpdir()`

### 新增
- 新增 `src/context/extractor.test.ts`，31 个单元测试覆盖 extractRelevantFiles / extractErrors / extractDecisions
- 升级诊断日志：注入完成后记录完整上下文（time/session/subagent/detailsPreview/detailsLen）
- 新增 `npm test` 脚本（`bun test`）

## [1.5.0] - 2026-07-22

### 新增
- L2 规则重注入：RuleInjector 模块，通过 chat.message hook 每 5 轮为 orchestrator 注入规则提醒
- L3 状态锁：规则 4（todowrite 状态锁），委派 co-fixer 前强制检查 todowrite 方案状态
- 自检清单：每次回复前强制逐条确认核心行为准则

### 变更
- orchestrator 提示词重构：核心规则从文件中间移到末尾（利用 recency bias），四条规则用 XML 标签包裹
- 规则 1 增加长会话警告，强调每次新需求必须重新执行分析→方案→确认→执行
- 自检清单从初版 4 条精简为 2 条核心检查
- event hook 拆分 session.deleted 分支，增加 RuleInjector 清理逻辑

## [1.4.0] - 2026-07-21

### 新增
- 子代理上下文共享系统：ContextEngine 完整生命周期，覆盖 registerContext → fillContextAsync → formatContextDetails → captureResult
- 四种上下文策略（none/relevant/summary/full），支持代理级默认 + 任务级 context_override 覆盖
- TaskContext 结构化上下文传播：相关文件、前置决策、错误信息、依赖结果自动在子代理间流转
- `📋 任务上下文` 自动注入子代理 prompt，无需手动拼接

### 修复
- 修复插件所有 hooks 失效：CHINESE_PROMPTS / CHINESE_INSTRUCTION 字符串被 export 导致 getLegacyPlugins() 抛异常
- 修复上下文注入未到达子代理：output.args.description 仅为 session 标题，改为优先写入 output.args.prompt
- 修复 fillContextAsync 竞态条件：异步调用未 await，导致上下文填充未完成子代理已启动
- 修复上下文详情未注入：formatContextDetails 返回值未追加到子代理 prompt
- 修复提取器无法从父 session 提取文件路径：新增文本扫描 + tool_call args 字符串值扫描

### 变更
- 简化 resolveStrategy 三段式条件判断为单行
- 空 catch {} 改为 console.warn 日志输出，避免静默吞错

### 移除
- 移除 CHINESE_PROMPTS / CHINESE_INSTRUCTION 的 export（改为内部常量）

## [1.3.0] - 2026-07-20

### 新增
- 提示词源文件迁移为 Markdown 格式（`src/prompts/*.md`），直接编辑更直观
- 新增 `scripts/generate-prompts.ts`，构建时自动将 .md 转换为 .ts 常量文件
- 用户自定义 .md 覆盖机制现已生效，支持项目级和用户级覆盖

### 修复
- 修复 co-oracle / co-librarian / co-explorer / co-designer / co-fixer / co-observer / co-planner / co-rule-user / co-rule-project / co-rule-app 共 10 个代理使用占位符而非完整提示词的问题
- 修复 `loadFileOverrides()` 死代码，运行时 .md 文件覆盖逻辑现在正确应用

### 变更
- `src/prompts/*.ts` 转为构建时自动生成，不再手动维护
- `package.json` build 脚本前置增加 `bun run scripts/generate-prompts.ts` 步骤
- `.gitignore` 新增 `src/prompts/*.ts` 忽略规则

## [1.2.4] - 2026-07-20

### 新增
- 子代理上下文共享系统：ContextEngine 三阶段流程（构造→注入→捕获），子代理启动时自动获取结构化上下文
- `src/context/` 模块：types / strategy / extractor / formatter / engine，5 个新文件
- 上下文策略：`none` / `relevant` / `summary` / `full`，静态默认 + 运行时 `context_override` 覆盖
- 子代理结果依赖传播：co-explorer 发现自动注入到后续 co-fixer 的上下文
- TaskTracker 自动 reconcile：新一轮任务启动时自动归档旧任务，Board 不再累积
- cancel_task 集成：取消任务立即标记为 cancelled 并从 Board 移除
- server 别名导出：兼容 OpenCode `PluginModule` 类型
- `getJobBySessionId()`：按子 session ID 查找 JobRecord

### 修复
- 防御 `output.args` 为 undefined 导致上下文标记注入 TypeError 被静默吞掉
- `contextConfig` 深合并 strategy 字段，避免用户部分覆盖时丢失默认策略
- `captureResult` 添加 `void` 前缀，消除潜在 unhandled Promise rejection
- `contextCleanupTimer` 在 dispose 中清理
- `CONTEXT_MARKER_PATTERN` 导入替代内联正则，消除重复定义

### 变更
- `JobRecord` 新增 `contextStrategy`、`dependencies` 可选字段
- `AGENTS.md` 补充 `src/context/`、`src/tools/` 目录说明
- 版本号 `1.2.0` → `1.2.4`

## [1.2.3] - 2026-07-20

### 新增
- GitHub Actions CI：推送 `v*` tag 自动构建并发布到 npm（OIDC 认证，零 token 管理）
- 版本一致性校验：CI 自动对比 tag 版本与 package.json 版本

### 变更
- 发版规范更新：使用 `npm version` + `git push --follow-tags` 简化发布流程

## [1.0.18] - 2026-07-15

### 新增
- `council_session` 工具：真正的多模型并行共识（`src/tools/council.ts`，628 行）
- Council 预设系统：支持多组 councillor 配置，可通过 `preset` 参数切换
- 兜底默认配置：无用户配置文件时自动使用 3-councillor 内置预设
- README 新增 Council 多模型共识配置章节（配置表 + 3 个预设示例）

### 修复
- councillors 不再引用不存在的 `councillor` agent，直接指定 model
- 重试逻辑扩展：覆盖 timeout、rate limit、503、429 等瞬态错误
- CLI `install` 自动写入 council 配置和 `council_session` 工具权限

## [1.0.17] - 2026-07-15

### 新增
- orchestrator 提示词新增 `@co-council` vs `@co-oracle` 选择指南（对比表格 + 决策规则 + 场景对照 + 反面教材）

### 修复
- 移除 `.idea/` 目录追踪，已加入 `.gitignore`

### 变更
- 移除 tool.execute.after 中的 DEBUG 日志写入

## [1.0.16] - 2026-07-15

### 新增
- 背景任务事件驱动跟踪：`event` hook 监听 `session.idle/deleted/error` 更新任务状态
- 30 分钟超时兜底清理（`setInterval` + `cleanupStaleJobs`）
- `extractChildSessionId`：从 tool output 提取子任务 session ID
- `updateByChildSessionId`：按子 session ID 精确匹配更新任务状态

### 修复
- 背景任务在 `tool.execute.after` 中被过早标记为 `completed` 的问题
- task 调度后 sessionId 匹配断裂问题

## [1.0.15] - 2026-07-14

### 修复
- `co-orchestrator` prompt 从简短占位文本改为完整 `ORCHESTRATOR_PROMPT` + 中文语言指令
- Agent 新增 `agent` 字段直接返回，确保 HTTP 服务器模式（Desktop App）兼容

## [1.0.14] - 2026-07-14

### 修复
- Agent 仅通过 `config` hook 注册导致 HTTP 服务器模式下不显示的问题
- 改为双重注册：`agent` 字段返回 + `config` hook 写入

## [1.0.13] - 初始发布

- 12 个 `co-*` 中文代理（co-orchestrator、co-oracle、co-librarian 等）
- 纯调度模式：Orchestrator 只使用 task/todowrite，文件操作全部委派子代理
- 中文注入：`experimental.chat.system.transform` 推送中文指令
- Background Job Board：`experimental.chat.messages.transform` 注入任务跟踪面板
- TUI 侧边栏面板
- CLI `install` / `uninstall` 命令
