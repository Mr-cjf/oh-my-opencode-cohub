# CHANGELOG

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
