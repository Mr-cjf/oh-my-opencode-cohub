# Git 工作流

> **规范源**: 团队约定（工具无关）
> **同步规则**: 规范源 checklist 更新时，本文件同步更新。

## 执行清单

> 强制性规范。缺失任一项视为任务未完成。

- [ ] 提交信息格式：`<type>: <描述>`（feat/fix/refactor/docs/test/chore/ci/perf）
- [ ] PR 前用 `git diff main...HEAD` 审查全量差异（不只是最后一次提交）
- [ ] 同一功能的代码变更必须在同一 PR 中（禁止拆分为多个 PR 规避审查）
- [ ] PR 合并前 CI 必须通过（`test-compile` 不允许跳过）
- [ ] 禁止 force push 到 `main`/`master` 分支

---

## 提交信息格式

```
<type>: <简短描述>

<详细说明（可选）>
```

| Type | 用途 | 示例 |
|------|------|------|
| `feat` | 新功能 | `feat: 添加 DeepSeek 模型供应商` |
| `fix` | Bug 修复 | `fix: 修复 Worker 线程 traceId 断裂` |
| `refactor` | 重构（不改变行为） | `refactor: 提取 TaskResult 相关逻辑到独立 Service` |
| `docs` | 文档 | `docs: 合并 API 开发规范文档` |
| `test` | 测试 | `test: 新增 ScreenplayBindingParser 正则测试` |
| `chore` | 构建/工具 | `chore: 升级 Spring Boot 到 3.1.5` |
| `ci` | CI/CD | `ci: 修复 Jenkins test-compile 跳过问题` |
| `perf` | 性能优化 | `perf: 优化 task 查询索引` |

---

## PR 流程

1. **创建 PR 前**：
   ```bash
   # 审查从 main 分叉以来的所有变更
   git diff main...HEAD
   
   # 确认 CI 通过
   mvn -pl <changed-modules> -am test-compile
   ```

2. **PR 描述**：说明变更原因（Why）而非罗列变更内容（What）

3. **合并前**：
   - [ ] CI 全部通过（不允许跳过 test-compile）
   - [ ] 至少一人 Code Review 通过
   - [ ] 无 unresolved 的 CR 意见

---

## 禁止操作

- ❌ `git push --force origin main`（禁止 force push 到主分支）
- ❌ `git commit --no-verify`（禁止跳过 pre-commit hooks）
- ❌ 将一个大功能拆成多个小 PR 绕过审查
- ❌ 在 PR 中包含无关的格式化/重构变更

---

## CR 检查清单

- [ ] 提交信息是否符合 `<type>: <描述>` 格式？
- [ ] PR 是否包含完整的功能变更（非碎片化）？
- [ ] 是否查看了 `git diff main...HEAD` 全量差异？
- [ ] CI 是否全部通过？
