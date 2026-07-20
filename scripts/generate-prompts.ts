/**
 * 构建辅助脚本：将 src/prompts/*.md 转换为 src/prompts/*.ts
 * 用法：bun run scripts/generate-prompts.ts
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const PROMPTS_DIR = path.resolve(__dirname, '..', 'src', 'prompts');

interface AgentDef {
  file: string;
  exportName: string;
}

const AGENTS: AgentDef[] = [
  { file: 'orchestrator', exportName: 'ORCHESTRATOR_PROMPT' },
  { file: 'oracle', exportName: 'ORACLE_PROMPT' },
  { file: 'librarian', exportName: 'LIBRARIAN_PROMPT' },
  { file: 'explorer', exportName: 'EXPLORER_PROMPT' },
  { file: 'designer', exportName: 'DESIGNER_PROMPT' },
  { file: 'fixer', exportName: 'FIXER_PROMPT' },
  { file: 'observer', exportName: 'OBSERVER_PROMPT' },
  { file: 'council', exportName: 'COUNCIL_PROMPT' },
  { file: 'planner', exportName: 'PLANNER_PROMPT' },
  { file: 'rule-user', exportName: 'RULE_USER_PROMPT' },
  { file: 'rule-project', exportName: 'RULE_PROJECT_PROMPT' },
  { file: 'rule-app', exportName: 'RULE_APP_PROMPT' },
];

let generated = 0;

for (const { file, exportName } of AGENTS) {
  const mdPath = path.join(PROMPTS_DIR, `${file}.md`);
  const tsPath = path.join(PROMPTS_DIR, `${file}.ts`);

  if (!fs.existsSync(mdPath)) {
    console.error(`❌ 缺少源文件: ${mdPath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(mdPath, 'utf-8');

  // 转义：反斜杠、反引号、美元符号（防止模板字符串插值）
  const escaped = content
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$');

  const tsContent = [
    `// 自动生成，请勿手动编辑。源文件：src/prompts/${file}.md`,
    `// 运行 scripts/generate-prompts.ts 重新生成`,
    `export const ${exportName} = \`${escaped}\`;`,
    '',
  ].join('\n');

  fs.writeFileSync(tsPath, tsContent, 'utf-8');
  generated++;
}

console.log(`✅ 已生成 ${generated} 个提示词文件到 src/prompts/`);
