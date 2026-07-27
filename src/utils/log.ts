/**
 * oh-my-opencode-cohub 诊断日志工具（按天轮转）
 *
 * 日志路径：~/.local/share/opencode/log/oh-my-opencode-cohub.YYYYMMDD.log
 * 保留天数：7 天（每次切换日期时自动清理过期文件）
 * 格式：[ISO时间] [oh-my-opencode-cohub] [tag] message
 *
 * 内部 try-catch 自保护——日志写入失败不影响主业务。
 */

import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

const LOG_DIR = path.join(os.homedir(), ".local", "share", "opencode", "log");
const LOG_PREFIX = "oh-my-opencode-cohub";
const KEEP_DAYS = 7;

// 运行时缓存当天日期，避免每次写入都做日期格式化
let _today = "";
let _logPath = "";
let _cleanedToday = false;

/** 获取当天日志文件路径 */
function getLogPath(): string {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  if (today !== _today) {
    _today = today;
    _logPath = path.join(LOG_DIR, `${LOG_PREFIX}.${today}.log`);
    _cleanedToday = false;
  }
  return _logPath;
}

/** 清理 KEEP_DAYS 天前的旧日志文件（每天仅执行一次） */
async function cleanOldLogsOnce(): Promise<void> {
  if (_cleanedToday) return;
  _cleanedToday = true;

  try {
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - KEEP_DAYS);
    const cutoffStr = cutoff.toISOString().slice(0, 10).replace(/-/g, "");

    const files = await fs.readdir(LOG_DIR);
    for (const file of files) {
      if (!file.startsWith(LOG_PREFIX + ".")) continue;
      // 提取文件名中的日期部分，如 oh-my-opencode-cohub.20260725.log → 20260725
      const escapedPrefix = LOG_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = file.match(new RegExp(`^${escapedPrefix}\\.(\\d{8})\\.log$`));
      if (!match) continue;
      if (match[1] < cutoffStr) {
        await fs.unlink(path.join(LOG_DIR, file)).catch(() => {});
      }
    }
  } catch {
    // 清理失败静默忽略（如目录不存在）
  }
}

/**
 * 追加一条诊断日志
 *
 * @param tag     标签（如 hook 名称、函数名）
 * @param message 描述信息
 * @param err     可选，错误对象，存在时会自动追加 err.stack
 */
export async function appendLog(
  tag: string,
  message: string,
  err?: unknown
): Promise<void> {
  try {
    const logPath = getLogPath();
    await fs.mkdir(LOG_DIR, { recursive: true });
    const now = new Date().toISOString();
    let line = `[${now}] [oh-my-opencode-cohub] [${tag}] ${message}`;
    if (err instanceof Error) {
      line += `\n  stack: ${err.stack ?? err.message}`;
    } else if (err !== undefined) {
      line += `\n  detail: ${String(err)}`;
    }
    line += "\n";

    await fs.appendFile(logPath, line, "utf-8");

    // 每天首次写入后触发清理
    await cleanOldLogsOnce();
  } catch {
    // 日志写入自身失败，静默忽略，不干扰主业务
  }
}
