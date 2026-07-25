#!/usr/bin/env node
import { version } from '../../package.json';
import { addPluginToOpenCodeConfig, addPluginToTuiConfig, registerCoHubAgents, writeDefaultConfig, uninstallCoHub } from './config-io';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === 'install') {
    console.log(`🚀 oh-my-opencode-cohub v${version} 安装中...\n`);

    // 1. 注册到 opencode.json
    const r1 = addPluginToOpenCodeConfig();
    console.log(r1.message);

    // 2. 注册到 tui.json
    const r2 = addPluginToTuiConfig();
    console.log(r2.message);

    // 3. 注册所有 13 个 co-* 代理到 opencode.json 的 agent 字段
    const r3 = registerCoHubAgents();
    console.log(r3.message);

    // 4. 写入默认配置文件
    const r4 = writeDefaultConfig();
    console.log(r4.message);

    console.log('\n✅ CoHub 安装完成！');
    console.log('   重启 OpenCode 后，TAB 选择 "co-orchestrator" 开始纯调度模式。');
    console.log('   已注册 13 个 co-* 代理到 opencode.json 的 agent 字段。');
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
