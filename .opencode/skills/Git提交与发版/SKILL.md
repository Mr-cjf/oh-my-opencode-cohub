---
name: "Git提交与发版"
description: "为项目创建结构化git提交信息并执行发版流程（更新CHANGELOG、npm version、打tag、推送、验证）。自动分析分支变更，生成变更影响汇总表格，完成后可选进入发版。当用户说'提交''commit''发版''发布''release'时触发。**禁止在master/test/dev分支使用。**"
tags: ["git", "commit", "release", "changelog", "semver", "npm", "conventional-commits", "发版", "提交"]
context: fork
---

# Git提交与发版

> 项目规范：`.opencode/rules/Git工作流.md` + `.opencode/rules/发版规范.md`
> 技术栈：TypeScript / bun / npm（非 Maven 项目）
>
> **本技能 = Git提交 + 发版**，分两阶段执行：
> - **阶段 A（第1-8步）**：Git 提交 — 分析变更、生成提交信息、执行提交
> - **阶段 B（第9-15步）**：发版 — 提交完成后询问用户，确认后继续发版流程

---

## 预注入上下文

以下数据由 opencode 在加载技能时自动执行命令并注入，无需手动运行：

- 当前分支: !`git branch --show-current`
- 暂存文件列表: !`git diff --cached --name-only 2>/dev/null || echo "(无暂存文件)"`
- 暂存变更统计: !`git diff --cached --stat 2>/dev/null || echo "(无暂存变更)"`
- 未暂存文件: !`git diff --name-only 2>/dev/null || echo "(无)"`
- 上次提交完整信息: !`git log -1 --format=%B 2>/dev/null || echo "(仓库无提交记录)"`
- 远程基准分支: !`(git branch -r 2>/dev/null | grep -q "origin/master" && echo "origin/master") || (git branch -r 2>/dev/null | grep -q "origin/main" && echo "origin/main") || echo "NEED_FETCH"`
- 最近提交: !`git log --oneline -10 2>/dev/null || echo "(无)"`
- 当前版本号: !`node -p "require('./package.json').version" 2>/dev/null || echo "(无法读取)"`

---

## 快速检查清单（执行前过一遍）

| 序号 | 阶段 | 步骤 | 最易遗漏 |
|------|------|------|---------|
| 1 | A | 从预注入上下文读取当前分支，确认非 master/test/dev | |
| 2 | A | 从预注入上下文读取暂存/未暂存状态，确认有变更可提交 | |
| 3 | A | 并行派发 3 个 Explore 子代理（diff分析 / 分支历史 / 上次表格） | 并行执行 |
| 4 | A | 等待子代理返回，检查延续性，合成表格 | |
| 5 | A | 生成分支变更影响汇总表格（继承上次 + 追加/更新本次） | |
| 6 | A | `npm run build` 构建通过 | 提交前必须构建 |
| 7 | A | 按模板生成完整提交信息（含继承后的表格） | |
| 8 | A | 预览确认 → `git add` + `git commit` | |
| 9 | B | **询问用户是否继续发版** | 必须询问 |
| 10 | B | 前置检查（package.json repository.url、工作区干净） | |
| 11 | B | 分析变更 → 推荐 SemVer 级别（patch/minor/major） | 确认版本号 |
| 12 | B | 更新 CHANGELOG.md（按 Keep a Changelog 格式） | 新增/修复/变更/移除分类 |
| 13 | B | 提交 CHANGELOG（`docs: 更新 CHANGELOG vX.Y.Z`） | 先 docs 再 chore |
| 14 | B | `npm version patch/minor/major`（自动更新版本号、commit、tag） | |
| 15 | B | 确保 SSH remote → `git push --follow-tags` + `bunx oh-my-opencode-cohub install` 验证 | |

---

## 阶段 A：Git 提交流程

---

### 第一步：分支保护检查

直接从预注入上下文中读取当前分支名。

- [ ] 如果当前分支是 `master`、`test` 或 `dev`（不区分大小写），**直接终止并提示**：
  > 当前分支 `<branch-name>` 是集成分支（integration branch），不是功能分支。集成分支上的提交总结没有意义。请切换到功能分支（feature branch）后再使用本技能。
- [ ] 通过后记录当前分支名，后续步骤会用到。

---

### 第二步：检查工作区状态

直接从预注入上下文中读取暂存/未暂存文件列表。

- [ ] 如果没有任何变更（无 staged 也无 unstaged），提示用户当前工作区干净，无需提交，流程终止。
- [ ] 如果只有 unstaged 变更，无 staged 变更，提示用户是否需要 `git add` 暂存文件。
- [ ] 列出即将提交的文件清单（来自预注入的暂存文件列表）。
- [ ] 用户确认文件清单无误后，继续下一步。

---

### 第三步：并行派发 3 个 Explore 子代理分析

> **关键**：3 个子代理在同一条消息中并行派发，不可串行执行。

#### Agent A (Explore)：分析暂存变更详情

**任务**：分析 `git diff --cached` 的完整 diff 内容。

- [ ] 逐文件分析变更：
  - **文件路径** → 判断所属模块（对照本项目 `AGENTS.md` 中的源码结构表）
  - **变更类型** → 新增 / 修改 / 删除
  - **变更意图** → 新功能 / Bug修复 / 重构 / 文档 / 配置 / 测试 / 构建
- [ ] 识别关键变更：`src/index.ts`（插件入口）/ `src/tui.ts`（TUI面板）/ `src/prompts/*.ts`（提示词）/ `src/context/`（上下文系统）/ `src/tools/`（工具）/ 类型定义
- [ ] 返回结构化输出：模块归属、变更文件清单、变更意图判断。

#### Agent B (Explore)：分析分支历史与延续性

**任务**：基于预注入上下文的远程基准分支，分析当前分支从分叉点以来的所有提交，检查问题延续性。

- [ ] 用 `git merge-base` 找真正的分叉点
- [ ] 遍历分叉后的提交列表
- [ ] 将本次 staged 变更的文件列表与历史提交的文件集合做交集对比
- [ ] 返回：分叉点 hash、提交列表、延续性判定结果、提交总数。

#### Agent C (Explore)：提取上次提交的表格行

**任务**：从预注入上下文的上次提交完整信息中，提取"## 分支变更汇总表格"段落的表格行。

- [ ] 提取表格行，逐行原样返回
- [ ] 如果上次提交中没有该段落，返回空并注明"分支首个提交，无历史表格"

---

### 第四步：等待子代理返回，合成结果

- [ ] 汇总 Agent A 输出，确定本次变更的核心主题和影响范围。
- [ ] 汇总 Agent B 输出，确认延续性关系。
- [ ] 汇总 Agent C 输出，作为表格继承的基础。
- [ ] 统计分支提交数量：如果超过 20 个，提示用户分支可能过大。

---

### 第五步：生成分支变更影响汇总表格

> **核心原则**：表格从**当前分支新建点**开始累计。每次提交时：
> - **新问题** → 追加新行
> - **延续修复** → **不追加新行，在原行"问题"列用 `→` 追加修复说明**

- [ ] **5.1 继承上次表格**：将 Agent C 返回的所有表格行原样保留
- [ ] **5.2 分析本次变更**：判断本次变更是新增问题还是延续修复

**表格格式**：

```
| 问题 | 涉及模块 | 是否涉及 API 变更 | 是否涉及 TUI 变更 |
|------|---------|:---:|:---:|
```

**各列判断依据**：

1. **问题** — 该提交解决了什么问题。聚焦"为什么"而非"做了什么"
2. **涉及模块** — 从 `AGENTS.md` 源码结构表对照，如 `src/prompts`、`src/context`、`src/index.ts` 等
3. **是否涉及 API 变更** — 是/否。插件 SDK 接口变更、代理注册变更、消息 transform 逻辑变更
4. **是否涉及 TUI 变更** — 是/否。`src/tui.ts` 或 `@opentui/*` 相关变更

**排除类型**：`docs:`/`chore:`/`ci:`/`.opencode/` 目录变更、merge commits 不纳入表格。

---

### 第六步：构建检查

> **构建由 CI 在发布时自动执行**（GitHub Actions publish.yml 的 npm publish 前自动运行 `npm run build`）。本地不再要求提交前构建。

---

### 第七步：生成完整提交信息

基于以上分析，生成完整的提交信息。格式如下：

```
<type>(<scope>): <简短描述>

## 变更概述
- 用 3-5 个要点概括本次变更的核心内容

## 详细说明
- 具体的代码变更和实现细节

## 影响范围
- 受影响的模块或功能

## 分支变更汇总表格（`<当前分支名>` 累计，起点 `<基准分支>` @ `<merge-base-short-hash>`）

| 问题 | 涉及模块 | 是否涉及 API 变更 | 是否涉及 TUI 变更 |
|------|---------|:---:|:---:|

> 分支提交总数：N 个
> 延续修复：`abc1234` 是 `def5678` 的后续修复 — 修复了xxx问题（如无则省略此行）

## 构建验证
- CI 发布时自动构建 ✓

## 相关信息
- 关联 issue/PR / 协作者 / 参考文档
```

**提交类型（type）**：

| Type | 用途 | Type | 用途 |
|------|------|------|------|
| `feat` | 新功能 | `fix` | Bug 修复 |
| `refactor` | 重构 | `docs` | 文档 |
| `test` | 测试 | `chore` | 构建/工具 |
| `ci` | CI/CD | `perf` | 性能优化 |

**范围（scope）**：优先用模块名（如 `prompts`、`context`、`cli`），跨模块用 `cross-module` 或省略。

---

### 第八步：展示预览并确认，执行提交

- [ ] 展示完整的提交信息预览
- [ ] 列出即将提交的文件清单
- [ ] 重点突出分支变更汇总表格
- [ ] 用户确认后执行 `git add` + `git commit`

---

## 阶段 B：发版流程

> **阶段 A（提交）完成后，必须询问用户是否继续发版。** 不可跳过询问直接进入发版。

---

### 第九步：询问是否发版

提交成功后，向用户展示：

```
✅ 提交完成：[commit hash] - <提交信息摘要>

是否继续发版？当前版本：vX.Y.Z
```

- [ ] 用户选择「是」→ 继续第十步
- [ ] 用户选择「否」→ 流程终止，提示可稍后手动发版

---

### 第十步：发版前置检查

- [ ] **10.1 分支保护**：再次确认当前分支非 master/test/dev
- [ ] **10.2 工作区状态**：确认工作区干净（刚提交完应无变更）
- [ ] **10.3 repository.url 检查**：读取 `package.json`，确认 `repository.url` 指向正确的 GitHub 仓库地址（CI 使用 `--provenance` 校验依赖此项）
- [ ] **10.4 远程同步检查**：确认本地提交已推送到远程（或准备在步骤15推送）
- [ ] 任一检查失败 → 终止发版，提示具体问题

---

### 第十一步：确定版本号

- [ ] **11.1 分析本次提交类型**，推荐 SemVer 级别：

| 提交类型 | 推荐版本级别 | 说明 |
|---------|:---:|------|
| `fix` | **patch** | Bug 修复，向后兼容 |
| `feat` | **minor** | 新功能，向后兼容 |
| 包含 `BREAKING CHANGE` | **major** | 破坏性变更 |
| `refactor`/`perf` | **patch** | 内部改进 |
| `docs`/`test`/`chore`/`ci` | **询问** | 纯文档/构建变更，可能不需要发版 |

- [ ] **11.2 检查 CHANGELOG.md**（如存在），确认上次发版以来的变更内容
- [ ] **11.3 向用户展示推荐级别**，请用户确认（可手动选择不同级别）
- [ ] 记录目标版本号 `vX.Y.Z`

---

### 第十二步：更新 CHANGELOG.md

- [ ] **12.1 如 CHANGELOG.md 不存在**，创建并写入基本结构：

```markdown
# Changelog

本文档记录 oh-my-opencode-cohub 的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [未发布]

### 新增

### 修复

### 变更

### 移除
```

- [ ] **12.2 在「未发布」上方插入新版本条目**，格式：

```markdown
## [版本号] - YYYY-MM-DD

### 新增
- 新功能描述

### 修复
- Bug 修复描述

### 变更
- 行为变更描述

### 移除
- 已删除的内容
```

- [ ] **12.3 根据提交信息填充条目**：
  - `feat` → **新增**
  - `fix` → **修复**
  - `refactor` / `perf` / 行为调整 → **变更**
  - 删除功能/文件 → **移除**
  - `docs` / `test` / `chore` / `ci` → 通常不写入 CHANGELOG（除非对用户有影响）

---

### 第十三步：提交 CHANGELOG

> **关键**：CHANGELOG 提交和版本号提交必须分开！

- [ ] 执行 `git add CHANGELOG.md`
- [ ] 执行 `git commit -m "docs: 更新 CHANGELOG vX.Y.Z"`
- [ ] 确认提交成功

---

### 第十四步：更新版本号并打 tag

- [ ] 执行 `npm version <patch|minor|major> -m "chore: 版本号 %s"`
  - 此命令自动完成：更新 `package.json` 中的 `version` 字段 → 创建 commit → 打 `vX.Y.Z` tag
- [ ] 确认命令输出显示新版本号和 tag 名称
- [ ] 记录：commit hash + tag 名称

---

### 第十五步：推送与验证

- [ ] **15.1 推送代码和 tag**：
  ```bash
  # 确保使用 SSH remote（HTTPS 在中国大陆网络环境下经常超时）
  git remote set-url origin git@github.com:Mr-cjf/oh-my-opencode-cohub.git
  git push --follow-tags
  ```
  - 此命令推送当前分支的所有提交 + 新创建的 tag
  - CI 检测到新 tag 后自动构建并发布到 npm

- [ ] **15.2 验证安装**：
  ```bash
  bunx oh-my-opencode-cohub install
  ```
  - 确认安装成功，无报错

- [ ] **15.3 提示用户**：
  ```
  ✅ 发版完成！vX.Y.Z 已推送，CI 将自动发布到 npm。
  
  请执行以下操作完成验证：
  1. 重启 OpenCode（加载新版本插件）
  2. 确认 12 个 co- 代理正常工作
  3. 确认 TUI 面板正常显示
  ```

---

## 常见遗漏点

### 提交阶段
1. **在集成分支上使用** → 在 master/test/dev 执行提交
2. **子代理串行执行** → 3 个 Explore 子代理应在同一条消息中并行派发
3. **分支起点判断错误** → 未用 `git merge-base origin/master HEAD`
4. **dist/ 意外暂存** → dist/ 不应被 Git 跟踪，如意外暂存请 `git rm --cached -r dist/`
5. **汇总表格混入无业务影响的变更** → `docs:`/`chore:`/`ci:`/`.opencode/` 目录变更不纳入
6. **「问题」列写代码操作** → 应写业务问题，而非代码动作
7. **延续性关系遗漏** → 延续修复不追加新行，在原行用 `→` 链式追加
8. **汇总表格未继承上次提交的行** → 通过 Agent C 读取上次提交信息中的表格行
9. **分支提交数过多未提示** → 超过 20 个时提示考虑拆分 PR

### 发版阶段
10. **忘记询问是否发版** → 提交完成后必须询问，不可跳过
11. **CHANGELOG 提交和版本号提交未分开** → 必须先 `docs:` 再 `chore:`
12. **未检查 repository.url** → `package.json` 中 `repository.url` 错误会导致 CI `--provenance` 校验失败
13. **发版后未验证安装** → 每次发版后必须 `bunx oh-my-opencode-cohub install` + 重启验证
14. **SemVer 选择错误** → `fix` 用 patch，`feat` 用 minor，`BREAKING CHANGE` 用 major
15. **CHANGELOG 格式不标准** → 必须使用「新增/修复/变更/移除」四个分类，日期格式 YYYY-MM-DD

---

## 分支保护说明

本技能禁止在以下分支使用：

| 分支名 | 原因 |
|--------|------|
| `master` | 主分支，提交来源混杂，无法提炼统一主题 |
| `test` | 测试集成分支，包含多个功能的合并提交 |
| `dev` | 开发集成分支，提交来自不同开发者的不同功能 |

如需在这些分支提交：
- **紧急热修复**：从 master 创建 hotfix 分支
- **集成分支合并**：使用 PR merge / `git merge`

---

## CHANGELOG 格式参考

```markdown
## [1.2.0] - 2026-07-20

### 新增
- 新增 `co-planner` 代理，支持多步骤任务分解
- TUI 面板支持 agent 状态实时刷新

### 修复
- 修复 `co-fixer` 在 Windows 路径下的构建失败问题
- 修复中文注入在 HTTP 服务器模式下不生效的问题

### 变更
- 代理提示词统一从 `.md` 迁移到 `.ts` 常量
- TUI 面板刷新频率从 2s 调整为 1s

### 移除
- 移除已废弃的 `co-analyzer` 代理
```

---

## CR 检查清单

**提交阶段：**
- [ ] 提交信息是否符合 `<type>: <描述>` 格式？
- [ ] 是否查看了 `git diff main...HEAD` 全量差异？
- [ ] dist/ 是否未被 Git 跟踪？（构建由 CI 负责）
- [ ] 分支变更汇总表格是否正确继承了上次表格？

**发版阶段：**
- [ ] CHANGELOG.md 是否在发版前更新？
- [ ] 版本号是否符合 SemVer？
- [ ] CHANGELOG 提交和版本号提交是否分开？
- [ ] SSH remote 是否已配置？`git push --follow-tags` 是否成功？
- [ ] 发版后是否重新安装验证？
