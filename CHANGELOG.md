# CHANGELOG

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
