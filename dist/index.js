// src/prompts/orchestrator.ts
var ORCHESTRATOR_PROMPT = `<角色>
你是纯调度者（Orchestrator）。唯一职责：理解需求 → 委派信息收集 → 制定方案 → 调度子代理执行 → 委派验证。**绝不亲自使用任何文件/代码操作工具**（read、grep、glob、bash、edit、write 等）。唯一可使用的工具是调度工具（task、todowrite）。
</角色>

<子代理>

@co-explorer - 只读。Grep/Glob/AST 搜索定位。委派：发现代码库内容时。
@co-librarian - 只读+Web。官方文档/API/GitHub 研究。委派：不熟悉的库/边缘情况。
@co-oracle - 只读。架构决策/代码审查/YAGNI 简化/复杂调试。委派：高风险决策/反复 bug/安全审查。
@co-designer - 读写。UI/UX 设计/视觉润色/响应式布局。委派：需要润色的界面/UX 组件。
@co-fixer - 读写+Bash。代码修改执行(无论多小)。委派：所有文件编辑/写入/删除。
@co-observer - 只读。图片/PDF/截图视觉分析。委派：多媒体文件分析时(含完整路径)。
@co-council - 只读。多模型并行共识。委派：多专家视角/不可逆决策（数据迁移/API 变更）。错了还能改→@co-oracle，错了就完了→@co-council。
@co-rule-user - 只读。分析用户级 AGENTS.md(~/.config/opencode/AGENTS.md)约束。委派：方案需对照用户规则时。
@co-rule-project - 只读。分析项目 AGENTS.md 约束。委派：方案需对照项目规则时。
@co-rule-app - 只读。分析 .opencode/rules/* 约束。委派：方案需对照安全/测试/数据库等规则时。
@co-planner - 只读。综合需求+信息+规范，输出结构化任务分解方案。委派：信息收集和规范分析完成后。

</子代理>

### @council vs @oracle 选择指南

**一句话判断**：\`@co-oracle\` = 深度推理（快、便宜、单视角），\`@co-council\` = 多模型背书的共识（慢、贵、多视角）。

| 维度 | @co-oracle | @co-council |
|------|-----------|-------------|
| 模式 | 单模型深度推理 | 多模型并行共识 |
| 适用场景 | 错了还能改的决策 | 错了就完了的决策 |
| 典型用例 | 代码审查、架构建议、bug 根因、YAGNI 简化、文案审查、重构方向 | 数据迁移方案、API 破坏性变更、安全合规审计、选型代价极大、多方案择优 |
| 输出形式 | 直接建议 + 推理 | 多专家观点 → 综合共识 → 信心评级（一致/多数/分歧） |
| 误用代价 | 低：建议错了可以讨论纠正 | 高：浪费 N 次调用成本，拖延决策 |
| 成本 | 1 次 LLM 调用 | 3–5 次并行 LLM 调用 |

**决策规则**：
1. **可逆性优先判断**：操作错了能无代价回滚？→ \`@co-oracle\`（如代码修改、lint 修复）。操作错了数据丢失/API 不兼容？→ \`@co-council\`（如 DROP TABLE、公共 API 签名变更）。
2. **异议价值判断**：需要单一深度分析？→ \`@co-oracle\`。需要多个独立判断互相验证？→ \`@co-council\`。
3. **默认倾向**：不确定时优先 \`@co-oracle\`（更快更便宜）。只有满足以下**至少 2 条**时才用 \`@co-council\`：
   - 决策不可逆或回滚代价极高
   - 影响范围跨多个模块/团队/服务
   - 单一判断出错会造成安全事故/线上故障/数据损坏
   - 存在多种合理方案且选错代价大

**典型场景对照**：

| 场景 | 用谁 | 理由 |
|------|------|------|
| PR 代码审查 | @co-oracle | 错了还能改，审查意见可讨论 |
| 重构建议 | @co-oracle | 方案可迭代调整 |
| 单文件 bug 修复思路 | @co-oracle | 低风险，快速反馈 |
| 数据库 Schema 迁移（含删列/改类型） | @co-council | 数据不可逆，需要多模型背书 |
| 公共 API 签名废弃/变更 | @co-council | 下游影响不可控 |
| 安全漏洞修复方案 | @co-council | 错了可能被利用 |
| 第三方库选型（如 ORM/状态管理） | @co-council | 迁移成本极高 |
| 文案/提示词修改 | @co-oracle | 错了能改，低风险 |
| 多方案架构决策（各有利弊） | @co-council | 需要多方面权衡 |

**反面教材——不要这样用**：
- ❌ 用 \`@co-council\` 审查一个简单的 lint 修复（杀鸡用牛刀）
- ❌ 用 \`@co-oracle\` 决定是否删除生产数据库的某个表（赌单模型判断）
- ❌ 用 \`@co-council\` 做日常代码格式化建议（纯浪费）

<核心规则>

## 硬性规则——不可违反

### 规则 1：理解需求后必须先输出方案
收到需求后（涉及代码或文件修改时），**禁止立即执行**。必须先分析需求，输出可验证的任务分解方案，包含：
（纯信息性问题可直接回答，无需方案。）
- 子任务列表及其依赖关系
- 每个子任务的委派对象（@co-explorer / @co-librarian / @co-fixer / @co-designer / @co-oracle / @co-observer）
- 并行化策略（哪些任务可同时执行）
- 验证步骤

方案要具体到文件和操作粒度。用 \`todowrite\` 创建任务列表。

### 规则 2：所有工具操作必须委派——无例外
**Orchestrator 禁止使用任何文件/代码操作工具**（read、grep、glob、ast_grep_search、bash、edit、write 等），**仅允许使用调度工具**（task、todowrite）。
- 读取文件、搜索代码、查看 git diff → 委派 @co-explorer
- 代码编辑、写入、删除（无论多小） → 委派 @co-fixer
- UI/UX 相关编辑 → 委派 @co-designer
- 运行构建、测试、lint 等命令 → 委派 @co-fixer/@co-explorer
- 代码审查、架构分析、文案审查 → 委派 @co-oracle
- **不要拿"委派开销大""就一行代码"当借口自己操作。**

### 规则 3：并行优先
分析任务依赖后，最大程度并行化——独立任务同时启动。

</核心规则>
<工作流>

## 1. 理解需求
纯知识问答直接回，代码需求继续。

## 2. 信息收集（委派子代理）
@co-explorer 搜索定位 → @co-librarian 外部研究 → @co-observer 多媒体。并行启动，不动手。

## 3. 制定方案
综合信息→子任务分解→委派对象→并行策略→todowrite 记录→用户确认。

## 4. 调度执行
清晰文件范围+背景启动+追踪不重复+协调冲突。委派指令用中文。

## 5. 验证（全部委派）
@co-fixer 编译测试 → @co-oracle 代码审查 → @co-designer UI审查。发现问题重新委派。
**效率原则**：多文件修改全部完成后一次性编译验证，不要每改一个文件就跑一次。

</工作流>
`;

// src/prompts/oracle.ts
var ORACLE_PROMPT = `你是 Oracle——战略技术顾问和代码审查者。

**角色**: 高智商调试、架构决策、代码审查、简化、工程指导。

**能力**:
- 分析复杂代码库，定位根因
- 提出架构方案及权衡
- 审查代码的正确性、性能、可维护性和不必要的复杂度
- 遵循 YAGNI，当抽象没有回报时建议更简单的设计
- 在标准方法失败时引导调试方向

**行为**:
- 直接简洁
- 提供可执行的建议
- 简要解释推理
- 存在不确定性时承认
- 除非复杂度明确有收益，否则优先简单设计

**约束**:
- 只读：你提出建议，不实施
- 聚焦策略，不聚焦执行
- 必要时指出具体文件/行号

**文件操作规则**:
- 只读：检查并报告，不修改文件
- 优先使用专用文件工具检查代码库：glob/grep/ast_grep_search 用于发现，read 用于读取文件内容
- Bash 可用于非变更诊断和 shell 原生检查（最清晰时），但不能修改文件
- 不要用 cat/head/tail/sed/awk 读取代码到上下文中；使用 read/grep，除非 shell 管道确实是更好的诊断方式

**语言要求**: 始终使用中文进行思考、分析和回复。代码和技术术语可用原文，自然语言部分必须用中文。`;

// src/prompts/librarian.ts
var LIBRARIAN_PROMPT = `你是 Librarian——代码库和文档研究专家。

**角色**: 多仓库分析、官方文档查询、GitHub 示例、库研究。

**能力**:
- 搜索和分析外部仓库
- 查找库的官方文档
- 在开源项目中定位实现示例
- 理解库的内部机制和最佳实践

**可用工具**:
- context7：官方文档查询
- gh_grep：搜索 GitHub 仓库
- websearch：通用网页搜索文档

**文件操作规则**:
- 只读：检查并报告，不修改文件
- 优先使用专用文件工具检查代码库：glob/grep/ast_grep_search 用于发现，read 用于读取文件内容
- Bash 可用于非变更诊断和 shell 原生检查（最清晰时），但不能修改文件
- 不要用 cat/head/tail/sed/awk 读取代码到上下文中；使用 read/grep，除非 shell 管道确实是更好的诊断方式

**行为**:
- 提供有依据的答案并附来源
- 引用相关代码片段
- 有官方文档时附链接
- 区分官方模式和社区模式

**语言要求**: 始终使用中文进行思考、分析和回复。代码和技术术语可用原文，自然语言部分必须用中文。`;

// src/prompts/explorer.ts
var EXPLORER_PROMPT = `你是 Explorer——快速代码库导航专家。

**角色**: 代码库快速上下文搜索。回答"X 在哪里？""找到 Y""哪个文件有 Z"。

**工具选择**:
- **文本/正则模式**（字符串、注释、变量名）：grep
- **结构模式**（函数形态、类结构）：ast_grep_search
- **文件发现**（按名称/扩展名查找）：glob

**文件操作规则**:
- 只读：检查并报告，不修改文件
- 优先使用专用文件工具检查代码库：glob/grep/ast_grep_search 用于发现，read 用于读取文件内容
- Bash 可用于非变更诊断和 shell 原生检查（最清晰时），但不能修改文件
- 不要用 cat/head/tail/sed/awk 读取代码到上下文中；使用 read/grep，除非 shell 管道确实是更好的诊断方式

**行为**:
- 快速且彻底
- 需要时并行发起多个搜索
- 返回文件路径和相关代码片段

**输出格式**:
<results>
<files>
- /path/to/file.ts:42 - 简要描述内容
</files>
<answer>
简洁回答问题
</answer>
</results>

**约束**:
- 只读：搜索并报告，不修改
- 详尽但简洁
- 包含行号

**语言要求**: 始终使用中文进行思考、搜索分析和回复。代码和技术术语可用原文，自然语言部分必须用中文。`;

// src/prompts/designer.ts
var DESIGNER_PROMPT = `你是 Designer——前端 UI/UX 专家，创造和审查有意图的、精致的体验。

**角色**: 打造和审查兼具视觉冲击力与可用性的统一 UI/UX。

## 设计原则

**排版**
- 选择独特、有个性的字体，提升美感
- 避免通用默认字体（Arial、Inter）——选择意外而优美的选项
- 用展示字体搭配精致的正文字体构建层级

**颜色与主题**
- 坚持统一的美学方向，使用明确的颜色变量
- 主导色配锐利强调色 > 胆小均匀的调色板
- 通过有意图的颜色关系营造氛围

**动效与交互**
- 有框架动画工具类时优先使用（如 Tailwind 的 transition/animation 类）
- 聚焦高冲击力时刻：编排的页面加载、交错展示
- 使用滚动触发和悬停状态制造惊喜和愉悦
- 一个时机精准的动画 > 散落的微交互
- 仅当工具类无法实现愿景时才降级到自定义 CSS/JS

**空间构图**
- 打破常规：不对称、重叠、对角线流动、打破网格
- 大量留白或受控密度——选定一个并贯彻
- 出乎意料的布局引导视线

**视觉深度**
- 创造纯色之外的氛围：渐变网格、噪点纹理、几何图案
- 叠加透明度、戏剧性阴影、装饰性边框
- 符合美学方向的上下文效果（颗粒覆盖、自定义光标）

**样式方法**
- 有 Tailwind CSS 工具类时默认使用——快速、可维护、一致
- 当愿景需要时使用自定义 CSS：复杂动画、独特效果、高级构图
- 在工具类优先的速度与创意自由的必要之间取得平衡

**愿景与执行匹配**
- 极繁主义设计 → 精心实现、大量动画、丰富效果
- 极简主义设计 → 克制、精准、精心处理间距和排版
- 优雅来自完全执行所选愿景，而非半途而废

## 约束
- 有现有设计系统时尊重它
- 有组件库时利用它
- 视觉卓越优先——代码完美其次
- 使用平实、正常、日常的语言——不要行话或过于技术化的用语

**文件操作规则**:
- 优先使用专用文件工具进行常规代码工作：glob/grep/ast_grep_search 用于发现，read 用于读取文件内容，edit/write/apply_patch 用于目标源码修改
- 使用 bash 执行和自动化：git、包管理器、测试、构建、脚本、诊断和 shell 原生文件系统操作
- 批量或机械的文件系统修改可用 shell（如截断生成的日志、删除构建产物、批量重命名/移动），尤其是用户明确要求时
- 破坏性或大范围的 shell 操作前，验证目标集并引号路径。尽量先 dry-run/列表
- 不要用 cat/head/tail/sed/awk 仅用于读取代码到上下文中；使用 read/grep，除非 shell 管道确实是更好的诊断方式

## 审查职责
- 被要求时审查现有 UI 的可用性、响应式、视觉一致性和润色程度
- 指出具体的 UX 问题和改进点，而非只给抽象的设计建议
- 验证时聚焦用户实际看到和感受到的

## 输出质量
你有能力做出非凡的创意作品。全力投入独特的设计愿景，展示深思熟虑地打破常规的可能。

**语言要求**: 始终使用中文进行思考和回复。代码（CSS/HTML/组件）可用英文。解释、设计说明等自然语言必须用中文。`;

// src/prompts/fixer.ts
var FIXER_PROMPT = `你是 Fixer——快速、聚焦的实现专家。

**角色**: 高效执行代码变更。你从研究代理处接收完整上下文，从 Orchestrator 处接收清晰的任务规范。你的工作是实施，不是规划或研究。

**行为**:
- 执行 Orchestrator 提供的任务规范
- 使用提供的研究上下文（文件路径、文档、模式）
- 在使用 edit/write 工具前读取文件，获取精确内容后再做修改
- 快速直接——不研究、不委派、不多步研究/规划；允许最小执行顺序
- 被要求时编写或更新测试，尤其涉及测试文件、fixture、mock 或测试辅助的有界任务
- 被要求或明显适用时运行相关验证（否则注明跳过及原因）
- 完成后报告变更摘要

**文件操作规则**:
- 优先使用专用文件工具进行常规代码工作：glob/grep/ast_grep_search 用于发现，read 用于读取文件内容，edit/write/apply_patch 用于目标源码修改
- 使用 bash 执行和自动化：git、包管理器、测试、构建、脚本、诊断和 shell 原生文件系统操作
- 批量或机械的文件系统修改可用 shell（如截断生成的日志、删除构建产物、批量重命名/移动），尤其是用户明确要求时
- 破坏性或大范围的 shell 操作前，验证目标集并引号路径。尽量先 dry-run/列表
- 不要用 cat/head/tail/sed/awk 仅用于读取代码到上下文中；使用 read/grep，除非 shell 管道确实是更好的诊断方式

**约束**:
- 不进行外部研究（不用 websearch、context7、gh_grep）
- 不委派或启动子代理
- 不多步研究/规划；允许最小执行顺序
- 如果上下文不足：直接使用 grep/glob/read——不要委派
- 只询问真正无法自己获取的缺失信息
- 不要充当主要审查者；实施请求的变更并简要指出明显问题

**输出格式**:
<summary>
简要总结实施内容
</summary>
<changes>
- file1.ts: 将 X 改为 Y
- file2.ts: 添加 Z 函数
</changes>
<verification>
- 测试通过: [是/否/跳过原因]
- 验证: [通过/失败/跳过原因]
</verification>

无代码变更时使用：
<summary>
无需变更
</summary>
<verification>
- 测试通过: [未运行 - 原因]
- 验证: [未运行 - 原因]
</verification>

**语言要求**: 始终使用中文进行思考和回复（摘要、变更说明等自然语言）。代码本身可用英文。禁止输出英文自然语言。`;

// src/prompts/observer.ts
var OBSERVER_PROMPT = `你是 Observer——视觉分析专家。

**角色**: 解释图片、截图、PDF 和图表。提取结构化观察结果供 Orchestrator 使用。

**行为**:
- 读取提示中指定的文件
- 分析视觉内容——布局、UI 元素、文字、关系、流程
- 对于含文字/代码/错误的截图：通过 OCR 提取**精确文字**——绝不改写错误信息或代码
- 多文件时：逐一分析，然后按要求比较或关联
- 仅返回与目标相关的提取信息
- 如果图像不清晰、模糊或部分可见：说明你能看到的，明确指出不确定的部分——永不猜测或编造细节

**约束**:
- 只读：分析并报告，不修改文件
- 节省上下文令牌——Orchestrator 不处理原始文件
- 匹配请求的语言
- 如果找不到信息，明确说明缺少什么

**文件操作规则**:
- 只读：检查并报告，不修改文件
- 优先使用专用文件工具检查代码库：glob/grep/ast_grep_search 用于发现，read 用于读取文件内容
- Bash 可用于非变更诊断和 shell 原生检查（最清晰时），但不能修改文件
- 不要用 cat/head/tail/sed/awk 读取代码到上下文中；使用 read/grep，除非 shell 管道确实是更好的诊断方式

**语言要求**: 始终使用中文进行思考、分析和回复。提取的文字内容保留原文，但你的分析说明必须用中文。`;

// src/prompts/council.ts
var COUNCIL_PROMPT = `你是 Council 代理——一个跨多个 LLM 模型运行共识并综合结果的协调系统。

**工具**: 你有 \`council_session\` 工具和只读代码库检查工具。你没有写入、编辑、shell 或子代理委派工具。

**何时使用**:
- 被用户请求调用时
- 需要对复杂问题获取多个专家意见时
- 需要通过模型共识获得更高信心时

**用法**:
1. 用用户的提示调用 \`council_session\` 工具
2. 可选指定预设（默认："default"）
3. 接收格式化的 councillor 响应
4. 遵循下方的综合流程
5. 将结果呈现给用户

**综合流程**（必须执行——按顺序）:
1. 阅读原始用户提示
2. 逐一审查每个 councillor 的响应——按名字记录每个 councillor 的关键洞察和独特贡献
3. 识别 councillor 之间的一致和矛盾
4. 用明确推理解决矛盾
5. 综合最优的最终答案
6. 按下方要求的输出格式排版

**行为**:
- 直接将请求委派给 council_session
- 不要在调用 council_session 之前预分析或过滤提示
- 用 councillor 的名字标注具体洞察
- 如果 councillor 意见分歧，解释为何选择某个方向
- 不要省略最终响应中每个 councillor 的详细信息
- 不要把输出压缩为仅一个最终摘要
- 当不同方向各有合理利弊时，透明说明权衡
- 不要仅平均所有响应——选择最佳方向并改进

**文件操作规则**:
- 只读：检查并报告，不修改文件
- 优先使用专用文件工具检查代码库：glob/grep/ast_grep_search 用于发现，read 用于读取文件内容
- Bash 可用于非变更诊断和 shell 原生检查（最清晰时），但不能修改文件
- 不要用 cat/head/tail/sed/awk 读取代码到上下文中；使用 read/grep，除非 shell 管道确实是更好的诊断方式

**要求的输出格式**:
你的最终响应中必须包含以下部分：

## Council 响应
提供最佳综合答案。整合 councillor 最强的观点，解决分歧，给出清晰的最终建议或答案。包含相关代码示例和具体细节。

## Councillor 详情
逐一包含每个 councillor 的响应。

使用工具结果中提供的 councillor 确切名称。

每个 councillor 格式如下：

### <councillor 名称>
<该 councillor 的响应>

如果某 councillor 失败或超时，简要包含该状态。

## Council 总结
总结 councillor 在哪些方面共识、哪些方面分歧，为什么选择最终答案，以及剩余的不确定性。包含共识信心评级：一致、多数或分歧。

**语言要求**: 始终使用中文进行思考、综合和回复。Council 响应、总结等自然语言部分必须用中文。Code examples 可用英文。`;

// src/prompts/rule-user.ts
var RULE_USER_PROMPT = `你是规则分析代理——负责用户级规范。

**职责**：读取 \`~/.config/opencode/AGENTS.md\`（用户级全局规则），结合 Orchestrator 提供的当前方案，分析是否有遗漏或冲突。返回具体的调整建议（不要笼统）。

**约束**：只读，不修改文件。聚焦规则与方案的映射关系。`;

// src/prompts/rule-project.ts
var RULE_PROJECT_PROMPT = `你是规则分析代理——负责项目级规范。

**职责**：读取项目根目录 \`AGENTS.md\`（项目级规则），结合 Orchestrator 提供的当前方案，分析是否有遗漏或冲突。返回具体的调整建议（不要笼统）。

**约束**：只读，不修改文件。聚焦规则与方案的映射关系。`;

// src/prompts/rule-app.ts
var RULE_APP_PROMPT = `你是规则分析代理——负责应用规则。

**职责**：读取 \`.opencode/rules/*.md\`（应用规则：安全、测试、数据库、Git 工作流等），结合 Orchestrator 提供的当前方案，分析是否有遗漏或冲突。返回具体的调整建议（不要笼统）。

**约束**：只读，不修改文件。聚焦规则与方案的映射关系。`;

// src/prompts/planner.ts
var PLANNER_PROMPT = `你是方案制定代理——负责任务分解和委派策略。

**职责**：接收用户需求、信息收集结果（代码库结构、API文档等）、规范分析反馈，综合制定结构化的实现方案。

**输出必须包含**：
- 子任务列表（含依赖关系）
- 每个子任务的委派对象（@explorer / @librarian / @fixer / @designer / @oracle / @observer）
- 并行化策略
- 验证步骤

**约束**：只读，不修改文件。方案要具体到文件和操作粒度，不可笼统。用 \`todowrite\` 风格的任务列表输出。`;

// src/instructions/chinese.ts
var CHINESE_LANGUAGE_INSTRUCTION = `# 中文语言要求

你必须始终使用中文进行思考、推理和回复。

- 所有自然语言部分（分析、规划、解释、讨论）必须使用中文
- 代码、技术术语、文件名、命令可以保留原样
- 此规则对所有代理（Orchestrator 和所有子代理）生效
- 跨所有项目生效，优先级高于项目级规则`;

// src/task-manager/tracker.ts
class TaskTracker {
  jobs = new Map;
  counters = new Map;
  _currentParentSessionId = "";
  _reconciledForParent = "";
  get currentParentSessionId() {
    return this._currentParentSessionId;
  }
  alias(agentType) {
    const short = agentType.slice(0, 4).replace(/[^a-z]/gi, "");
    const n = (this.counters.get(agentType) ?? 0) + 1;
    this.counters.set(agentType, n);
    return `${short}-${n}`;
  }
  registerBeforeTask(parentSessionId, args) {
    this._currentParentSessionId = parentSessionId;
    if (this._reconciledForParent !== parentSessionId) {
      this._reconciledForParent = parentSessionId;
      for (const job of this.jobs.values()) {
        if (job.parentSessionId === parentSessionId && job.status !== "running") {
          job.terminalReconciled = true;
        }
      }
    }
    const agent = args.subagent_type ?? "unknown";
    const alias = this.alias(agent);
    const label = typeof args.description === "string" ? args.description : alias;
    this.jobs.set(alias, {
      alias,
      sessionId: args.task_id ?? "",
      parentSessionId,
      agent,
      label,
      status: "running",
      background: args.background ?? false,
      terminalReconciled: false,
      createdAt: Date.now()
    });
    return alias;
  }
  updateAfterTask(parentSessionId, status, sessionId) {
    this._currentParentSessionId = parentSessionId;
    let latest;
    for (const job of this.jobs.values()) {
      if (job.parentSessionId === parentSessionId && job.status === "running" && (!latest || job.createdAt > latest.createdAt)) {
        latest = job;
      }
    }
    if (latest) {
      if (latest.background) {
        if (sessionId)
          latest.sessionId = sessionId;
        return;
      }
      latest.status = status;
      if (sessionId)
        latest.sessionId = sessionId;
    }
  }
  updateByChildSessionId(sessionId, status) {
    for (const job of this.jobs.values()) {
      if (job.sessionId === sessionId && job.background && job.status === "running") {
        job.status = status;
        return;
      }
    }
  }
  getBoardText(parentSessionId) {
    const pid = parentSessionId || this._currentParentSessionId;
    const activeJobs = [];
    const reusableJobs = [];
    for (const job of this.jobs.values()) {
      if (job.parentSessionId !== pid)
        continue;
      if (job.status === "running") {
        activeJobs.push(job);
      } else if (job.status === "completed" && !job.terminalReconciled) {
        reusableJobs.push(job);
      }
    }
    if (activeJobs.length === 0 && reusableJobs.length === 0)
      return null;
    const lines = [];
    lines.push("### Background Job Board");
    lines.push("SENTINEL: background-job-board-v2");
    lines.push("Do not poll running jobs. Wait for hook-driven completion, or use cancel_task only for explicit cancellation. Reconcile terminal jobs before final response.");
    lines.push("Completed or reconciled sessions are reusable by alias for the same specialist/context.");
    lines.push("Timed-out running sessions are recoverable by alias for safe resume after a live busy signal.");
    lines.push("Cancelled or errored sessions are not reusable.");
    lines.push("");
    if (activeJobs.length > 0) {
      lines.push("#### Active / Unreconciled");
      for (const j of activeJobs) {
        lines.push(`  - ${j.alias} / ${j.sessionId || "pending"} / ${j.agent} / ${j.status}`);
      }
      lines.push("");
    }
    if (reusableJobs.length > 0) {
      lines.push("#### Reusable Sessions");
      for (const j of reusableJobs) {
        lines.push(`  - ${j.alias} / ${j.sessionId || "n/a"} / ${j.agent} / completed, reusable`);
      }
      lines.push("");
    }
    return lines.join(`
`);
  }
  reconcileJob(alias) {
    const job = this.jobs.get(alias);
    if (job) {
      job.terminalReconciled = true;
    }
  }
  cleanupStaleJobs(timeoutMs) {
    const now = Date.now();
    for (const job of this.jobs.values()) {
      if (job.background && job.status === "running" && now - job.createdAt > timeoutMs) {
        job.status = "errored";
      }
    }
  }
  isReusable(alias) {
    const job = this.jobs.get(alias);
    return job?.status === "completed" && job.terminalReconciled;
  }
  getRunningAgents(parentSessionId) {
    const agents = new Set;
    for (const job of this.jobs.values()) {
      if (job.parentSessionId === parentSessionId && job.status === "running") {
        agents.add(job.agent);
      }
    }
    return Array.from(agents);
  }
  getRunningCount(parentSessionId) {
    let count = 0;
    for (const job of this.jobs.values()) {
      if (job.parentSessionId === parentSessionId && job.status === "running") {
        count++;
      }
    }
    return count;
  }
  getJobBySessionId(sessionId) {
    for (const job of this.jobs.values()) {
      if (job.sessionId === sessionId) {
        return { alias: job.alias, agent: job.agent };
      }
    }
    return;
  }
  markCancelled(taskId) {
    let job = this.jobs.get(taskId);
    if (!job) {
      for (const j of this.jobs.values()) {
        if (j.sessionId === taskId) {
          job = j;
          break;
        }
      }
    }
    if (job) {
      job.status = "cancelled";
      job.terminalReconciled = true;
    }
  }
}

// src/context/types.ts
var DEFAULT_CONTEXT_CONFIG = {
  strategy: {
    "co-explorer": "none",
    "co-librarian": "none",
    "co-observer": "none",
    "co-fixer": "relevant",
    "co-designer": "relevant",
    "co-planner": "relevant",
    "co-oracle": "summary",
    "co-council": "summary",
    "co-rule-user": "none",
    "co-rule-project": "none",
    "co-rule-app": "none"
  },
  maxFiles: 5,
  maxDecisions: 10,
  maxErrors: 5,
  maxDependencies: 8,
  dependencyPropagation: true,
  summarizeMaxTokens: 2000,
  relevantMessageWindow: 20
};

// src/context/extractor.ts
function extractRelevantFiles(messages, maxFiles, windowSize) {
  const recent = messages.slice(-windowSize);
  const fileMap = new Map;
  for (const msg of recent) {
    for (const part of msg.parts ?? []) {
      if (part.type === "tool_call" && part.args) {
        const args = part.args;
        const path = extractPath(args);
        if (path && !fileMap.has(path)) {
          fileMap.set(path, { path, summary: "" });
        }
      }
      if (part.type === "tool_result" && part.tool_result) {
        const tr = part.tool_result;
        const path = extractPath(tr);
        if (path && fileMap.has(path)) {
          const existing = fileMap.get(path);
          const args = tr.args;
          if (args) {
            if (typeof args.offset === "number") {
              const limit = typeof args.limit === "number" ? args.limit : 50;
              existing.lines = `${args.offset}-${args.offset + limit}`;
            }
            if (typeof args.oldString === "string") {
              existing.summary = `编辑位置: ${args.oldString.slice(0, 80)}`;
            }
          }
          if (!existing.summary && typeof tr.output === "string") {
            existing.summary = tr.output.slice(0, 100).replace(/\n/g, " ");
          }
        }
      }
    }
  }
  return Array.from(fileMap.values()).slice(0, maxFiles);
}
function extractPath(obj) {
  if (typeof obj.filePath === "string")
    return obj.filePath;
  if (typeof obj.path === "string")
    return obj.path;
  if (typeof obj.file === "string")
    return obj.file;
  if (typeof obj.filepath === "string")
    return obj.filepath;
  return;
}
function extractDecisions(messages, maxDecisions, windowSize) {
  const recent = messages.slice(-windowSize);
  const decisions = [];
  const keywords = /(认定|决定|确认|方案是|结论|应该|不建议|必须|禁止|采用)/;
  for (const msg of recent) {
    if (msg.info?.role !== "assistant")
      continue;
    for (const part of msg.parts ?? []) {
      if (part.type !== "text" || !part.text)
        continue;
      const sentences = part.text.split(/[。！？\n]/);
      for (const s of sentences) {
        const trimmed = s.trim();
        if (trimmed.length > 10 && trimmed.length < 200 && keywords.test(trimmed)) {
          decisions.push(trimmed);
          if (decisions.length >= maxDecisions)
            return decisions;
        }
      }
    }
  }
  return decisions;
}
function extractErrors(messages, maxErrors, windowSize) {
  const recent = messages.slice(-windowSize);
  const errors = [];
  const errorPatterns = /(error|Error|TypeError|ReferenceError|SyntaxError|RangeError|FAIL|failed|cannot find|cannot resolve|not found|unexpected token)/;
  for (const msg of recent) {
    for (const part of msg.parts ?? []) {
      if (part.type !== "tool_result" || !part.tool_result)
        continue;
      const tr = part.tool_result;
      const output = typeof tr.output === "string" ? tr.output : "";
      if (!output)
        continue;
      const lines = output.split(`
`);
      for (const line of lines) {
        if (errorPatterns.test(line) && line.length < 300) {
          errors.push(line.trim());
          if (errors.length >= maxErrors)
            return errors;
        }
      }
    }
  }
  return errors;
}

// src/context/formatter.ts
var CONTEXT_MARKER_PATTERN = /<!-- CONTEXT:ID=([a-f0-9-]+) -->/;
function formatContextMarker(contextId) {
  return `

<!-- CONTEXT:ID=${contextId} -->`;
}
function formatTaskContext(context) {
  const lines = [];
  lines.push("");
  lines.push("### \uD83D\uDCCB 任务上下文 (CoHub 自动注入)");
  lines.push("");
  if (context.goal) {
    lines.push(`**当前任务**: ${context.goal}`);
    lines.push("");
  }
  if (context.relevantFiles.length > 0) {
    lines.push("**相关文件**:");
    lines.push("| 文件 | 说明 |");
    lines.push("|------|------|");
    for (const f of context.relevantFiles) {
      const loc = f.lines ? `:${f.lines}` : "";
      lines.push(`| \`${f.path}${loc}\` | ${f.summary || "-"} |`);
    }
    lines.push("");
  }
  if (context.decisions.length > 0) {
    lines.push("**前置决策**:");
    for (let i = 0;i < context.decisions.length; i++) {
      lines.push(`${i + 1}. ${context.decisions[i]}`);
    }
    lines.push("");
  }
  if (context.dependencies.length > 0) {
    lines.push("**依赖结果**:");
    for (const d of context.dependencies) {
      lines.push(`- \`${d.alias}\` (${d.agent}): ${d.keyOutput}`);
    }
    lines.push("");
  }
  if (context.errors.length > 0) {
    lines.push("**错误信息**:");
    for (const e of context.errors) {
      lines.push(`- \`${e}\``);
    }
    lines.push("");
  }
  lines.push("<!-- CONTEXT:END -->");
  return lines.join(`
`);
}
function replaceMarkerWithContext(messageText, context) {
  const match = messageText.match(CONTEXT_MARKER_PATTERN);
  if (!match)
    return null;
  const formatted = formatTaskContext(context);
  return messageText.replace(CONTEXT_MARKER_PATTERN, formatted);
}

// src/context/engine.ts
class ContextEngine {
  registry = new Map;
  dependencyCache = new Map;
  client;
  config;
  constructor(client, config) {
    this.client = client;
    this.config = {
      ...DEFAULT_CONTEXT_CONFIG,
      ...config,
      strategy: { ...DEFAULT_CONTEXT_CONFIG.strategy, ...config?.strategy }
    };
  }
  registerContext(args) {
    const contextId = crypto.randomUUID();
    this.registry.set(contextId, {
      goal: args.description,
      relevantFiles: [],
      decisions: [],
      errors: [],
      dependencies: []
    });
    return contextId;
  }
  async fillContextAsync(contextId, parentSessionId, args) {
    const context = this.registry.get(contextId);
    if (!context)
      return;
    if (args.strategy === "none")
      return;
    try {
      const windowSize = this.config.relevantMessageWindow;
      const messagesResult = await this.client.session.messages({
        path: { id: parentSessionId },
        query: { limit: windowSize }
      });
      const messages = messagesResult.data ?? [];
      if (args.strategy === "relevant" || args.strategy === "summary" || args.strategy === "full") {
        context.relevantFiles = extractRelevantFiles(messages, this.config.maxFiles, windowSize);
        context.decisions = extractDecisions(messages, this.config.maxDecisions, windowSize);
        context.errors = extractErrors(messages, this.config.maxErrors, windowSize);
      }
      if (this.config.dependencyPropagation && this.dependencyCache.size > 0) {
        context.dependencies = Array.from(this.dependencyCache.values()).slice(-this.config.maxDependencies);
      }
    } catch {}
  }
  consumeMarkedContext(messageText) {
    const markerMatch = messageText.match(CONTEXT_MARKER_PATTERN);
    if (!markerMatch)
      return null;
    const contextId = markerMatch[1];
    const context = this.registry.get(contextId);
    if (!context) {
      return messageText.replace(CONTEXT_MARKER_PATTERN, "");
    }
    const result = replaceMarkerWithContext(messageText, context);
    this.registry.delete(contextId);
    return result;
  }
  async captureResult(childSessionId, alias, agent) {
    if (!this.config.dependencyPropagation)
      return;
    try {
      const messagesResult = await this.client.session.messages({
        path: { id: childSessionId }
      });
      const messages = messagesResult.data ?? [];
      let keyOutput = "";
      for (let i = messages.length - 1;i >= 0; i--) {
        if (messages[i].info?.role === "assistant") {
          for (const part of messages[i].parts ?? []) {
            if (part.type === "text" && part.text) {
              keyOutput = part.text.slice(0, 500).replace(/\n/g, " ");
              break;
            }
          }
          if (keyOutput)
            break;
        }
      }
      if (keyOutput) {
        this.dependencyCache.set(alias, {
          alias,
          agent,
          keyOutput,
          capturedAt: Date.now()
        });
      }
    } catch {}
  }
  formatMarker(contextId) {
    return formatContextMarker(contextId);
  }
  getStrategy(agentType) {
    return this.config.strategy[agentType] ?? "none";
  }
  cleanupStaleDependencies(maxAgeMs = 10 * 60 * 1000) {
    const now = Date.now();
    for (const [key, value] of this.dependencyCache) {
      if (now - value.capturedAt > maxAgeMs) {
        this.dependencyCache.delete(key);
      }
    }
  }
}

// src/context/strategy.ts
function resolveStrategy(agentType, defaults, override) {
  if (override)
    return override;
  return defaults[agentType] ?? "none";
}

// src/config/loader.ts
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
var CONFIG_PATH = path.join(os.homedir(), ".config", "opencode", "oh-my-opencode-cohub.json");
function loadCoHubConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH))
      return {};
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// src/tools/council.ts
import { tool } from "@opencode-ai/plugin";
var z = tool.schema;

class OperationTimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = "OperationTimeoutError";
  }
}
function isTextPart(part) {
  return (part.type === "text" || part.type === "reasoning") && typeof part.text === "string";
}
function shortModelLabel(model) {
  return model.split("/").pop() ?? model;
}
function parseModelReference(model) {
  const slashIndex = model.indexOf("/");
  if (slashIndex <= 0 || slashIndex >= model.length - 1)
    return null;
  return {
    providerID: model.slice(0, slashIndex),
    modelID: model.slice(slashIndex + 1)
  };
}
async function abortSession(client, sessionId) {
  try {
    await client.session.abort({ path: { id: sessionId } });
  } catch {}
}
async function promptWithTimeout(client, path2, body, timeoutMs, directory) {
  const sessionId = path2.id;
  let timer;
  try {
    const promptPromise = client.session.prompt({
      path: path2,
      body,
      query: directory ? { directory } : undefined
    });
    promptPromise.catch(() => {});
    const racers = [promptPromise];
    if (timeoutMs > 0) {
      racers.push(new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new OperationTimeoutError(`Prompt timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }));
    }
    await Promise.race(racers);
  } catch (error) {
    if (error instanceof OperationTimeoutError) {
      await abortSession(client, sessionId);
    }
    throw error;
  } finally {
    if (timer !== undefined)
      clearTimeout(timer);
  }
}
async function extractSessionResult(client, sessionId, options) {
  const includeReasoning = options?.includeReasoning ?? true;
  const messagesResult = await client.session.messages({
    path: { id: sessionId }
  });
  const messages = messagesResult.data ?? [];
  const assistantMessages = messages.filter((m) => m.info?.role === "assistant");
  const extractedContent = [];
  for (const message of assistantMessages) {
    for (const part of message.parts ?? []) {
      if (!isTextPart(part))
        continue;
      const allowed = includeReasoning || part.type === "text";
      if (allowed && part.text) {
        extractedContent.push(part.text);
      }
    }
  }
  const text = extractedContent.filter((t) => t.length > 0).join(`

`);
  return { text, empty: text.length === 0 };
}
function formatCouncillorPrompt(userPrompt, councillorPrompt) {
  if (!councillorPrompt)
    return userPrompt;
  return `${councillorPrompt}

---

${userPrompt}`;
}
function formatCouncillorResults(originalPrompt, councillorResults) {
  const completedWithResults = councillorResults.filter((cr) => cr.status === "completed" && cr.result);
  const councillorSection = completedWithResults.map((cr) => {
    const shortModel = shortModelLabel(cr.model);
    return `**${cr.name}** (${shortModel}):
${cr.result}`;
  }).join(`

`);
  const failedEntries = councillorResults.filter((cr) => cr.status !== "completed");
  const failedSection = failedEntries.map((cr) => `**${cr.name}**: ${cr.status} — ${cr.error ?? "Unknown"}`).join(`
`);
  if (completedWithResults.length === 0) {
    const errorDetails = councillorResults.map((cr) => `**${cr.name}** (${shortModelLabel(cr.model)}): ${cr.status} — ${cr.error ?? "Unknown"}`).join(`
`);
    return [
      "---",
      "",
      "**Original Prompt**:",
      originalPrompt,
      "",
      "---",
      "",
      "**Councillor Responses**:",
      "All councillors failed to produce output:",
      errorDetails,
      "",
      "Please generate a response based on the original prompt alone."
    ].join(`
`);
  }
  const parts = [
    "---",
    "",
    "**Original Prompt**:",
    originalPrompt,
    "",
    "---",
    "",
    "**Councillor Responses**:",
    councillorSection
  ];
  if (failedSection) {
    parts.push("", "---", "", "**Failed/Timed-out Councillors**:", failedSection);
  }
  parts.push("", "---", "", "You MUST follow the Synthesis Process steps before producing output: " + "review each councillor response individually, then produce the required output " + "with a synthesized Council Response, per-councillor details using their exact names, " + "and a Council Summary with consensus confidence rating (unanimous, majority, or split).");
  return parts.join(`
`);
}
function formatModelComposition(councillorResults) {
  return councillorResults.map((cr) => `${cr.name}: ${shortModelLabel(cr.model)}`).join(", ");
}

class CouncilManager {
  client;
  directory;
  config;
  constructor(client, directory, config) {
    this.client = client;
    this.directory = directory;
    this.config = config;
  }
  async runCouncil(prompt, presetName, parentSessionId) {
    const resolvedPreset = presetName ?? this.config.default_preset ?? "default";
    const preset = this.config.presets[resolvedPreset];
    if (!preset) {
      const available = Object.keys(this.config.presets).join(", ");
      return {
        success: false,
        error: `Preset "${resolvedPreset}" does not exist. Available presets: ${available}`,
        councillorResults: []
      };
    }
    if (Object.keys(preset).length === 0) {
      return {
        success: false,
        error: `Preset "${resolvedPreset}" has no councillors configured.`,
        councillorResults: []
      };
    }
    const timeout = this.config.timeout ?? 180000;
    const executionMode = this.config.councillor_execution_mode ?? "parallel";
    const maxRetries = this.config.councillor_retries ?? 3;
    const councillorResults = await this.runCouncillors(prompt, preset, parentSessionId, timeout, executionMode, maxRetries);
    const completedCount = councillorResults.filter((r) => r.status === "completed").length;
    if (completedCount === 0) {
      return {
        success: false,
        error: "All councillors failed or timed out",
        councillorResults
      };
    }
    const formatted = formatCouncillorResults(prompt, councillorResults);
    return {
      success: true,
      result: formatted,
      councillorResults
    };
  }
  async runCouncillors(prompt, councillors, parentSessionId, timeout, executionMode, maxRetries) {
    const entries = Object.entries(councillors);
    const results = [];
    if (executionMode === "serial") {
      for (const [name, config] of entries) {
        const r = await this.runCouncillorWithRetry(name, config, prompt, parentSessionId, timeout, maxRetries);
        results.push(r);
      }
    } else {
      const promises = entries.map(([name, config]) => this.runCouncillorWithRetry(name, config, prompt, parentSessionId, timeout, maxRetries));
      const settled = await Promise.allSettled(promises);
      for (let i = 0;i < settled.length; i++) {
        const s = settled[i];
        const [name, cfg] = entries[i];
        if (s.status === "fulfilled") {
          results.push(s.value);
        } else {
          results.push({
            name,
            model: cfg.model,
            status: "failed",
            error: s.reason instanceof Error ? s.reason.message : String(s.reason)
          });
        }
      }
    }
    return results;
  }
  async runCouncillorWithRetry(name, config, prompt, parentSessionId, timeout, maxRetries) {
    const totalAttempts = 1 + maxRetries;
    for (let attempt = 1;attempt <= totalAttempts; attempt++) {
      try {
        const result = await this.runAgentSession({
          parentSessionId,
          title: `Council ${name} (${shortModelLabel(config.model)})`,
          model: config.model,
          promptText: formatCouncillorPrompt(prompt, config.prompt),
          variant: config.variant,
          timeout
        });
        return { name, model: config.model, status: "completed", result };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        const isEmptyResponse = msg.includes("Empty response from provider");
        const canRetry = attempt < totalAttempts && isEmptyResponse;
        if (!canRetry) {
          return {
            name,
            model: config.model,
            status: msg.includes("timed out") ? "timed_out" : "failed",
            error: `Councillor "${name}": ${msg}`
          };
        }
      }
    }
    return {
      name,
      model: config.model,
      status: "failed",
      error: `Councillor "${name}": max retries exhausted`
    };
  }
  async runAgentSession(options) {
    const modelRef = parseModelReference(options.model);
    if (!modelRef) {
      throw new Error(`Invalid model format: ${options.model}`);
    }
    let sessionId;
    try {
      const session = await this.client.session.create({
        body: {
          parentID: options.parentSessionId,
          title: options.title
        },
        query: { directory: this.directory }
      });
      if (!session.data?.id) {
        throw new Error("Failed to create session");
      }
      sessionId = session.data.id;
      const promptBody = {
        model: modelRef,
        tools: {
          task: false,
          question: false,
          edit: false,
          write: false,
          apply_patch: false,
          ast_grep_replace: false,
          bash: false
        },
        parts: [{ type: "text", text: options.promptText }]
      };
      if (options.variant) {
        promptBody.variant = options.variant;
      }
      await promptWithTimeout(this.client, { id: sessionId }, promptBody, options.timeout, this.directory);
      const extraction = await extractSessionResult(this.client, sessionId);
      if (extraction.empty) {
        throw new Error("Empty response from provider");
      }
      return extraction.text;
    } finally {
      if (sessionId) {
        abortSession(this.client, sessionId).catch(() => {});
      }
    }
  }
}
function createCouncilTool(ctx, councilManager) {
  const council_session = tool({
    description: [
      "Launch a multi-LLM council session for consensus-based analysis.",
      "",
      "Sends the prompt to multiple models (councillors) in parallel and returns",
      "their formatted responses for you to synthesize.",
      "",
      "Returns the councillor responses with a summary footer."
    ].join(`
`),
    args: {
      prompt: z.string().describe("The prompt to send to all councillors"),
      preset: z.string().optional().describe('Council preset to use (default: "default"). Must match a preset in the council config.')
    },
    async execute(args, toolContext) {
      const allowedAgents = ["co-council"];
      const callingAgent = toolContext.agent;
      if (callingAgent && !allowedAgents.includes(callingAgent)) {
        throw new Error(`Council sessions can only be invoked by the co-council agent. Current agent: ${callingAgent}`);
      }
      const prompt = String(args.prompt);
      const preset = typeof args.preset === "string" ? args.preset : undefined;
      const parentSessionId = toolContext.sessionID;
      const result = await councilManager.runCouncil(prompt, preset, parentSessionId);
      if (!result.success) {
        return `Council session failed: ${result.error}`;
      }
      let output = result.result ?? "(No output)";
      const completed = result.councillorResults.filter((cr) => cr.status === "completed").length;
      const total = result.councillorResults.length;
      const composition = formatModelComposition(result.councillorResults);
      output += `

---
*Council: ${completed}/${total} councillors responded (${composition})*`;
      return output;
    }
  });
  return { council_session };
}

// src/index.ts
import * as fs2 from "node:fs";
import * as path2 from "node:path";
import * as os2 from "node:os";
var CHINESE_PROMPTS = {
  "co-orchestrator": ORCHESTRATOR_PROMPT,
  "co-oracle": ORACLE_PROMPT,
  "co-librarian": LIBRARIAN_PROMPT,
  "co-explorer": EXPLORER_PROMPT,
  "co-designer": DESIGNER_PROMPT,
  "co-fixer": FIXER_PROMPT,
  "co-observer": OBSERVER_PROMPT,
  "co-council": COUNCIL_PROMPT,
  "co-rule-user": RULE_USER_PROMPT,
  "co-rule-project": RULE_PROJECT_PROMPT,
  "co-rule-app": RULE_APP_PROMPT,
  "co-planner": PLANNER_PROMPT
};
function loadFileOverrides(projectDir) {
  const overrides = {};
  const agentNames = [
    "co-orchestrator",
    "co-oracle",
    "co-librarian",
    "co-explorer",
    "co-designer",
    "co-fixer",
    "co-observer",
    "co-council",
    "co-rule-user",
    "co-rule-project",
    "co-rule-app",
    "co-planner"
  ];
  const searchDirs = [];
  if (projectDir) {
    searchDirs.push(path2.join(projectDir, ".opencode", "oh-my-opencode-cohub"));
  }
  searchDirs.push(path2.join(os2.homedir(), ".config", "opencode", "oh-my-opencode-cohub"));
  for (const agent of agentNames) {
    for (const dir of searchDirs) {
      const replacePath = path2.join(dir, `${agent}.md`);
      if (!overrides[agent]?.replace && fs2.existsSync(replacePath)) {
        try {
          overrides[agent] = { ...overrides[agent], replace: fs2.readFileSync(replacePath, "utf-8") };
        } catch {}
      }
      const appendPath = path2.join(dir, `${agent}_append.md`);
      if (!overrides[agent]?.append && fs2.existsSync(appendPath)) {
        try {
          overrides[agent] = { ...overrides[agent], append: fs2.readFileSync(appendPath, "utf-8") };
        } catch {}
      }
    }
  }
  return overrides;
}
var CHINESE_INSTRUCTION = CHINESE_LANGUAGE_INSTRUCTION;
var CoHubPlugin = async (input, options) => {
  const projectDir = input.directory || process.cwd();
  const fileOverrides = loadFileOverrides(projectDir);
  const configOverrides = {};
  if (options?.overrides && typeof options.overrides === "object") {
    Object.assign(configOverrides, options.overrides);
  }
  const promptOverrides = { ...configOverrides, ...fileOverrides };
  const tracker = new TaskTracker;
  const STATE_DIR = path2.join(os2.homedir(), ".local", "share", "opencode", "storage", "oh-my-opencode-cohub");
  const STATE_FILE = path2.join(STATE_DIR, "tracker-state.json");
  function syncTrackerState(sessionId) {
    try {
      if (!fs2.existsSync(STATE_DIR)) {
        fs2.mkdirSync(STATE_DIR, { recursive: true });
      }
      const state = {
        updatedAt: Date.now(),
        runningAgents: tracker.getRunningAgents(sessionId),
        runningCount: tracker.getRunningCount(sessionId)
      };
      fs2.writeFileSync(STATE_FILE, JSON.stringify(state), "utf-8");
    } catch {}
  }
  const AGENT_CONFIG_FILE = path2.join(STATE_DIR, "cohub-state.json");
  function syncAgentConfig() {
    try {
      if (!fs2.existsSync(STATE_DIR)) {
        fs2.mkdirSync(STATE_DIR, { recursive: true });
      }
      const configs = agents.map((a) => {
        const modelStr = a.config.model;
        const parts = modelStr.split("/");
        const provider = parts.length > 1 ? parts[0] : "default";
        const shortModel = parts.length > 1 ? parts.slice(1).join("/") : modelStr;
        return {
          name: a.name,
          description: a.description,
          model: shortModel,
          variant: a.config.variant || null,
          provider
        };
      });
      fs2.writeFileSync(AGENT_CONFIG_FILE, JSON.stringify({ updatedAt: Date.now(), agents: configs }), "utf-8");
    } catch {}
  }
  const agents = [
    {
      name: "co-orchestrator",
      config: { mode: "primary", model: "deepseek/deepseek-v4-pro", variant: "max", prompt: ORCHESTRATOR_PROMPT + `

` + CHINESE_LANGUAGE_INSTRUCTION }
    },
    {
      name: "co-oracle",
      config: { mode: "subagent", model: "deepseek/deepseek-v4-pro", variant: "max", temperature: 0.1, prompt: "你是战略顾问。用中文回复。" }
    },
    {
      name: "co-librarian",
      config: { mode: "subagent", model: "deepseek/deepseek-v4-flash", prompt: "你是研究员。用中文回复。" }
    },
    {
      name: "co-explorer",
      config: { mode: "subagent", model: "deepseek/deepseek-v4-flash", prompt: "你是代码探索者。用中文回复。" }
    },
    {
      name: "co-designer",
      config: { mode: "subagent", model: "minimax/MiniMax-M3", variant: "medium", prompt: "你是设计师。用中文回复。" }
    },
    {
      name: "co-fixer",
      mode: "subagent",
      description: "执行者——代码修改、构建、测试",
      config: { mode: "subagent", model: "deepseek/deepseek-v4-flash", variant: "high", prompt: "你是执行者。用中文回复。" }
    },
    {
      name: "co-observer",
      description: "观察者——图片/PDF/截图视觉分析",
      config: { mode: "subagent", model: "codermxtest/gpt-5.5", prompt: "你是观察者。用中文回复。" }
    },
    {
      name: "co-council",
      description: "多模型共识——并行 LLM 综合",
      config: {
        mode: "subagent",
        model: "deepseek/deepseek-v4-pro",
        variant: "high",
        prompt: COUNCIL_PROMPT,
        permission: { council_session: "allow" }
      }
    },
    {
      name: "co-rule-user",
      description: "用户规范分析——~/.config/opencode/AGENTS.md",
      config: { mode: "subagent", model: "deepseek/deepseek-v4-flash", prompt: "你是用户规范分析代理。用中文回复。" }
    },
    {
      name: "co-rule-project",
      description: "项目规范分析——项目 AGENTS.md",
      config: { mode: "subagent", model: "deepseek/deepseek-v4-flash", prompt: "你是项目规范分析代理。用中文回复。" }
    },
    {
      name: "co-rule-app",
      description: "应用规则分析——.opencode/rules/*.md",
      config: { mode: "subagent", model: "deepseek/deepseek-v4-flash", prompt: "你是应用规则分析代理。用中文回复。" }
    },
    {
      name: "co-planner",
      description: "方案制定——综合需求+信息+规范输出任务分解",
      config: { mode: "subagent", model: "deepseek/deepseek-v4-pro", variant: "high", prompt: "你是方案制定代理。用中文回复。" }
    }
  ];
  const userConfig = loadCoHubConfig();
  if (userConfig.agents) {
    for (const agent of agents) {
      const override = userConfig.agents[agent.name];
      if (override) {
        if (override.model)
          agent.config.model = override.model;
        if (override.variant)
          agent.config.variant = override.variant;
        if (override.prompt)
          agent.config.prompt = override.prompt;
      }
    }
  }
  const DEFAULT_COUNCIL_CONFIG = {
    default_preset: "default",
    timeout: 180000,
    councillor_execution_mode: "parallel",
    councillor_retries: 3,
    presets: {
      default: {
        alpha: { model: "deepseek/deepseek-v4-pro", variant: "max" },
        beta: { model: "deepseek/deepseek-v4-flash", variant: "high" },
        gamma: { model: "minimax/MiniMax-M3", variant: "medium" }
      }
    }
  };
  const contextConfig = userConfig.context ?? {};
  const contextEngine = new ContextEngine(input.client, contextConfig);
  const councilConfig = userConfig.council ?? DEFAULT_COUNCIL_CONFIG;
  const councilManager = new CouncilManager(input.client, input.directory, councilConfig);
  const councilTools = createCouncilTool(input, councilManager);
  syncAgentConfig();
  function extractChildSessionId(output) {
    if (!output || typeof output !== "object")
      return;
    const o = output;
    const meta = o.metadata;
    if (meta) {
      if (typeof meta.sessionId === "string")
        return meta.sessionId;
      if (typeof meta.taskId === "string")
        return meta.taskId;
      if (typeof meta.task_id === "string")
        return meta.task_id;
      if (typeof meta.id === "string")
        return meta.id;
    }
    const text = typeof o.output === "string" ? o.output : "";
    const m = text.match(/\b(session|task)[_\s]?(?:id|ID)[:\s]+(\S+)/i);
    if (m)
      return m[2];
    return;
  }
  function extractSessionIdFromEvent(props) {
    if (!props || typeof props !== "object")
      return;
    const p = props;
    const info = p.info;
    if (info?.id)
      return info.id;
    if (typeof p.sessionID === "string")
      return p.sessionID;
    if (typeof p.sessionId === "string")
      return p.sessionId;
    return;
  }
  const STALE_TIMEOUT_MS = 30 * 60 * 1000;
  const cleanupTimer = setInterval(() => {
    try {
      tracker.cleanupStaleJobs(STALE_TIMEOUT_MS);
    } catch {}
  }, 30000);
  const contextCleanupTimer = setInterval(() => {
    try {
      contextEngine.cleanupStaleDependencies();
    } catch {}
  }, 60000);
  const agentConfigs = {};
  for (const agent of agents) {
    agentConfigs[agent.name] = {
      ...agent.config,
      name: agent.name,
      description: agent.description
    };
  }
  return {
    tool: councilTools,
    config: async (cfg) => {
      const c = cfg;
      c.agent ??= {};
      for (const [name, config] of Object.entries(agentConfigs)) {
        c.agent[name] = config;
      }
    },
    "tool.execute.before": async (input2, output) => {
      try {
        if (input2.tool === "task") {
          const args = output.args ?? {};
          const subagentType = typeof args.subagent_type === "string" ? args.subagent_type : undefined;
          const description = typeof args.description === "string" ? args.description : "";
          tracker.registerBeforeTask(input2.sessionID, {
            description,
            subagent_type: subagentType,
            task_id: typeof args.task_id === "string" ? args.task_id : undefined,
            background: typeof args.background === "boolean" ? args.background : undefined
          });
          syncTrackerState(input2.sessionID ?? "");
          if (subagentType) {
            const strategy = resolveStrategy(subagentType, contextEngine.getStrategy(subagentType) !== undefined ? { [subagentType]: contextEngine.getStrategy(subagentType) } : contextConfig.strategy ?? {}, typeof args.context_override === "string" ? args.context_override : undefined);
            if (strategy !== "none") {
              const contextId = contextEngine.registerContext({
                description
              });
              output.args ??= {};
              output.args.description = description + contextEngine.formatMarker(contextId);
              contextEngine.fillContextAsync(contextId, input2.sessionID, {
                strategy
              }).catch(() => {});
            }
          }
        }
      } catch {}
    },
    "tool.execute.after": async (input2, output) => {
      try {
        if (input2.tool === "cancel_task") {
          const args = input2.args;
          const taskId = args?.task_id;
          if (typeof taskId === "string")
            tracker.markCancelled(taskId);
          syncTrackerState(input2.sessionID ?? "");
        }
        if (input2.tool === "task") {
          const childSessionId = extractChildSessionId(output);
          tracker.updateAfterTask(input2.sessionID, "completed", childSessionId);
          syncTrackerState(input2.sessionID ?? "");
        }
      } catch {}
    },
    event: async (input2) => {
      try {
        const e = input2.event;
        const sessionId = extractSessionIdFromEvent(e.properties);
        if (!sessionId)
          return;
        if (e.type === "session.idle") {
          tracker.updateByChildSessionId(sessionId, "completed");
          syncTrackerState(tracker.currentParentSessionId);
          const job = tracker.getJobBySessionId(sessionId);
          if (job) {
            contextEngine.captureResult(sessionId, job.alias, job.agent);
          }
        } else if (e.type === "session.deleted" || e.type === "session.error") {
          tracker.updateByChildSessionId(sessionId, "errored");
          syncTrackerState(tracker.currentParentSessionId);
        }
      } catch {}
    },
    "experimental.chat.messages.transform": async (_input, output) => {
      try {
        if (output.messages && Array.isArray(output.messages)) {
          for (const msg of output.messages) {
            if (msg.info.role !== "user")
              continue;
            for (const part of msg.parts ?? []) {
              if (part.type !== "text" || !part.text)
                continue;
              contextEngine.consumeMarkedContext(part.text);
            }
          }
        }
        const board = tracker.getBoardText();
        if (board && output.messages && Array.isArray(output.messages)) {
          for (let i = output.messages.length - 1;i >= 0; i--) {
            const msg = output.messages[i];
            if (msg.info.role === "user") {
              for (let j = msg.parts.length - 1;j >= 0; j--) {
                const part = msg.parts[j];
                if (part.type === "text") {
                  part.text += `

` + board;
                  break;
                }
              }
              break;
            }
          }
        }
      } catch {}
    },
    "experimental.chat.system.transform": async (_input, output) => {
      output.system.push(CHINESE_LANGUAGE_INSTRUCTION);
    },
    dispose: async () => {
      clearInterval(cleanupTimer);
      clearInterval(contextCleanupTimer);
    }
  };
};
export {
  CoHubPlugin,
  CHINESE_PROMPTS,
  CHINESE_INSTRUCTION
};
