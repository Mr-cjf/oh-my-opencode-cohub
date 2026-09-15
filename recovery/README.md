# OpenCode 恢复指南（Recovery Kit）

## 这个目录是什么

本目录包含从 OpenCode 1.18.x（或更新版本）降级回 1.17.20 并恢复补丁所需的脚本和工具。这是"oh-my-opencode-cohub"项目的一部分。

### 文件清单

| 文件 | 说明 |
|------|------|
| `restore-opencode.ps1` | 一键恢复 PowerShell 脚本（推荐） |
| `fix-db-time-fields.py` | 数据库 time 字段修复工具 |
| `README.md` | 本指南 |
| `opencode-desktop-win-x64-1.17.20.exe` | 1.17.20 安装包（需自行放入） |
| `app.asar.patched` 或 `app.asar.patched.zip` | 补丁 asar 文件（需自行放入） |

> 如果 `app.asar.patched` 不存在但 `app.asar.patched.zip` 存在，脚本会自动解压。

### 文件校验

安装包和补丁文件的哈希值如下（验证用）：

```powershell
# PowerShell
Get-FileHash .\opencode-desktop-win-x64-1.17.20.exe
Get-FileHash .\app.asar.patched

# CMD
certutil -hashfile opencode-desktop-win-x64-1.17.20.exe SHA256
certutil -hashfile app.asar.patched SHA256
```

---

---

## 快速恢复（推荐，双击一键）

### 最简单: 双击 restore.bat

**本机恢复**:
1. 打开 `recovery\` 目录
2. 双击 `restore.bat`
3. 等待自动完成（脚本会关闭OpenCode、卸载旧版本、安装1.17.20、打补丁、冻结更新）

**异地恢复（文件丢失）**:
1. 只从 Release 下载 `restore.bat` 一个文件:
   `https://github.com/Mr-cjf/opencode-patches/releases/tag/v1.17.20-patched-recovery`
2. 双击 `restore.bat`
3. 脚本自动下载 `opencode-desktop-win-x64-1.17.20.exe` 和 `app.asar.patched.zip`
4. 自动完成全部恢复步骤

脚本会自动:
- 检查缺失资产文件并自动下载（多级回退：gh CLI -> IWR -> curl -> 手动）
- 验证下载文件大小
- 校验 SHA256 哈希（同目录有 `checksums.txt` 时）
- 失败时打印手动下载指引

> 异地用户仅需一个文件即可完成全部恢复。下载失败时脚本会显示完整的 Release 页面链接和文件清单。

### 下载通道说明

下载采用四通道优先级机制，任一通道成功即跳过后续尝试：

| 优先级 | 通道 | 使用条件 | 实测速度 |
|--------|------|----------|----------|
| 1 (首选) | `gh release download` | 需安装 [GitHub CLI](https://cli.github.com/) | ~11 MB/s |
| 2 | `Invoke-WebRequest` (PowerShell) | 系统内置 | 视网络环境 |
| 3 | `curl.exe -L` | Windows 10/11 1803+ 内置 | 视网络环境 |
| 4 (最后) | 手动下载指引 | 所有自动通道均失败时 | - |

> **注意**: 在本机实测环境中，`IWR` 和 `curl.exe` 均因 DNS/路由级阻断无法下载 Release 资产（302 跳转到 `release-assets.githubusercontent.com` 被阻断），仅 `gh release download` 成功。如果你遇到类似问题，安装 gh CLI 即可解决。

### 高级参数

脚本 `restore-opencode.ps1` 支持以下参数（也可通过 `restore.bat` 传递）:

```powershell
powershell -ExecutionPolicy Bypass -File ".\restore-opencode.ps1" -SkipDownload -FixDatabase -Yes
```

| 参数 | 说明 |
|------|------|
| `-SkipDownload` | 跳过自动下载,使用本地已有文件 |
| `-FixDatabase` | 恢复完成后自动修复数据库 time 字段 |
| `-Yes` | 静默模式,跳过所有确认提示 |

示例: 完全自动化的恢复+数据库修复
```powershell
.\restore-opencode.ps1 -FixDatabase -Yes
```

---

## 什么情况下需要使用

你**需要本恢复工具**的条件：

- OpenCode 被自动更新到 1.18.x 或更新版本
- 更新后工作区无法使用
- 更新后补丁失效
- 打开会话时出现 `Cannot read properties of undefined (reading 'time')` 崩溃

---

## 一键恢复（PowerShell 传统方式）

如果无法双击 `restore.bat`，也可以以**管理员身份**打开 PowerShell 手动执行：

```powershell
cd C:\Users\你的用户名\Desktop\oh-my-opencode-cohub\recovery\
powershell.exe -ExecutionPolicy Bypass -File .\restore-opencode.ps1
```

脚本会依次执行 6 个步骤（加上自动下载和校验），每一步都有中文日志输出。

---

## 手动恢复分步

如果自动脚本运行失败，可按以下步骤手动操作：

### 1. 关闭 OpenCode

```powershell
Get-Process *opencode* | Stop-Process -Force
```

确认进程已终止后再继续。

### 2. 卸载当前版本，安装 1.17.20

卸载（静默）：
```powershell
& "$env:LOCALAPPDATA\Programs\@opencode-aidesktop\Uninstall OpenCode.exe" /S
```

安装：
```powershell
& ".\opencode-desktop-win-x64-1.17.20.exe" /S
```

安装路径默认：`%LOCALAPPDATA%\Programs\@opencode-aidesktop\`

### 3. 解压并覆盖 app.asar

```powershell
# 备份原文件
Copy-Item "$env:LOCALAPPDATA\Programs\@opencode-aidesktop\resources\app.asar" `
         "$env:LOCALAPPDATA\Programs\@opencode-aidesktop\resources\app.asar.pre-restore.bak"

# 覆盖补丁文件
Copy-Item .\app.asar.patched `
         "$env:LOCALAPPDATA\Programs\@opencode-aidesktop\resources\app.asar" -Force
```

如果补丁文件是 zip 格式，先解压：
```powershell
Expand-Archive .\app.asar.patched.zip -DestinationPath .\ -Force
```

### 4. 修改 app-update.yml 阻断自动更新

```powershell
$yml = "$env:LOCALAPPDATA\Programs\@opencode-aidesktop\resources\app-update.yml"
Copy-Item $yml "$yml.bak" -Force
(Get-Content $yml -Raw) -replace 'repo: opencode', 'repo: block-opencode-update' | Set-Content $yml
```

### 5. 清理 pending 更新

```powershell
# 清空待更新目录
Remove-Item "$env:LOCALAPPDATA\@opencode-aidesktop-updater\pending\*" -Recurse -Force -ErrorAction SilentlyContinue

# 删除 updater
Remove-Item "$env:APPDATA\ai.opencode.desktop\opencode.updater" -Recurse -Force -ErrorAction SilentlyContinue
```

### 6. 启动并验证

启动 OpenCode，检查：
- 左下角版本号显示 1.17.20
- 工作区正常加载
- 大 diffs 会话不卡顿
- 设置中自动更新状态正常（检查更新显示 404）

---

## 恢复后验证清单

| 检查项 | 预期结果 | 验证命令 |
|--------|---------|---------|
| 版本号 | 1.17.20 | `(Get-Item "$env:LOCALAPPDATA\Programs\@opencode-aidesktop\OpenCode.exe").VersionInfo.FileVersion` |
| 工作区 | 可用 | 手动打开工作区 |
| 大 diffs | 不卡顿 | 打开历史会话测试 |
| 更新检查 | 404 | 在应用内检查更新，应连接失败 |

---

## 故障排查

### 打开会话时崩溃："reading 'time'"

这是 1.18.x 升级后数据库写入的记录缺少 `$.time` 字段导致。

**解决方法**：运行数据库修复脚本

```bash
# 先关闭 OpenCode
python fix-db-time-fields.py

# 如想预览受影响的记录数（不修改）：
python fix-db-time-fields.py --dry-run

# 指定数据库路径 + 跳过确认：
python fix-db-time-fields.py --db "C:\Users\你的用户名\.local\share\opencode\opencode.db" --yes
```

脚本会：
1. 统计各类型中缺少 `$.time` 的记录数
2. 导出受影响行到 `time-fields-backup-<时间戳>.jsonl`
3. 分批补全 time 字段（step-start 补 start，其余补 start+end）
4. 完成后重新统计

> 脚本是**幂等**的——只补 `json_extract(data,'$.time') IS NULL` 的记录，不会覆盖已有字段。

### 安装后打不开应用

1. 确认安装包路径正确
2. 重跑安装程序（选择修复模式）
3. 检查是否被杀毒软件拦截
4. 查看 `%APPDATA%\ai.opencode.desktop\logs\` 下的日志

### 又被自动更新了

1. 检查 `app-update.yml` 中的 `repo` 是否为 `block-opencode-update`
2. 确认 pending 目录已清空
3. 如果持续更新，建议断网后再启动 OpenCode
4. 可在防火墙中屏蔽 OpenCode 的出站连接

---

## 免责说明

- 本恢复工具仅供学习和恢复用途
- 降级操作涉及替换应用文件，可能带来安全风险
- 建议在操作前备份重要数据
- 使用 `fix-db-time-fields.py` 修改数据库前会导出受影响行，但仍建议自行做全库备份
- 作者不对使用本工具导致的任何问题承担责任

---

*Recovery Kit v1.0 | 2025*