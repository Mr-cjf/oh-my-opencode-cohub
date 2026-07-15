# 全分支代码审查修复报告

## 状态：✅ 已完成

## 修复的问题

| ID | 等级 | 问题 | 修复 |
|----|------|------|------|
| C1 | Critical | `constructContext` 全异步导致竞态 — 标记迟于工具启动注入 | 拆分为 `registerContext`（同步注册+立即注入标记）+ `fillContextAsync`（异步填充） |
| C2 | Critical | `constructContext` 异步调用中的 `.then()` 回调在 `output.args.description` 已被消费后才修改 | C1 修复后标记在同步路径中立即注入，填充不再阻塞 |
| C3 | Critical | `tool.execute.before` 中策略解析使用 `contextConfig.strategy` 而非 engine 的合并策略 | 改用 `contextEngine.getStrategy(subagentType)` 获取深度合并后的策略 |
| I1 | Important | `captureResult` 无 `void`/`catch`，可能产生未捕获的 Promise 拒绝 | 添加 `void` 前缀（event hook）；`.catch(() => {})`（tool.execute.before 中的异步填充） |
| I2 | Important | ContextEngine 构造函数浅合并策略字典 — 用户配置会覆盖整个 strategy 对象 | 改为深度合并：`strategy: { ...DEFAULT_CONTEXT_CONFIG.strategy, ...config?.strategy }` |
| M1 | Minor | 上下文清理定时器未保存引用，dispose 无法清理 | 保存为 `contextCleanupTimer`，在 `dispose` 中添加 `clearInterval(contextCleanupTimer)` |
| M2 | Minor | `consumeMarkedContext` 内联正则与 formatter 里的 `CONTEXT_MARKER_PATTERN` 重复 | 从 `./formatter` 导入 `CONTEXT_MARKER_PATTERN` 替代内联正则 |

## 变更文件

| 文件 | 变更类型 | 行数变化 |
|------|---------|---------|
| `src/context/engine.ts` | 重构 + 增强 | +52/-38 |
| `src/index.ts` | 修复 | +29/-13 |

## 构建结果

- `npm run build`：✅ 通过
- 测试套件：跳过（项目无 test script）
