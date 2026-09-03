// src/orchestration/contract.ts
// ContractManager — 上下文契约管理器，负责提取、构建和汇总 AgentContract

import type { AgentContract } from './types';

const CONTRACT_PATTERN = /<!-- CONTRACT_BEGIN -->\n([\s\S]*?)<!-- CONTRACT_END -->/;

export class ContractManager {
  /**
   * 从代理输出中提取结构化契约块。
   * 返回 null 表示未找到合法契约块。
   */
  extract(output: string): AgentContract | null {
    const match = output.match(CONTRACT_PATTERN);
    if (!match) return null;
    return this.parseLines(match[1].trim());
  }

  /**
   * 将契约块文本解析为 AgentContract 对象。
   * 行格式：- 关键结果: xxx
   */
  private parseLines(text: string): AgentContract {
    const lines = text.split('\n').map(l => l.replace(/^- /, '').trim());
    const get = (prefix: string): string => {
      const line = lines.find(l => l.startsWith(prefix));
      return line ? line.slice(prefix.length).trim() : '';
    };
    const getList = (prefix: string): string[] => {
      const val = get(prefix);
      return val ? val.split(',').map(s => s.trim()).filter(Boolean) : [];
    };
    return {
      keyResult: get('关键结果:'),
      decisions: getList('决策:'),
      filesChanged: getList('修改文件:'),
      validationStatus: (get('验证状态:') as AgentContract['validationStatus']) || 'unknown',
      validationDetail: get('验证详情:') || undefined,
      pendingItems: getList('待完成:'),
      warnings: getList('警告:'),
    };
  }

  /**
   * 构建传递给子代理的提示词，包含目标、约束和前置任务结果。
   * 输出包含 CONTRACT_BEGIN/END 标记，子代理可追加自己的契约。
   */
  buildPrompt(context: {
    goal: string;
    prerequisites: { from: string; contract: AgentContract }[];
    constraints: string[];
  }): string {
    const lines = ['<!-- CONTRACT_BEGIN -->', '## 本任务前置上下文'];
    lines.push(`- 目标: ${context.goal}`);
    if (context.constraints.length) {
      lines.push('- 约束:');
      context.constraints.forEach(c => lines.push(`  - ${c}`));
    }
    if (context.prerequisites.length) {
      lines.push('- 前置任务结果:');
      context.prerequisites.forEach(p => {
        lines.push(`  - ${p.from}: ${p.contract.keyResult}`);
        if (p.contract.decisions.length) {
          lines.push(`    - 决策: ${p.contract.decisions.join(', ')}`);
        }
        if (p.contract.warnings.length) {
          lines.push(`    - 警告: ${p.contract.warnings.join(', ')}`);
        }
      });
    }
    lines.push('<!-- CONTRACT_END -->');
    return lines.join('\n');
  }

  /**
   * 汇总多个契约，生成人类可读的报告。
   */
  summarize(contracts: AgentContract[]): string {
    const lines: string[] = [];
    contracts.forEach((c, i) => {
      lines.push(`### 契约 ${i + 1}: ${c.keyResult}`);
      lines.push(`- 验证状态: ${c.validationStatus}${c.validationDetail ? ` (${c.validationDetail})` : ''}`);
      if (c.decisions.length) lines.push(`- 决策: ${c.decisions.join(', ')}`);
      if (c.filesChanged.length) lines.push(`- 修改文件: ${c.filesChanged.join(', ')}`);
      if (c.pendingItems.length) lines.push(`- 待完成: ${c.pendingItems.join(', ')}`);
      if (c.warnings.length) lines.push(`- 警告: ${c.warnings.join(', ')}`);
    });
    return lines.join('\n');
  }
}