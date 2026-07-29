#!/usr/bin/env node
import { version } from '../../package.json';
import { addPluginToOpenCodeConfig, addPluginToTuiConfig, registerCoHubAgents, writeDefaultConfig, uninstallCoHub, installToCacheDir } from './config-io';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === 'install') {
    console.log(`🚀 oh-my-opencode-cohub v${version} 安装中...\n`);

    // 0. 安装到缓存目录（含完整 node_modules）
    const r0 = installToCacheDir(version);
    console.log(r0.message);

    // 1. 注册到 opencode.json
    const r1 = addPluginToOpenCodeConfig(version);
    console.log(r1.message);

    // 2. 注册到 tui.json
    const r2 = addPluginToTuiConfig();
    console.log(r2.message);

    // 3. 注册所有 12 个 co-* 代理到 opencode.json 的 agent 字段
    const r3 = registerCoHubAgents();
    console.log(r3.message);

    // 4. 写入默认配置文件
    const r4 = writeDefaultConfig();
    console.log(r4.message);

    console.log('\n✅ CoHub 安装完成！');
    console.log('   重启 OpenCode 后，TAB 选择 "co-orchestrator" 主控代理。');
    console.log('   12 个 co-* 子代理可在对话中通过 @名称 或 task() 派发调用。');
    console.log('   模型和 variant 配置通过 config hook 从 oh-my-opencode-cohub.json 注入。');

    console.log(`\n${'='.repeat(60)}`);
    console.log('📋 已自动生成默认代理模型配置。如需自定义，可复制以下文案让 AI 帮你优化：');
    console.log(`${'='.repeat(60)}\n`);

    const aiPrompt = `
## 你的任务

帮我生成 oh-my-opencode-cohub 的配置文件。

**要求：收到后先分析我的环境、输出配置方案表格、等我确认后再写入文件，不要直接动手改。**

## 执行步骤

### 第一步：分析环境

读取 \`~/.config/opencode/opencode.json\`，找到所有已配置的 provider 和 model，整理成表格给我看。

### 第二步：输出配置方案

根据下面规则，输出每个代理的 model 和 variant 分配表格，等我确认。

### 第三步：写入文件

确认后将配置写入 \`~/.config/opencode/oh-my-opencode-cohub.json\`。

## 配置文件结构

\`\`\`json
{
  "$schema": "https://unpkg.com/oh-my-opencode-cohub@latest/oh-my-opencode-cohub.schema.json",
  "agents": {
    "co-orchestrator": { "model": "provider/model", "variant": "max" },
    ...
  },
  "council": {
    "default_preset": "default",
    "timeout": 180000,
    "councillor_execution_mode": "parallel",
    "councillor_retries": 3,
    "presets": {
      "default": {
        "alpha": { "model": "provider/model", "variant": "max" },
        "beta":  { "model": "provider/model", "variant": "high" },
        "gamma": { "model": "provider/model", "variant": "medium" }
      }
    }
  }
}
\`\`\`

## 12 个代理配置规则

| 代理 | 角色 | 推理强度 | variant 建议 | 模型偏好 |
|------|------|---------|-------------|---------|
| co-orchestrator | 纯调度者，编排任务、委派执行 | **重型** | max / xhigh | pro、max、sonnet、opus 等强推理模型 |
| co-oracle | 战略顾问，架构审查、复杂调试 | **重型** | max / xhigh | 同上 |
| co-planner | 方案制定，综合信息输出任务分解 | **重型** | max / xhigh | 同上 |
| co-council | 多模型共识，跨多个 LLM 综合 | **重型** | high / xhigh | 同上 |
| co-librarian | 研究员，查文档、搜 GitHub、Web 搜索 | **轻型** | low / medium | flash、mini、haiku 等轻量快速模型 |
| co-explorer | 代码探索者，grep/glob 搜索定位 | **轻型** | low / medium | 同上 |
| co-fixer | 执行者，代码修改、编译、测试 | **轻型** | low / medium | 同上 |
| co-rule-user | 分析用户级 AGENTS.md 规范 | **轻型** | low / medium | 同上 |
| co-rule-project | 分析项目 AGENTS.md 规范 | **轻型** | low / medium | 同上 |
| co-rule-app | 分析 .opencode/rules/* 应用规则 | **轻型** | low / medium | 同上 |
| co-designer | 设计师，UI/UX 设计、视觉润色 | **中等** | high / medium | sonnet、claude、minimax 等前端/视觉强的模型 |
| co-observer | 观察者，图片/PDF/截图视觉分析 | **中等** | medium / high | vision、flash 等支持视觉的模型 |

## council 详细说明

council 是内置的多模型共识机制，会将同一个问题发给 3 个 councillor 并行回答，然后综合出最优方案。

| councillor | 角色定位 | 推理强度 | variant 建议 |
|-----------|---------|---------|-------------|
| alpha | 主力深度推理 | **重型** | max / xhigh |
| beta | 第二视角互补 | **轻型/中等** | high |
| gamma | 第三方校验 | **中等** | medium / high |

**关键配置项说明：**

| 字段 | 默认值 | 说明 |
|------|--------|------|
| \`default_preset\` | \`"default"\` | 默认使用的 preset 名称，可以定义多个 preset（如 \`"quick"\` 快速共识、\`"deep"\` 深度共识） |
| \`timeout\` | \`180000\`（3 分钟） | 单个 councillor 的超时时间（毫秒），所有 councillor 并行执行 |
| \`councillor_execution_mode\` | \`"parallel"\` | 执行模式：\`"parallel"\` 并行（快）或 \`"serial"\` 串行（省 tokens） |
| \`councillor_retries\` | \`3\` | 单个 councillor 调用失败后的重试次数 |

**presets 示例（多套配置）：**

\`\`\`json
"presets": {
  "default": {
    "alpha": { "model": "deepseek/deepseek-v4-pro", "variant": "max" },
    "beta":  { "model": "anthropic/claude-sonnet-4-20250514", "variant": "high" },
    "gamma": { "model": "openai/gpt-5.2", "variant": "high" }
  },
  "quick": {
    "alpha": { "model": "deepseek/deepseek-v4-pro", "variant": "high" },
    "beta":  { "model": "openai/gpt-5.2", "variant": "medium" },
    "gamma": { "model": "anthropic/claude-sonnet-4-20250514", "variant": "medium" }
  }
}
\`\`\`

## 分配规则

- 从 opencode.json 读取已配置的 provider，按上表规则为每个代理分配 model 和 variant
- 只有 1 个 provider：所有代理都用它，variant 按表格建议选不同档位
- 有多个 provider：重型代理优先选最强推理 provider，轻型选最快 provider
- council 的 alpha/beta/gamma 优先选 3 个不同 provider；不够 3 个时用同一 provider 的不同 model
- opencode.json 无任何 provider 时，生成占位配置并在 \`_comment\` 字段提示用户先配置

## 注意

- 只写入 \`oh-my-opencode-cohub.json\`，不要修改 \`opencode.json\`
- agent 名必须用 \`co-\` 前缀（共 12 个），不要遗漏
`;

    // 去掉首尾空白行，逐行输出（保持 console 输出的可读性）
    const lines = aiPrompt.trim().split('\n');
    for (const line of lines) {
      console.log(line);
    }

    console.log(`\n${'='.repeat(60)}`);

  } else if (command === 'uninstall') {
    console.log('🧹 CoHub 卸载中...\n');
    const result = uninstallCoHub();
    for (const msg of result.messages) {
      console.log(msg);
    }
  } else {
    console.log('CoHub - OpenCode 中文智能体编排插件');
    console.log('');
    console.log('用法:');
    console.log('  bunx oh-my-opencode-cohub install      安装 CoHub');
    console.log('  bunx oh-my-opencode-cohub uninstall    卸载 CoHub');
  }
}

main().catch(console.error);
