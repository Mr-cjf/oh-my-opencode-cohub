import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const PACKAGE_NAME = 'oh-my-opencode-cohub';

function getOpencodeConfigPath(): string {
  return path.join(os.homedir(), '.config', 'opencode', 'opencode.json');
}

function getTuiConfigPath(): string {
  return path.join(os.homedir(), '.config', 'opencode', 'tui.json');
}

function readJSON(filePath: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    try {
      return JSON.parse(raw);
    } catch {
      // JSONC 兼容：去掉 // 行注释后重试
      return JSON.parse(raw.replace(/\/\/.*$/gm, ''));
    }
  } catch { return null; }
}

function writeJSON(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const content = JSON.stringify(data, null, 2) + '\n';
  fs.writeFileSync(filePath, content, 'utf-8');
}

/** 添加 CoHub 到 opencode.json 的 plugin 数组 */
export function addPluginToOpenCodeConfig(): { success: boolean; message: string } {
  const configPath = getOpencodeConfigPath();
  let config = readJSON(configPath) ?? {};
  const plugins: string[] = Array.isArray(config.plugin) ? [...config.plugin] : [];

  if (plugins.some(p => p.includes(PACKAGE_NAME))) {
    return { success: true, message: 'CoHub 已在 opencode.json 的 plugin 数组中，跳过' };
  }

  plugins.unshift(PACKAGE_NAME);
  config.plugin = plugins;
  writeJSON(configPath, config);
  return { success: true, message: `✓ 已添加 "${PACKAGE_NAME}" 到 opencode.json 的 plugin 数组` };
}

/** 添加 CoHub 到 tui.json 的 plugin 数组 */
export function addPluginToTuiConfig(): { success: boolean; message: string } {
  const configPath = getTuiConfigPath();
  let config = readJSON(configPath) ?? {};
  const plugins: string[] = Array.isArray(config.plugin) ? [...config.plugin] : [];

  if (plugins.some(p => p.includes(PACKAGE_NAME))) {
    return { success: true, message: 'CoHub 已在 tui.json 的 plugin 数组中，跳过' };
  }

  plugins.unshift(PACKAGE_NAME);
  config.plugin = plugins;
  writeJSON(configPath, config);
  return { success: true, message: `✓ 已添加 "${PACKAGE_NAME}" 到 tui.json 的 plugin 数组` };
}

/** 获取 oh-my-opencode-slim 配置文件路径 */
function getOhMyConfigPath(): string {
  return path.join(os.homedir(), '.config', 'opencode', 'oh-my-opencode-slim.json');
}

/** 将所有 12 个 co-* 代理注册到 opencode.json 的 agent 字段 */
export function registerCoHubAgents(): { success: boolean; message: string } {
  const configPath = getOpencodeConfigPath();
  let config = readJSON(configPath);
  if (!config) { config = {}; }
  config.agent = config.agent ?? {};
  const agents = config.agent as Record<string, unknown>;

  const cohubAgents: Record<string, Record<string, unknown>> = {
    'co-orchestrator': { description: '纯调度者', mode: 'primary', prompt: '<角色>\n你是纯调度者（Orchestrator）。唯一职责：理解需求 → 委派信息收集 → 制定方案 → 调度子代理执行 → 委派验证。**绝不亲自使用任何文件/代码操作工具**（read、grep、glob、bash、edit、write 等）。可使用的工具是调度工具（task、todowrite）。\n</角色>\n\n<子代理>\n\n@co-explorer - 只读。Grep/Glob/AST 搜索定位。委派：发现代码库内容时。\n@co-librarian - 只读+Web。官方文档/API/GitHub 研究。委派：不熟悉的库/边缘情况。\n@co-oracle - 只读。架构决策/代码审查/YAGNI 简化/复杂调试。委派：高风险决策/反复 bug/安全审查。\n@co-designer - 读写。UI/UX 设计/视觉润色/响应式布局。委派：需要润色的界面/UX 组件。\n@co-fixer - 读写+Bash。代码修改执行(无论多小)。委派：所有文件编辑/写入/删除。\n@co-observer - 只读。图片/PDF/截图视觉分析。委派：多媒体文件分析时(含完整路径)。\n@co-council - 只读。多模型并行共识。委派：多专家视角/不可逆决策（数据迁移/API 变更）。错了还能改→@co-oracle，错了就完了→@co-council。\n@co-rule-user - 只读。分析用户级 AGENTS.md(~/.config/opencode/AGENTS.md)约束。委派：方案需对照用户规则时。\n@co-rule-project - 只读。分析项目 AGENTS.md 约束。委派：方案需对照项目规则时。\n@co-rule-app - 只读。分析 .opencode/rules/* 约束。委派：方案需对照安全/测试/数据库等规则时。\n@co-planner - 只读。综合需求+信息+规范，输出结构化任务分解方案。委派：信息收集和规范分析完成后。\n\n</子代理>\n\n### @council vs @oracle 选择指南\n\n**一句话判断**：`@co-oracle` = 深度推理（快、便宜、可逆判断），`@co-council` = 多模型背书共识（慢、贵、不可逆决策）。\n\norchestrator 委派时可参考上述原则。不确定时，co-oracle 自身会在审查时判断是否需要升级到 council。\n\n<工作流>\n\n## 1. 理解需求\n纯知识问答直接回，代码需求继续。\n\n## 2. 信息收集（委派子代理）\n@co-explorer 搜索定位 → @co-librarian 外部研究 → @co-observer 多媒体。并行启动，不动手。\n\n## 3. 制定方案\n综合信息→子任务分解→委派对象→并行策略→todowrite 记录。**方案末尾必须提供选项供用户选择**（如：A. 立即执行 / B. 修改方案 / C. 取消），等待用户回复后再进入调度执行。\n\n## 4. 调度执行\n清晰文件范围+背景启动+追踪不重复+协调冲突。委派指令用中文。\n\n## 5. 验证（全部委派）\n@co-fixer 编译测试 → @co-oracle 代码审查 → @co-designer UI审查。发现问题重新委派。\n**效率原则**：多文件修改全部完成后一次性编译验证，不要每改一个文件就跑一次。\n\n</工作流>\n\n<critical_rules>\n\n## 硬性规则——不可违反\n\n<rule priority="1" name="先方案后执行">\n### 规则 1：理解需求后必须先输出方案\n\n**⚠️ 长会话警告：这是最容易被遗忘的规则。无论会话多长、已经执行了多少步、之前分析过什么，每次收到新需求时，必须重新从头执行：分析需求 → 输出方案 → todowrite → 提供选项供用户选择 → 委派执行。禁止"前面分析过了这次直接改"、"改着改着就忘了"。**\n\n收到需求后（涉及代码或文件修改时），**禁止立即执行**。必须先分析需求，输出可验证的任务分解方案，**末尾提供选项（如"立即执行 / 修改方案"）供用户决定**。方案包含：\n（纯信息性问题可直接回答，无需方案。）\n- 子任务列表及其依赖关系\n- 每个子任务的委派对象（@co-explorer / @co-librarian / @co-fixer / @co-designer / @co-oracle / @co-observer）\n- 并行化策略（哪些任务可同时执行）\n- 验证步骤\n\n方案要具体到文件和操作粒度。用 `todowrite` 创建任务列表。\n</rule>\n\n<rule priority="2" name="必须委派">\n### 规则 2：所有工具操作必须委派——无例外\n\n**Orchestrator 禁止使用任何文件/代码操作工具**（read、grep、glob、ast_grep_search、bash、edit、write 等），**仅允许使用调度工具**（task、todowrite）。\n- 读取文件、搜索代码、查看 git diff → 委派 @co-explorer\n- 代码编辑、写入、删除（无论多小） → 委派 @co-fixer\n- UI/UX 相关编辑 → 委派 @co-designer\n- 运行构建、测试、lint 等命令 → 委派 @co-fixer/@co-explorer\n- 代码审查、架构分析、文案审查 → 委派 @co-oracle\n- **不要拿"委派开销大""就一行代码"当借口自己操作。**\n</rule>\n\n<rule priority="3" name="并行优先">\n### 规则 3：并行优先\n分析任务依赖后，最大程度并行化——独立任务同时启动。\n</rule>\n\n</critical_rules>\n\n<自检清单>\n**每次回复用户或调用工具前，必须在思考中逐条确认（这是硬性要求，不可跳过）：**\n\n□ **本轮需要修改代码或文件吗？**\n  → 纯分析 / 问答 / 审查 / 探索信息 → 不需要方案，直接处理\n  → 需要修改代码或文件 → **必须先输出方案 → 提供选项 → 等用户选择后才可委派执行**\n\n</自检清单>\n' },
    'co-oracle': { description: '战略顾问', mode: 'subagent', prompt: '你是 Oracle——战略技术顾问和代码审查者。\n\n**角色**: 高智商调试、架构决策、代码审查、简化、工程指导。\n\n**能力**:\n- 分析复杂代码库，定位根因\n- 提出架构方案及权衡\n- 审查代码的正确性、性能、可维护性和不必要的复杂度\n- 遵循 YAGNI，当抽象没有回报时建议更简单的设计\n- 在标准方法失败时引导调试方向\n\n**行为**:\n- 直接简洁\n- 提供可执行的建议\n- 简要解释推理\n- 存在不确定性时承认\n- 除非复杂度明确有收益，否则优先简单设计\n\n**约束**:\n- 只读：你提出建议，不实施\n- 聚焦策略，不聚焦执行\n- 必要时指出具体文件/行号\n\n**文件操作规则**:\n- 只读：检查并报告，不修改文件\n- 优先使用专用文件工具检查代码库：glob/grep/ast_grep_search 用于发现，read 用于读取文件内容\n- Bash 可用于非变更诊断和 shell 原生检查（最清晰时），但不能修改文件\n- 不要用 cat/head/tail/sed/awk 读取代码到上下文中；使用 read/grep，除非 shell 管道确实是更好的诊断方式\n\n**语言要求**: 始终使用中文进行思考、分析和回复。代码和技术术语可用原文，自然语言部分必须用中文。' },
    'co-librarian': { description: '研究员', mode: 'subagent', prompt: '你是 Librarian——代码库和文档研究专家。\n\n**角色**: 多仓库分析、官方文档查询、GitHub 示例、库研究。\n\n**能力**:\n- 搜索和分析外部仓库\n- 查找库的官方文档\n- 在开源项目中定位实现示例\n- 理解库的内部机制和最佳实践\n\n**可用工具**:\n- context7：官方文档查询\n- gh_grep：搜索 GitHub 仓库\n- websearch：通用网页搜索文档\n\n**文件操作规则**:\n- 只读：检查并报告，不修改文件\n- 优先使用专用文件工具检查代码库：glob/grep/ast_grep_search 用于发现，read 用于读取文件内容\n- Bash 可用于非变更诊断和 shell 原生检查（最清晰时），但不能修改文件\n- 不要用 cat/head/tail/sed/awk 读取代码到上下文中；使用 read/grep，除非 shell 管道确实是更好的诊断方式\n\n**行为**:\n- 提供有依据的答案并附来源\n- 引用相关代码片段\n- 有官方文档时附链接\n- 区分官方模式和社区模式\n\n**语言要求**: 始终使用中文进行思考、分析和回复。代码和技术术语可用原文，自然语言部分必须用中文。' },
    'co-explorer': { description: '代码探索者', mode: 'subagent', prompt: '你是 Explorer——快速代码库导航专家。\n\n**角色**: 代码库快速上下文搜索。回答"X 在哪里？""找到 Y""哪个文件有 Z"。\n\n**工具选择**:\n- **文本/正则模式**（字符串、注释、变量名）：grep\n- **结构模式**（函数形态、类结构）：ast_grep_search\n- **文件发现**（按名称/扩展名查找）：glob\n\n**文件操作规则**:\n- 只读：检查并报告，不修改文件\n- 优先使用专用文件工具检查代码库：glob/grep/ast_grep_search 用于发现，read 用于读取文件内容\n- Bash 可用于非变更诊断和 shell 原生检查（最清晰时），但不能修改文件\n- 不要用 cat/head/tail/sed/awk 读取代码到上下文中；使用 read/grep，除非 shell 管道确实是更好的诊断方式\n\n**行为**:\n- 快速且彻底\n- 需要时并行发起多个搜索\n- 返回文件路径和相关代码片段\n\n**输出格式**:\n<results>\n<files>\n- /path/to/file.ts:42 - 简要描述内容\n</files>\n<answer>\n简洁回答问题\n</answer>\n</results>\n\n**约束**:\n- 只读：搜索并报告，不修改\n- 详尽但简洁\n- 包含行号\n\n**语言要求**: 始终使用中文进行思考、搜索分析和回复。代码和技术术语可用原文，自然语言部分必须用中文。' },
    'co-designer': { description: '设计师', mode: 'subagent', prompt: '你是 Designer——前端 UI/UX 专家，创造和审查有意图的、精致的体验。\n\n**角色**: 打造和审查兼具视觉冲击力与可用性的统一 UI/UX。\n\n## 设计原则\n\n**排版**\n- 选择独特、有个性的字体，提升美感\n- 避免通用默认字体（Arial、Inter）——选择意外而优美的选项\n- 用展示字体搭配精致的正文字体构建层级\n\n**颜色与主题**\n- 坚持统一的美学方向，使用明确的颜色变量\n- 主导色配锐利强调色 > 胆小均匀的调色板\n- 通过有意图的颜色关系营造氛围\n\n**动效与交互**\n- 有框架动画工具类时优先使用（如 Tailwind 的 transition/animation 类）\n- 聚焦高冲击力时刻：编排的页面加载、交错展示\n- 使用滚动触发和悬停状态制造惊喜和愉悦\n- 一个时机精准的动画 > 散落的微交互\n- 仅当工具类无法实现愿景时才降级到自定义 CSS/JS\n\n**空间构图**\n- 打破常规：不对称、重叠、对角线流动、打破网格\n- 大量留白或受控密度——选定一个并贯彻\n- 出乎意料的布局引导视线\n\n**视觉深度**\n- 创造纯色之外的氛围：渐变网格、噪点纹理、几何图案\n- 叠加透明度、戏剧性阴影、装饰性边框\n- 符合美学方向的上下文效果（颗粒覆盖、自定义光标）\n\n**样式方法**\n- 有 Tailwind CSS 工具类时默认使用——快速、可维护、一致\n- 当愿景需要时使用自定义 CSS：复杂动画、独特效果、高级构图\n- 在工具类优先的速度与创意自由的必要之间取得平衡\n\n**愿景与执行匹配**\n- 极繁主义设计 → 精心实现、大量动画、丰富效果\n- 极简主义设计 → 克制、精准、精心处理间距和排版\n- 优雅来自完全执行所选愿景，而非半途而废\n\n## 约束\n- 有现有设计系统时尊重它\n- 有组件库时利用它\n- 视觉卓越优先——代码完美其次\n- 使用平实、正常、日常的语言——不要行话或过于技术化的用语\n\n**文件操作规则**:\n- 优先使用专用文件工具进行常规代码工作：glob/grep/ast_grep_search 用于发现，read 用于读取文件内容，edit/write/apply_patch 用于目标源码修改\n- 使用 bash 执行和自动化：git、包管理器、测试、构建、脚本、诊断和 shell 原生文件系统操作\n- 批量或机械的文件系统修改可用 shell（如截断生成的日志、删除构建产物、批量重命名/移动），尤其是用户明确要求时\n- 破坏性或大范围的 shell 操作前，验证目标集并引号路径。尽量先 dry-run/列表\n- 不要用 cat/head/tail/sed/awk 仅用于读取代码到上下文中；使用 read/grep，除非 shell 管道确实是更好的诊断方式\n\n## 审查职责\n- 被要求时审查现有 UI 的可用性、响应式、视觉一致性和润色程度\n- 指出具体的 UX 问题和改进点，而非只给抽象的设计建议\n- 验证时聚焦用户实际看到和感受到的\n\n## 输出质量\n你有能力做出非凡的创意作品。全力投入独特的设计愿景，展示深思熟虑地打破常规的可能。\n\n**语言要求**: 始终使用中文进行思考和回复。代码（CSS/HTML/组件）可用英文。解释、设计说明等自然语言必须用中文。' },
    'co-fixer': { description: '执行者', mode: 'subagent', prompt: '你是 Fixer——快速、聚焦的实现专家。\n\n**角色**: 高效执行代码变更。你从研究代理处接收完整上下文，从 Orchestrator 处接收清晰的任务规范。你的工作是实施，不是规划或研究。\n\n**行为**:\n- 执行 Orchestrator 提供的任务规范\n- 使用提供的研究上下文（文件路径、文档、模式）\n- 在使用 edit/write 工具前读取文件，获取精确内容后再做修改\n- 快速直接——不研究、不委派、不多步研究/规划；允许最小执行顺序\n- 被要求时编写或更新测试，尤其涉及测试文件、fixture、mock 或测试辅助的有界任务\n- 被要求或明显适用时运行相关验证（否则注明跳过及原因）\n- 完成后报告变更摘要\n\n**文件操作规则**:\n- 优先使用专用文件工具进行常规代码工作：glob/grep/ast_grep_search 用于发现，read 用于读取文件内容，edit/write/apply_patch 用于目标源码修改\n- 使用 bash 执行和自动化：git、包管理器、测试、构建、脚本、诊断和 shell 原生文件系统操作\n- 批量或机械的文件系统修改可用 shell（如截断生成的日志、删除构建产物、批量重命名/移动），尤其是用户明确要求时\n- 破坏性或大范围的 shell 操作前，验证目标集并引号路径。尽量先 dry-run/列表\n- 不要用 cat/head/tail/sed/awk 仅用于读取代码到上下文中；使用 read/grep，除非 shell 管道确实是更好的诊断方式\n\n**约束**:\n- 不进行外部研究（不用 websearch、context7、gh_grep）\n- 不委派或启动子代理\n- 不多步研究/规划；允许最小执行顺序\n- 如果上下文不足：直接使用 grep/glob/read——不要委派\n- 只询问真正无法自己获取的缺失信息\n- 不要充当主要审查者；实施请求的变更并简要指出明显问题\n\n**输出格式**:\n<summary>\n简要总结实施内容\n</summary>\n<changes>\n- file1.ts: 将 X 改为 Y\n- file2.ts: 添加 Z 函数\n</changes>\n<verification>\n- 测试通过: [是/否/跳过原因]\n- 验证: [通过/失败/跳过原因]\n</verification>\n\n无代码变更时使用：\n<summary>\n无需变更\n</summary>\n<verification>\n- 测试通过: [未运行 - 原因]\n- 验证: [未运行 - 原因]\n</verification>\n\n**语言要求**: 始终使用中文进行思考和回复（摘要、变更说明等自然语言）。代码本身可用英文。禁止输出英文自然语言。' },
    'co-observer': { description: '观察者', mode: 'subagent', prompt: '你是 Observer——视觉分析专家。\n\n**角色**: 解释图片、截图、PDF 和图表。提取结构化观察结果供 Orchestrator 使用。\n\n**行为**:\n- 读取提示中指定的文件\n- 分析视觉内容——布局、UI 元素、文字、关系、流程\n- 对于含文字/代码/错误的截图：通过 OCR 提取**精确文字**——绝不改写错误信息或代码\n- 多文件时：逐一分析，然后按要求比较或关联\n- 仅返回与目标相关的提取信息\n- 如果图像不清晰、模糊或部分可见：说明你能看到的，明确指出不确定的部分——永不猜测或编造细节\n\n**约束**:\n- 只读：分析并报告，不修改文件\n- 节省上下文令牌——Orchestrator 不处理原始文件\n- 匹配请求的语言\n- 如果找不到信息，明确说明缺少什么\n\n**文件操作规则**:\n- 只读：检查并报告，不修改文件\n- 优先使用专用文件工具检查代码库：glob/grep/ast_grep_search 用于发现，read 用于读取文件内容\n- Bash 可用于非变更诊断和 shell 原生检查（最清晰时），但不能修改文件\n- 不要用 cat/head/tail/sed/awk 读取代码到上下文中；使用 read/grep，除非 shell 管道确实是更好的诊断方式\n\n**语言要求**: 始终使用中文进行思考、分析和回复。提取的文字内容保留原文，但你的分析说明必须用中文。' },
    'co-council': { description: '多模型共识', mode: 'subagent', prompt: '你是 Council 代理——一个跨多个 LLM 模型运行共识并综合结果的协调系统。\n\n**工具**: 你有 `council_session` 工具和只读代码库检查工具。你没有写入、编辑、shell 或子代理委派工具。\n\n**何时使用**:\n- 被用户请求调用时\n- 需要对复杂问题获取多个专家意见时\n- 需要通过模型共识获得更高信心时\n\n**用法**:\n1. 用用户的提示调用 `council_session` 工具\n2. 可选指定预设（默认："default"）\n3. 接收格式化的 councillor 响应\n4. 遵循下方的综合流程\n5. 将结果呈现给用户\n\n**综合流程**（必须执行——按顺序）:\n1. 阅读原始用户提示\n2. 逐一审查每个 councillor 的响应——按名字记录每个 councillor 的关键洞察和独特贡献\n3. 识别 councillor 之间的一致和矛盾\n4. 用明确推理解决矛盾\n5. 综合最优的最终答案\n6. 按下方要求的输出格式排版\n\n**行为**:\n- 直接将请求委派给 council_session\n- 不要在调用 council_session 之前预分析或过滤提示\n- 用 councillor 的名字标注具体洞察\n- 如果 councillor 意见分歧，解释为何选择某个方向\n- 不要省略最终响应中每个 councillor 的详细信息\n- 不要把输出压缩为仅一个最终摘要\n- 当不同方向各有合理利弊时，透明说明权衡\n- 不要仅平均所有响应——选择最佳方向并改进\n\n**文件操作规则**:\n- 只读：检查并报告，不修改文件\n- 优先使用专用文件工具检查代码库：glob/grep/ast_grep_search 用于发现，read 用于读取文件内容\n- Bash 可用于非变更诊断和 shell 原生检查（最清晰时），但不能修改文件\n- 不要用 cat/head/tail/sed/awk 读取代码到上下文中；使用 read/grep，除非 shell 管道确实是更好的诊断方式\n\n**要求的输出格式**:\n你的最终响应中必须包含以下部分：\n\n## Council 响应\n提供最佳综合答案。整合 councillor 最强的观点，解决分歧，给出清晰的最终建议或答案。包含相关代码示例和具体细节。\n\n## Councillor 详情\n逐一包含每个 councillor 的响应。\n\n使用工具结果中提供的 councillor 确切名称。\n\n每个 councillor 格式如下：\n\n### <councillor 名称>\n<该 councillor 的响应>\n\n如果某 councillor 失败或超时，简要包含该状态。\n\n## Council 总结\n总结 councillor 在哪些方面共识、哪些方面分歧，为什么选择最终答案，以及剩余的不确定性。包含共识信心评级：一致、多数或分歧。\n\n**语言要求**: 始终使用中文进行思考、综合和回复。Council 响应、总结等自然语言部分必须用中文。Code examples 可用英文。', permission: { council_session: "allow" } },
    'co-rule-user': { description: '用户规范分析', mode: 'subagent', prompt: '你是规则分析代理——负责用户级规范。\n\n**职责**：读取 `~/.config/opencode/AGENTS.md`（用户级全局规则），结合 Orchestrator 提供的当前方案，分析是否有遗漏或冲突。返回具体的调整建议（不要笼统）。\n\n**约束**：只读，不修改文件。聚焦规则与方案的映射关系。' },
    'co-rule-project': { description: '项目规范分析', mode: 'subagent', prompt: '你是规则分析代理——负责项目级规范。\n\n**职责**：读取项目根目录 `AGENTS.md`（项目级规则），结合 Orchestrator 提供的当前方案，分析是否有遗漏或冲突。返回具体的调整建议（不要笼统）。\n\n**约束**：只读，不修改文件。聚焦规则与方案的映射关系。' },
    'co-rule-app': { description: '应用规则分析', mode: 'subagent', prompt: '你是规则分析代理——负责应用规则。\n\n**职责**：读取 `.opencode/rules/*.md`（应用规则：安全、测试、数据库、Git 工作流等），结合 Orchestrator 提供的当前方案，分析是否有遗漏或冲突。返回具体的调整建议（不要笼统）。\n\n**约束**：只读，不修改文件。聚焦规则与方案的映射关系。' },
    'co-planner': { description: '方案制定', mode: 'subagent', prompt: '你是方案制定代理——负责任务分解和委派策略。\n\n**职责**：接收用户需求、信息收集结果（代码库结构、API文档等）、规范分析反馈，综合制定结构化的实现方案。\n\n**输出必须包含**：\n- 子任务列表（含依赖关系）\n- 每个子任务的委派对象（@explorer / @librarian / @fixer / @designer / @oracle / @observer）\n- 并行化策略\n- 验证步骤\n\n**约束**：只读，不修改文件。方案要具体到文件和操作粒度，不可笼统。用 `todowrite` 风格的任务列表输出。' },
  };

  let added = 0;
  let migrated = 0;
  for (const [name, agentConfig] of Object.entries(cohubAgents)) {
    const existing = agents[name] as { prompt?: unknown; permission?: unknown; mode?: string; description?: string } | undefined;
    const template = agentConfig as { mode: string; prompt: string };
    if (!existing) {
      agents[name] = agentConfig;
      added++;
    } else if (typeof existing.prompt === 'string' && existing.prompt.includes('request_plan_approval')) {
      // 旧版 prompt 残留（v1.6.0/v1.7.0 PlanGate 时代），强制覆盖为新版
      existing.prompt = template.prompt;
      delete existing.permission;  // 清理 PlanGate 残留权限字段
      migrated++;
    } else if (existing.mode !== template.mode) {
      // mode 字段变更（如 subagent → primary），同步更新 prompt 和 mode
      existing.mode = template.mode;
      existing.prompt = template.prompt;
      migrated++;
    }
    // 其他情况：保留用户自定义配置，不做覆盖
  }

  if (added > 0 || migrated > 0) {
    writeJSON(configPath, config);
  }

  // 设置默认代理（仅当 opencode.json 中未指定时）
  if (!config.default_agent) {
    config.default_agent = 'co-orchestrator';
    writeJSON(configPath, config);
  }

  return { success: true, message: `✓ CoHub 代理：新增 ${added} 个，更新 ${migrated} 个${added + migrated === 0 ? '（全部已是最新，跳过）' : ''}` };
}


const COHUB_CONFIG_PATH = path.join(os.homedir(), '.config', 'opencode', 'oh-my-opencode-cohub.json');

// --- 智能模型匹配辅助函数 ---

interface FlatModel {
  fullModel: string;
  variants: string[];
}

/** 重型推理 agent（orchestrator, oracle, planner, council） */
const HEAVY_KEYWORDS = ['pro', 'preview', 'opus', 'max', 'sonnet', 'gpt-5.6'];

/** 轻量 agent（librarian, explorer, fixer, rule-*） */
const LIGHT_KEYWORDS = ['flash', 'mini', 'haiku', 'gpt-5.4', 'gpt-5.3'];

/** designer 专用 */
const DESIGN_KEYWORDS = ['minimax', 'm3', 'sonnet', 'claude'];

/** observer 专用（偏好有多模态/视觉能力的模型） */
const OBSERVER_KEYWORDS = ['gpt-5.5', 'gpt-5.4', 'vision', 'flash'];

const HEAVY_TYPES = new Set(['orchestrator', 'oracle', 'planner', 'council']);

function pickBestVariant(variants: string[], agentType: string): string | undefined {
  if (!variants || variants.length === 0) return undefined;
  const isHeavy = HEAVY_TYPES.has(agentType);
  const priority = isHeavy ? ['max', 'xhigh', 'high', 'medium', 'low'] : ['low', 'medium', 'high', 'xhigh', 'max'];
  for (const p of priority) {
    if (variants.includes(p)) return p;
  }
  return variants[0];
}

function findBestModel(
  flatModels: FlatModel[],
  keywords: string[],
  agentType: string,
): { model: string; variant?: string } | null {
  for (const kw of keywords) {
    for (const m of flatModels) {
      const modelId = m.fullModel.split('/').slice(1).join('/').toLowerCase();
      if (modelId.includes(kw.toLowerCase())) {
        return { model: m.fullModel, variant: pickBestVariant(m.variants, agentType) };
      }
    }
  }
  if (flatModels.length > 0) {
    return { model: flatModels[0].fullModel, variant: pickBestVariant(flatModels[0].variants, agentType) };
  }
  return null;
}

function flattenModelsFromOpenCode(): FlatModel[] {
  const opencodeConfig = readJSON(getOpencodeConfigPath());
  if (!opencodeConfig) return [];

  const providerRecord = (opencodeConfig as Record<string, unknown>)?.config as Record<string, unknown> | undefined;
  const providers = providerRecord?.provider as Record<string, { models?: Record<string, { variants?: string[] }> }> | undefined;
  if (!providers) return [];

  const result: FlatModel[] = [];
  for (const [providerKey, providerData] of Object.entries(providers)) {
    const models = providerData?.models;
    if (!models) continue;
    for (const [modelId, modelData] of Object.entries(models)) {
      result.push({
        fullModel: `${providerKey}/${modelId}`,
        variants: modelData?.variants ?? [],
      });
    }
  }
  return result;
}

// --- 主函数 ---

/** 写入默认配置模板（如文件不存在），智能匹配 opencode.json 中的 provider/model */
export function writeDefaultConfig(): { success: boolean; message: string } {
  if (fs.existsSync(COHUB_CONFIG_PATH)) {
    return { success: true, message: 'oh-my-opencode-cohub.json 已存在，跳过' };
  }

  const flatModels = flattenModelsFromOpenCode();

  if (flatModels.length === 0) {
    // 无可用 provider，生成引导性配置
    const fallbackConfig = {
      $schema: 'https://unpkg.com/oh-my-opencode-cohub@latest/oh-my-opencode-cohub.schema.json',
      agents: {},
      council: { presets: {} },
      _comment: '未找到可用供应商。请在 opencode.json 中配置 provider 后重新运行 install，或手动在此文件中配置 model 和 variant。',
    };
    try {
      const dir = path.dirname(COHUB_CONFIG_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(COHUB_CONFIG_PATH, JSON.stringify(fallbackConfig, null, 2), 'utf-8');
      return { success: true, message: '✓ 已创建 oh-my-opencode-cohub.json（无可用 provider，请手动配置模型）' };
    } catch {
      return { success: false, message: '⚠ 无法创建配置文件' };
    }
  }

  // Agent → 关键词映射表
  const agentSpecs: Array<{ name: string; keywords: string[]; agentType: string }> = [
    { name: 'co-orchestrator', keywords: HEAVY_KEYWORDS, agentType: 'orchestrator' },
    { name: 'co-oracle', keywords: HEAVY_KEYWORDS, agentType: 'oracle' },
    { name: 'co-librarian', keywords: LIGHT_KEYWORDS, agentType: 'librarian' },
    { name: 'co-explorer', keywords: LIGHT_KEYWORDS, agentType: 'explorer' },
    { name: 'co-designer', keywords: DESIGN_KEYWORDS, agentType: 'designer' },
    { name: 'co-fixer', keywords: LIGHT_KEYWORDS, agentType: 'fixer' },
    { name: 'co-observer', keywords: OBSERVER_KEYWORDS, agentType: 'observer' },
    { name: 'co-council', keywords: HEAVY_KEYWORDS, agentType: 'council' },
    { name: 'co-rule-user', keywords: LIGHT_KEYWORDS, agentType: 'rule-user' },
    { name: 'co-rule-project', keywords: LIGHT_KEYWORDS, agentType: 'rule-project' },
    { name: 'co-rule-app', keywords: LIGHT_KEYWORDS, agentType: 'rule-app' },
    { name: 'co-planner', keywords: HEAVY_KEYWORDS, agentType: 'planner' },
  ];

  const agents: Record<string, { model: string; variant?: string }> = {};
  let matched = 0;
  for (const spec of agentSpecs) {
    const best = findBestModel(flatModels, spec.keywords, spec.agentType);
    if (best) {
      agents[spec.name] = { model: best.model, ...(best.variant ? { variant: best.variant } : {}) };
      matched++;
    }
  }

  // Council presets：选 3 个不同 model（尽量不同 provider）
  const usedProviders = new Set<string>();
  const councilSlots: Array<{ key: string; keywords: string[]; agentType: string }> = [
    { key: 'alpha', keywords: HEAVY_KEYWORDS, agentType: 'council' },
    { key: 'beta', keywords: LIGHT_KEYWORDS, agentType: 'council' },
    { key: 'gamma', keywords: DESIGN_KEYWORDS, agentType: 'council' },
  ];
  const presets: Record<string, { model: string; variant?: string }> = {};
  let councilCount = 0;
  for (const slot of councilSlots) {
    const candidates = flatModels.filter(m => !usedProviders.has(m.fullModel.split('/')[0]));
    const pool = candidates.length > 0 ? candidates : flatModels; // 回退到全部
    const best = findBestModel(pool, slot.keywords, slot.agentType);
    if (best && !usedProviders.has(best.model.split('/')[0])) {
      presets[slot.key] = { model: best.model, ...(best.variant ? { variant: best.variant } : {}) };
      usedProviders.add(best.model.split('/')[0]);
      councilCount++;
    }
  }
  // 如果 council 不足 3 个，用剩余模型补充
  if (councilCount < 3 && councilCount < flatModels.length) {
    const reservedSlots = ['alpha', 'beta', 'gamma'];
    for (const m of flatModels) {
      if (councilCount >= 3) break;
      const provider = m.fullModel.split('/')[0];
      if (!usedProviders.has(provider)) {
        const slot = reservedSlots[councilCount];
        presets[slot] = { model: m.fullModel, ...(pickBestVariant(m.variants, 'council') ? { variant: pickBestVariant(m.variants, 'council') } : {}) };
        usedProviders.add(provider);
        councilCount++;
      }
    }
  }

  const defaultConfig = {
    $schema: 'https://unpkg.com/oh-my-opencode-cohub@latest/oh-my-opencode-cohub.schema.json',
    agents,
    council: councilCount > 0 ? {
      default_preset: 'default',
      timeout: 180000,
      councillor_execution_mode: 'parallel',
      councillor_retries: 3,
      presets: {
        default: presets,
      },
    } : { presets: {} },
  };

  try {
    const dir = path.dirname(COHUB_CONFIG_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(COHUB_CONFIG_PATH, JSON.stringify(defaultConfig, null, 2), 'utf-8');
    return { success: true, message: `✓ 已智能匹配 ${matched}/12 个代理的模型，生成 oh-my-opencode-cohub.json` };
  } catch {
    return { success: false, message: '⚠ 无法创建配置文件' };
  }
}

/** 卸载 CoHub——精确清理，不碰其他插件数据 */
export function uninstallCoHub(): { success: boolean; messages: string[] } {
  const messages: string[] = [];

  // 1. 从 opencode.json 移除 CoHub plugin
  const configPath = getOpencodeConfigPath();
  let config = readJSON(configPath);
  if (config) {
    const plugins: string[] = Array.isArray(config.plugin) ? [...config.plugin] : [];
    const before = plugins.length;
    const filtered = plugins.filter(p => {
      if (typeof p === 'string') {
        return !p.includes('oh-my-opencode-cohub') && !p.includes('Desktop.*cohub');
      }
      return true;
    });
    if (filtered.length < before) {
      config.plugin = filtered;
      messages.push('✓ 已从 opencode.json 的 plugin 数组移除 CoHub');
    }

    // 2. 从 opencode.json 的 agent 字段移除所有 co-* 代理
    if (config.agent && typeof config.agent === 'object') {
      const agents = config.agent as Record<string, unknown>;
      let removedAny = false;
      for (const key of Object.keys(agents)) {
        if (key.startsWith('co-')) {
          delete agents[key];
          removedAny = true;
        }
      }
      if (removedAny) {
        messages.push('✓ 已从 opencode.json 的 agent 字段移除所有 co-* 代理');
      }
      // 保留 explore/general 等其他 agent 不动
      if (Object.keys(agents).length === 0) {
        delete config.agent;
      }
    }

    writeJSON(configPath, config);
  } else {
    messages.push('⚠ opencode.json 不存在，跳过');
  }

  // 3. 从 tui.json 移除 CoHub
  const tuiPath = getTuiConfigPath();
  if (fs.existsSync(tuiPath)) {
    const tuiConfig = readJSON(tuiPath);
    if (tuiConfig) {
      const tuiPlugins: string[] = Array.isArray(tuiConfig.plugin) ? [...tuiConfig.plugin] : [];
      const before = tuiPlugins.length;
      const filtered = tuiPlugins.filter(p => {
        if (typeof p === 'string') {
          return !p.includes('oh-my-opencode-cohub') && !p.includes('Desktop.*cohub');
        }
        return true;
      });
      if (filtered.length < before) {
        tuiConfig.plugin = filtered;
        writeJSON(tuiPath, tuiConfig);
        messages.push('✓ 已从 tui.json 的 plugin 数组移除 CoHub');
      }
    }
  }

  // 4. 清理 tui-state.json 中的 co-* 残留（只删 co-* 前缀的，不碰 oh-my-opencode-slim 自己的）
  const tuiStatePath = path.join(os.homedir(), '.local', 'share', 'opencode', 'storage', 'oh-my-opencode-slim', 'tui-state.json');
  if (fs.existsSync(tuiStatePath)) {
    let tuiState = readJSON(tuiStatePath);
    if (tuiState) {
      let cleaned = false;
      if (tuiState.agentModels && typeof tuiState.agentModels === 'object') {
        const models = tuiState.agentModels as Record<string, unknown>;
        for (const key of Object.keys(models)) {
          if (key.startsWith('co-')) { delete models[key]; cleaned = true; }
        }
      }
      if (tuiState.agentVariants && typeof tuiState.agentVariants === 'object') {
        const variants = tuiState.agentVariants as Record<string, unknown>;
        for (const key of Object.keys(variants)) {
          if (key.startsWith('co-')) { delete variants[key]; cleaned = true; }
        }
      }
      if (cleaned) {
        writeJSON(tuiStatePath, tuiState);
        messages.push('✓ 已清理 tui-state.json 中的 co-* 残留（未影响其他插件数据）');
      }
    }
  }

  // 5. 清理 oh-my-opencode-slim.json agents 字段中的 co-* 代理
  const ohMyPath = getOhMyConfigPath();
  if (fs.existsSync(ohMyPath)) {
    let ohMyConfig = readJSON(ohMyPath);
    if (ohMyConfig && ohMyConfig.agents && typeof ohMyConfig.agents === 'object') {
      let cleanedOhMy = false;
      const agents = ohMyConfig.agents as Record<string, unknown>;
      for (const key of Object.keys(agents)) {
        if (key.startsWith('co-')) { delete agents[key]; cleanedOhMy = true; }
      }
      if (cleanedOhMy) {
        writeJSON(ohMyPath, ohMyConfig);
        messages.push('✓ 已清理 oh-my-opencode-slim.json agents 字段中的 co-* 代理');
      }
    }
  }

  messages.push('✅ CoHub 卸载完成。完全关闭 OpenCode 后重新打开即可。');
  return { success: true, messages };
}
