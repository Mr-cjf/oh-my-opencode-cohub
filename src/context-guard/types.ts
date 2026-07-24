/** 上下文卫士 - 类型定义 */

/** 三选一选项 */
export type GuardOption = 'auto-compress' | 'session-compact' | 'migrate';

/** co-guardian 分析推荐结果 */
export interface GuardianRecommendation {
  /** 推荐选项 */
  option: GuardOption;
  /** 置信度 0-1 */
  confidence: number;
  /** 推荐理由 */
  reasoning: string;
  /** 备选方案简要说明 */
  alternatives?: string;
}

/** 会话压缩状态 */
export interface GuardSessionState {
  /** 会话 ID */
  sessionId: string;
  /** 是否已触发过三选一 */
  triggered: boolean;
  /** 累计 token 数 */
  cumulativeTokens: number;
  /** 最后访问时间（时间戳，用于 TTL 清理） */
  lastAccessTime: number;
  /** 触发时的 token 用量 */
  triggerTokens?: number;
  /** 触发时的上下文窗口大小 */
  triggerContextLimit?: number;
  /** 最近一次压缩后的消息 ID（冷却期锚点） */
  cooldownAfterMessageId?: string;
  /** 冷却剩余轮次 */
  cooldownRemaining: number;
  /** 用户选择的选项（选择后设置） */
  selectedOption?: GuardOption;
  /** 触发的消息 ID（防止重复） */
  lastTriggerMessageId?: string;
}

/** 上下文使用统计 */
export interface ContextUsage {
  /** 已使用的 token */
  usedTokens: number;
  /** 上下文窗口总大小 */
  contextLimit: number;
  /** 使用比例 */
  ratio: number;
  /** 输入 token */
  inputTokens?: number;
  /** 输出 token */
  outputTokens?: number;
  /** 推理 token */
  reasoningTokens?: number;
}

/** 插件配置 */
export interface ContextGuardConfig {
  /** 是否启用 */
  enabled: boolean;
  /** 触发阈值（上下文窗口比例，默认 0.2 = 20%） */
  triggerRatio: number;
  /** 绝对 token 阈值（兜底，默认 40000） */
  tokenThreshold: number;
  /** 冷却轮次（压缩后 N 轮不再触发，默认 3） */
  cooldownTurns: number;
  /** 自动压缩保留最近 N 条消息 */
  preserveLastN: number;
  /** 调试模式 */
  debug: boolean;
}

/** 默认配置 */
export const DEFAULT_GUARD_CONFIG: ContextGuardConfig = {
  enabled: true,
  triggerRatio: 0.2,
  tokenThreshold: 40_000,
  cooldownTurns: 3,
  preserveLastN: 5,
  debug: false,
};

/** 迁移文案：分析提取的会话信息 */
export interface MigrationContext {
  /** 当前任务摘要 */
  currentTask: string;
  /** 关键文件列表 */
  keyFiles: string[];
  /** 进行中的操作 */
  activeOperations: string[];
  /** 错误/问题 */
  errors: string[];
  /** 决策记录 */
  decisions: string[];
  /** 生成的迁移文案（Markdown） */
  migrationText: string;
}
