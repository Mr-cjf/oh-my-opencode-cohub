import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';

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
export function addPluginToOpenCodeConfig(version: string): { success: boolean; message: string } {
  const configPath = getOpencodeConfigPath();
  let config = readJSON(configPath) ?? {};
  const plugins: string[] = Array.isArray(config.plugin) ? [...config.plugin] : [];

  const pkgSpec = `${PACKAGE_NAME}@${version}`;

  // 检查已有条目（忽略版本号差异）
  if (plugins.some(p => p.includes(PACKAGE_NAME))) {
    // 更新为当前版本
    for (let i = 0; i < plugins.length; i++) {
      if (plugins[i].includes(PACKAGE_NAME)) {
        plugins[i] = pkgSpec;
      }
    }
    config.plugin = plugins;
    writeJSON(configPath, config);
    return { success: true, message: `✓ 已更新 "${pkgSpec}" 到 opencode.json 的 plugin 数组` };
  }

  plugins.unshift(pkgSpec);
  config.plugin = plugins;
  writeJSON(configPath, config);
  return { success: true, message: `✓ 已添加 "${pkgSpec}" 到 opencode.json 的 plugin 数组` };
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

/** Agent 配置已迁移到插件运行时管理，不再写入 opencode.json
 *  参照 oh-my-opencode-slim 架构：agent 定义由 config hook 唯一管理
 *  避免 opencode.json 的空 agent 定义覆盖插件注入的 model/variant */
export function registerCoHubAgents(): { success: boolean; message: string } {
  const configPath = getOpencodeConfigPath();
  let config = readJSON(configPath);
  if (!config) { config = {}; }

  let needUpdate = false;

  // 安全清理：只删除旧版 cohub install 写入的纯模板条目
  // （仅含 description/mode/prompt/permission 等 cohub 内置字段）
  // 用户手动添加了 model/variant/tools/temperature 的条目保留不删
  const COHUB_BUILTIN_FIELDS = new Set(['description', 'mode', 'prompt', 'permission']);
  let cleaned = 0;
  let preserved = 0;
  if (config.agent && typeof config.agent === 'object') {
    const agents = config.agent as Record<string, unknown>;
    for (const key of Object.keys(agents)) {
      if (!key.startsWith('co-')) continue;
      const value = agents[key];
      if (typeof value === 'object' && value !== null) {
        const fields = Object.keys(value as Record<string, unknown>).filter(
          k => k !== 'prompt'  // prompt 内容大，不影响判断
        );
        const hasCustomFields = fields.some(f => !COHUB_BUILTIN_FIELDS.has(f));
        if (hasCustomFields) {
          preserved++;
        } else {
          delete agents[key];
          cleaned++;
        }
      } else {
        delete agents[key];
        cleaned++;
      }
    }
    if (cleaned > 0 || preserved > 0) needUpdate = true;
    if (Object.keys(agents).length === 0) {
      delete config.agent;
    }
  }

  // 写入 12 个 co-* 代理发现条目到 opencode.json（仅 mode + description）
  // OpenCode 1.17.20 仅从 opencode.json 静态发现代理
  // model/variant/prompt 由 config hook 从 oh-my-opencode-cohub.json 注入，不写入此处
  const TEMPLATE_AGENTS: Array<{ name: string; mode: string; description: string }> = [
    { name: 'co-orchestrator', mode: 'primary', description: '纯调度者——编排任务、委派执行' },
    { name: 'co-oracle', mode: 'subagent', description: '战略顾问——架构审查、复杂调试' },
    { name: 'co-planner', mode: 'subagent', description: '方案制定——综合需求+信息+规范输出任务分解' },
    { name: 'co-council', mode: 'subagent', description: '多模型共识——并行LLM综合' },
    { name: 'co-librarian', mode: 'subagent', description: '研究员——查文档、搜索、Web检索' },
    { name: 'co-explorer', mode: 'subagent', description: '代码探索者——项目结构、grep/glob搜索' },
    { name: 'co-designer', mode: 'subagent', description: '设计师——UI/UX设计实现、视觉润色' },
    { name: 'co-fixer', mode: 'subagent', description: '执行者——代码修改、构建、测试' },
    { name: 'co-observer', mode: 'subagent', description: '观察者——图片/PDF/截图视觉分析' },
    { name: 'co-rule-user', mode: 'subagent', description: '用户规范分析——用户级AGENTS.md' },
    { name: 'co-rule-project', mode: 'subagent', description: '项目规范分析——项目AGENTS.md' },
    { name: 'co-rule-app', mode: 'subagent', description: '应用规则分析——.opencode/rules/*.md' },
  ];

  config.agent = config.agent ?? {};
  const agentTarget = config.agent as Record<string, unknown>;
  for (const tpl of TEMPLATE_AGENTS) {
    const existing = agentTarget[tpl.name] as Record<string, unknown> | undefined;
    if (existing) {
      // 已有条目：确保 mode 正确，保留用户手动添加的其他字段
      existing.mode = tpl.mode;
      if (!existing.description) existing.description = tpl.description;
    } else {
      agentTarget[tpl.name] = { mode: tpl.mode, description: tpl.description };
    }
  }
  needUpdate = true;

  // 设置默认代理
  if (!config.default_agent) {
    config.default_agent = 'co-orchestrator';
    needUpdate = true;
  }

  if (needUpdate) {
    writeJSON(configPath, config);
  }

  const msgParts: string[] = [];
  if (cleaned > 0) msgParts.push(`清理 ${cleaned} 个旧模板条目`);
  if (preserved > 0) msgParts.push(`保留 ${preserved} 个含自定义字段的条目`);
  msgParts.push('Agent 定义已由插件运行时接管（参照 slim 架构）');
  return { success: true, message: `✓ ${msgParts.join('，')}` };
}

const COHUB_CONFIG_PATH = path.join(os.homedir(), '.config', 'opencode', 'oh-my-opencode-cohub.json');
const PACKAGES_CACHE = path.join(os.homedir(), '.cache', 'opencode', 'packages', PACKAGE_NAME);

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

  // 6. 清理缓存目录
  if (fs.existsSync(PACKAGES_CACHE)) {
    try {
      fs.rmSync(PACKAGES_CACHE, { recursive: true, force: true });
      messages.push('✓ 已清理缓存目录');
    } catch {
      messages.push('⚠ 清理缓存目录失败，请手动删除: ' + PACKAGES_CACHE);
    }
  }

  // 7. 清理旧 plugins 目录（迁移期兼容）
  const legacyPluginsDir = path.join(os.homedir(), '.config', 'opencode', 'plugins', PACKAGE_NAME);
  if (fs.existsSync(legacyPluginsDir)) {
    try {
      fs.rmSync(legacyPluginsDir, { recursive: true, force: true });
      messages.push('✓ 已清理旧 plugins 目录');
    } catch { /* 静默 */ }
  }

  messages.push('✅ CoHub 卸载完成。完全关闭 OpenCode 后重新打开即可。');
  return { success: true, messages };
}

/** 将 cohub 安装到 ~/.cache/opencode/packages/oh-my-opencode-cohub/（含完整 node_modules） */
export function installToCacheDir(version: string): { success: boolean; message: string } {
  try {
    const targetDir = PACKAGES_CACHE;

    // 清空旧安装
    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
    fs.mkdirSync(targetDir, { recursive: true });

    // 创建临时 package.json
    const pkgJson = { private: true };
    fs.writeFileSync(path.join(targetDir, 'package.json'), JSON.stringify(pkgJson, null, 2), 'utf-8');

    // npm install cohub
    const pkgSpec = `${PACKAGE_NAME}@${version}`;
    const cmd = `npm install "${pkgSpec}" --save --legacy-peer-deps`;
    execSync(cmd, { cwd: targetDir, stdio: 'pipe', timeout: 120000 });

    // 验证安装产物
    const entryPath = path.join(targetDir, 'node_modules', PACKAGE_NAME, 'dist', 'index.js');
    if (!fs.existsSync(entryPath)) {
      return { success: false, message: `⚠ npm install 成功但入口文件缺失: ${entryPath}` };
    }

    return { success: true, message: `✓ 已安装 ${pkgSpec} 到 ${targetDir}` };
  } catch (e) {
    return { success: false, message: `⚠ 安装失败: ${(e as Error).message}` };
  }
}

