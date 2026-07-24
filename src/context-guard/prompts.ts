/** 上下文卫士 - 提示词模板 */

/** 三选一菜单文本（注入到 chat） */
export function renderGuardMenu(
  usedTokens: number,
  contextLimit: number,
  recommendation?: { option: string; confidence: number; reasoning: string },
): string {
  const ratio = ((usedTokens / contextLimit) * 100).toFixed(1);
  const recSection = recommendation
    ? `\n\n🧠 co-guardian 分析建议：\n   "${recommendation.reasoning}"\n   推荐选择：${recommendation.option}（置信度 ${(recommendation.confidence * 100).toFixed(0)}%）\n`
    : '';

  return [
    `╔══════════════════════════════════════════════════╗`,
    `║ ⚠️  上下文窗口已使用 ${ratio}%（约 ${Math.round(usedTokens / 1000)}K / ${Math.round(contextLimit / 1000)}K tokens） ║`,
    `║                                                  ║${recSection}`,
    `║ 请选择处理方式：                                   ║`,
    `║  1️⃣ 自动压缩 — 压缩旧消息，保留最近对话              ║`,
    `║  2️⃣ 会话压缩 — 触发 Compact Session               ║`,
    `║  3️⃣ 分析迁移 — 提取关键上下文，生成迁移文案           ║`,
    `║                                                  ║`,
    `║ 请回复数字 1、2 或 3                               ║`,
    `╚══════════════════════════════════════════════════╝`,
  ].join('\n');
}

/** 选项1执行后的确认消息 */
export const AUTO_COMPRESS_DONE = `✅ 自动压缩完成。旧消息已压缩为摘要占位符，最近对话完整保留。
  压缩后请继续当前工作，如有需要可使用 ultrapress_expand 恢复压缩内容。`;

/** 选项2的引导消息 */
export const SESSION_COMPACT_GUIDE = `✅ 准备触发 Compact Session。
  请在 OpenCode 中按 Ctrl+K，然后选择 "Compact Session"。
  或者使用命令 /compact 手动触发。
  压缩后当前会话将继续，关键上下文会被保留。`;

/** 选项3：co-guardian 分析会话用的系统提示 */
export const GUARDIAN_ANALYSIS_PROMPT = `你是一个会话上下文分析专家。请分析当前 OpenCode 会话状态，给出上下文处理的建议。

你需要分析以下方面：
1. 当前任务的完成进度（是否接近完成？是否还有大量工作？）
2. 错误/问题的严重程度（是否反复出现同样的错误？）
3. 关键文件的修改范围（是否涉及大量文件？是否核心逻辑？）
4. 决策密度（会话中是否有重要决策需要保留？）

然后从以下三个选项中推荐一个：
- auto-compress（自动压缩）：适合任务还在进行中，需要保留最近对话连续性
- session-compact（会话压缩）：适合任务接近完成，可以压缩整个会话
- migrate（分析迁移）：适合会话混乱、错误反复、需要整理后重开

请以 JSON 格式返回你的分析：
{
  "option": "auto-compress" | "session-compact" | "migrate",
  "confidence": 0.0-1.0,
  "reasoning": "简要推荐理由",
  "alternatives": "备选方案说明（可选）"
}`;

/** 迁移文案模板 */
export function renderMigrationText(ctx: {
  currentTask: string;
  keyFiles: string[];
  activeOperations: string[];
  errors: string[];
  decisions: string[];
}): string {
  const sections = [
    '## 📋 会话迁移上下文',
    '',
    '> 以下内容从当前会话自动提取，请复制到新会话窗口。',
    '',
    ctx.currentTask ? `### 🎯 当前任务\n${ctx.currentTask}` : '',
    ctx.keyFiles.length > 0 ? `### 📁 关键文件\n${ctx.keyFiles.map(f => `- ${f}`).join('\n')}` : '',
    ctx.activeOperations.length > 0 ? `### 🔧 进行中的操作\n${ctx.activeOperations.map(o => `- ${o}`).join('\n')}` : '',
    ctx.errors.length > 0 ? `### ⚠️ 错误/问题\n${ctx.errors.map(e => `- ${e}`).join('\n')}` : '',
    ctx.decisions.length > 0 ? `### 📝 决策记录\n${ctx.decisions.map(d => `- ${d}`).join('\n')}` : '',
    '',
    '---',
    '请在新会话中继续以上工作。',
  ];
  return sections.filter(Boolean).join('\n');
}
