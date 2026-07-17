/** 添加 CoHub 到 opencode.json 的 plugin 数组 */
export declare function addPluginToOpenCodeConfig(): {
    success: boolean;
    message: string;
};
/** 添加 CoHub 到 tui.json 的 plugin 数组 */
export declare function addPluginToTuiConfig(): {
    success: boolean;
    message: string;
};
/** 将所有 12 个 co-* 代理注册到 opencode.json 的 agent 字段 */
export declare function registerCoHubAgents(): {
    success: boolean;
    message: string;
};
/** 写入默认配置模板（如文件不存在） */
export declare function writeDefaultConfig(): {
    success: boolean;
    message: string;
};
/** 卸载 CoHub——精确清理，不碰其他插件数据 */
export declare function uninstallCoHub(): {
    success: boolean;
    messages: string[];
};
//# sourceMappingURL=config-io.d.ts.map