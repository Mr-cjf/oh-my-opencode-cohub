/** 上下文卫士 - 选项3：分析迁移 */
import { renderMigrationText } from '../prompts';
import type { MigrationContext } from '../types';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

/**
 * 执行分析迁移：从最近消息中提取关键上下文，生成迁移文案
 */
export async function executeMigrate(
  sessionID: string,
  recentMessages: Array<{ role: string; content: string }>,
): Promise<string> {
  const ctx = extractFromMessages(recentMessages);

  // 生成迁移文案
  const text = renderMigrationText({
    currentTask: ctx.currentTask,
    keyFiles: ctx.keyFiles,
    activeOperations: ctx.activeOperations,
    errors: ctx.errors,
    decisions: ctx.decisions,
  });

  ctx.migrationText = text;

  // 保存到临时文件
  const tmpDir = path.join(os.tmpdir(), 'opencode');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }
  const filePath = path.join(tmpDir, `migrate-${sessionID.slice(0, 8)}.md`);
  fs.writeFileSync(filePath, text, 'utf-8');

  return `✅ 迁移文案已生成并保存到 \`${filePath}\`。

📋 **迁移文案预览：**

${text}

---
**使用方式：**
1. 复制上方文案内容
2. 打开新 OpenCode 会话窗口
3. 粘贴文案作为初始提示
4. 在新会话中继续工作

或回复 "重置当前会话" 在当前窗口重新开始。`;
}

/**
 * 从消息数组中提取关键信息
 */
function extractFromMessages(
  messages: Array<{ role: string; content: string }>,
): MigrationContext {
  const ctx: MigrationContext = {
    currentTask: '',
    keyFiles: [],
    activeOperations: [],
    errors: [],
    decisions: [],
    migrationText: '',
  };

  // 提取最后一条 user 消息作为当前任务
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      ctx.currentTask = messages[i].content.slice(0, 200);
      break;
    }
  }

  // 文件路径提取正则（Windows 和 Unix 路径）
  const filePattern = /(?:[a-zA-Z]:[/\\])?(?:\w+[/\\])*\w+\.\w{1,6}/g;
  // TODO/FIXME 模式
  const todoPattern = /(?:TODO|FIXME|HACK|XXX)[\s:：]+(.+)/gi;
  // 错误模式
  const errorPattern = /(?:error|错误|失败|fail|exception|异常)[\s:：]*(.+)/i;
  // 决策模式
  const decisionPattern = /(?:决定|采用|选择|使用|方案|架构|设计)[\s:：]+(.+)/i;

  for (const msg of messages) {
    // 文件路径
    const files = msg.content.match(filePattern);
    if (files) ctx.keyFiles.push(...files);

    // 进行中的操作 (TODO/FIXME)
    const todos = msg.content.match(todoPattern);
    if (todos) ctx.activeOperations.push(...todos.map(t => t.trim()));

    // 错误
    if (errorPattern.test(msg.content)) {
      const line = msg.content.split('\n').find(l => errorPattern.test(l));
      if (line) ctx.errors.push(line.trim().slice(0, 200));
    }

    // 决策
    const decisions = msg.content.match(decisionPattern);
    if (decisions) ctx.decisions.push(...decisions.map(d => d.trim().slice(0, 200)));
  }

  // 去重 + 限制数量
  ctx.keyFiles = [...new Set(ctx.keyFiles)].slice(0, 10);
  ctx.activeOperations = [...new Set(ctx.activeOperations)].slice(0, 5);
  ctx.errors = [...new Set(ctx.errors)].slice(0, 5);
  ctx.decisions = [...new Set(ctx.decisions)].slice(0, 5);

  // 兜底
  if (!ctx.currentTask) {
    ctx.currentTask = '（无法自动提取任务描述，请手动补充）';
  }
  if (ctx.keyFiles.length === 0) {
    ctx.keyFiles = ['（未检测到文件修改，请手动列出关键文件）'];
  }

  return ctx;
}
