<#
.SYNOPSIS
    OpenCode 一键恢复到 1.17.20 版本（含补丁 asar + 冻结自动更新）
.DESCRIPTION
    本脚本用于从 1.18.x 降级回 1.17.20，恢复工作区和补丁功能。
    支持自动下载缺失资产、哈希校验、数据库修复联动。
    下载通道优先级：gh CLI -> Invoke-WebRequest -> curl.exe -> 手动
    用法（推荐使用 restore.bat 双击运行）：
      powershell.exe -ExecutionPolicy Bypass -File ".\restore-opencode.ps1"

    参数：
      -SkipDownload    跳过自动下载缺失资产
      -FixDatabase     恢复完成后自动修复数据库 time 字段
      -Yes             跳过所有确认提示（静默模式）
    本机：双击 restore.bat 一键完成
    异地：只下载 restore.bat 一个文件，双击即自动下载其余资产
    注意：脚本会自动关闭 OpenCode 进程，请先保存工作。
#>

param(
    [switch]$SkipDownload,
    [switch]$FixDatabase,
    [switch]$Yes
)

$ErrorActionPreference = "Continue"
$script:ExitCode = 0

# ---------- 常量 ----------
$ReleaseBase   = "https://github.com/Mr-cjf/opencode-patches/releases/download/v1.17.20-patched-recovery/"
$ExeFileName   = "opencode-desktop-win-x64-1.17.20.exe"
$ZipFileName   = "app.asar.patched.zip"
$ExpectedExeSize = 134784328
$ExpectedZipSize = 39761484
$ExpectedExeHash = "7cc70f63d21656714333123648db0fb9cf9bf0a71a095b53fc67d204d61d3cdf"
$ExpectedZipHash = "6047d9c70db423345a06c30f350ca009e6c844b8d6c19b111e109277ddc84d32"

# ---------- 辅助函数 ----------
function Write-Step {
    param([string]$Prefix, [string]$Message)
    Write-Host "[${Prefix}] ${Message}"
}

# ---------- 下载失败时的手动指引 ----------
function Show-ManualDownloadGuide {
    Write-Host ""
    Write-Host "============================================" -ForegroundColor Red
    Write-Host "  自动下载失败" -ForegroundColor Red
    Write-Host "============================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "请手动下载以下文件并放入本目录：" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Release 页面:" -ForegroundColor Cyan
    Write-Host "  https://github.com/Mr-cjf/opencode-patches/releases/tag/v1.17.20-patched-recovery"
    Write-Host ""
    Write-Host "  需要下载的文件:" -ForegroundColor Cyan
    Write-Host "  1. ${ExeFileName}"
    Write-Host "  2. ${ZipFileName}(或解压后的 app.asar.patched)"
    Write-Host ""
    Write-Host "  下载后放到以下目录" -ForegroundColor Cyan
    Write-Host "  $PSScriptRoot"
    Write-Host ""
    Write-Host "  然后重新运行本脚本，或加 -SkipDownload 参数跳过下载检查"
    Write-Host ""
}

# ---------- 下载单个文件（多级回退：gh -> IWR -> curl -> 手动）---------
function Download-File {
    param(
        [string]$Url,
        [string]$Destination,
        [string]$Description,
        [long]$ExpectedSize,
        [string]$Repo = "Mr-cjf/opencode-patches",
        [string]$ReleaseTag = "v1.17.20-patched-recovery",
        [string]$FileName
    )

    Write-Host "  下载地址: ${Url}" -ForegroundColor Gray
    Write-Host "  保存位置: ${Destination}" -ForegroundColor Gray

    $success = $false

    # ----- 方法1: gh CLI（首选：绕过 DNS/直连阻断）----
    if (Get-Command gh -ErrorAction SilentlyContinue) {
        try {
            Write-Host "  尝试方法1[gh release download] ..." -ForegroundColor Gray
            if (-not $env:GH_TOKEN -and $env:GITHUB_PERSONAL_ACCESS_TOKEN) { $env:GH_TOKEN = $env:GITHUB_PERSONAL_ACCESS_TOKEN }
            & gh release download $ReleaseTag --repo $Repo --pattern $FileName --dir (Split-Path $Destination -Parent) --clobber 2>&1 | Out-Null
            if ($LASTEXITCODE -eq 0 -and (Test-Path $Destination)) {
                $success = $true
                Write-Step "下载" "方法1成功: ${Description}（gh CLI）"
            } else {
                Write-Host "  方法1失败 (gh exit code: ${LASTEXITCODE})" -ForegroundColor DarkYellow
            }
        } catch {
            Write-Host "  方法1[gh] 失败: $_" -ForegroundColor DarkYellow
        }
    } else {
        Write-Host "  方法1[gh CLI] 不可用（未安装 gh），跳过。" -ForegroundColor DarkYellow
    }

    # ----- 方法2: Invoke-WebRequest -----
    if (-not $success) {
        try {
            $oldProgress = $ProgressPreference
            $ProgressPreference = 'SilentlyContinue'
            Write-Host "  尝试方法2[PowerShell Invoke-WebRequest] ..." -ForegroundColor Gray
            Invoke-WebRequest -Uri $Url -OutFile $Destination -UseBasicParsing -ErrorAction Stop
            $ProgressPreference = $oldProgress
            $success = $true
            Write-Step "下载" "方法2成功: ${Description}"
        } catch {
            $ProgressPreference = $oldProgress
            Write-Host "  方法2[IWR] 失败: $_" -ForegroundColor DarkYellow
        }
    }

    # ----- 方法3: curl.exe -----
    if (-not $success) {
        try {
            Write-Host "  尝试方法3[curl.exe] ..." -ForegroundColor Gray
            $null = & curl.exe -L -o "$Destination" "$Url" 2>&1
            if ($LASTEXITCODE -eq 0 -and (Test-Path $Destination)) {
                $success = $true
                Write-Step "下载" "方法3成功: ${Description}"
            } else {
                Write-Host "  方法3[curl] 失败 (exit code: ${LASTEXITCODE})" -ForegroundColor DarkYellow
            }
        } catch {
            Write-Host "  方法3[curl] 失败: $_" -ForegroundColor DarkYellow
        }
    }

    if (-not $success) {
        Show-ManualDownloadGuide
        return $false
    }

    # ----- 校验大小 -----
    if (Test-Path $Destination) {
        $actualSize = (Get-Item $Destination).Length
        if ($ExpectedSize -gt 0 -and $actualSize -ne $ExpectedSize) {
            Write-Host "[警告] 文件大小不匹配：期望 ${ExpectedSize} 字节，实际 ${actualSize} 字节" -ForegroundColor Red
            Write-Host "  下载可能不完整，将中断操作。" -ForegroundColor Red
            return $false
        } else {
            Write-Step "下载" "大小验证通过 ($actualSize 字节)"
        }
    }

    return $true
}
# ---------- 自动下载缺失资产 ----------
function Invoke-AutoDownload {
    if ($SkipDownload) {
        Write-Step "下载" "已跳过下载（-SkipDownload 参数）"
        return
    }

    Write-Step "下载" "检查缺失资产文件..."

    $exePath     = "$PSScriptRoot\$ExeFileName"
    $patchedPath = "$PSScriptRoot\app.asar.patched"
    $zipPath     = "$PSScriptRoot\$ZipFileName"

    $needExe = -not (Test-Path $exePath)
    $needZip = (-not (Test-Path $patchedPath)) -and (-not (Test-Path $zipPath))

    if ($needExe)   { Write-Host "  缺失: ${ExeFileName}" -ForegroundColor Yellow }  else { Write-Host "  存在: ${ExeFileName}" -ForegroundColor Green }
    if ($needZip)   { Write-Host "  缺失: ${ZipFileName}(或 app.asar.patched)" -ForegroundColor Yellow }
    elseif (-not (Test-Path $patchedPath)) { Write-Host "  存在: ${ZipFileName}" -ForegroundColor Green }
    else                                   { Write-Host "  存在: app.asar.patched" -ForegroundColor Green }

    if (-not $needExe -and -not $needZip) {
        Write-Step "下载" "所有资产文件已存在。"
        return
    }

    if (-not $Yes) {
        Write-Host ""
        Write-Host "[确认] 将自动下载缺失文件，是否继续？(y/N): " -NoNewline
        $answer = Read-Host
        if ($answer -notin @('y', 'Y', 'yes', 'YES')) {
            Write-Host "[取消] 用户取消了下载。"
            Show-ManualDownloadGuide
            exit 1
        }
    }

    Write-Step "下载" "开始下载..."
    $oldPp = $ProgressPreference
    $ProgressPreference = 'SilentlyContinue'

    if ($needExe) {
        Write-Step "下载" "正在下载 ${ExeFileName}..."
        if (-not (Download-File -Url "${ReleaseBase}${ExeFileName}" -Destination $exePath -Description $ExeFileName -ExpectedSize $ExpectedExeSize -FileName $ExeFileName)) { exit 1 }
    }

    if ($needZip) {
        Write-Step "下载" "正在下载 ${ZipFileName}..."
        if (-not (Download-File -Url "${ReleaseBase}${ZipFileName}" -Destination $zipPath -Description $ZipFileName -ExpectedSize $ExpectedZipSize -FileName $ZipFileName)) { exit 1 }
    }

    $ProgressPreference = $oldPp
    Write-Step "下载" "全部下载完成。"
}

# ---------- 哈希校验 ----------
function Invoke-HashCheck {
    Write-Step "校验" "正在校验文件哈希值..."

    # 读取 checksums.txt（如果存在），用于交叉验证
    $checksums = @{}
    $checksumFile = "$PSScriptRoot\checksums.txt"
    if (Test-Path $checksumFile) {
        Write-Step "校验" "发现 checksums.txt，将做交叉验证..."
        Get-Content $checksumFile | ForEach-Object {
            if ($_ -match '^([a-fA-F0-9]{64})\s+\*(.+)$') {
                $checksums[$matches[2]] = $matches[1].ToLower()
            }
        }
    }

    $allValid = $true

    # 校验 exe
    $exePath = "$PSScriptRoot\$ExeFileName"
    if (Test-Path $exePath) {
        $hash = (Get-FileHash $exePath -Algorithm SHA256).Hash.ToLower()
        $expected = $ExpectedExeHash
        Write-Step "校验" "检查 ${ExeFileName}..."

        # 硬编码期望值校验
        if ($hash -eq $expected) {
            Write-Host "  哈希匹配: ${hash}" -ForegroundColor Green
        } else {
            Write-Host "  哈希不匹配" -ForegroundColor Red
            Write-Host "  期望(硬编码): ${expected}" -ForegroundColor Red
            Write-Host "  实际: ${hash}" -ForegroundColor Red
            $allValid = $false
        }

        # 交叉验证（checksums.txt 存在时）
        $chkExpected = $checksums[$ExeFileName]
        if ($chkExpected -and $hash -ne $chkExpected) {
            Write-Host "  [交叉验证失败] checksums.txt 中哈希不一致!" -ForegroundColor Red
            Write-Host "  硬编码: ${expected}" -ForegroundColor Red
            Write-Host "  checksums.txt: ${chkExpected}" -ForegroundColor Red
            $allValid = $false
        }
    }

    # 校验 zip
    $zipPath = "$PSScriptRoot\$ZipFileName"
    if (Test-Path $zipPath) {
        $hash = (Get-FileHash $zipPath -Algorithm SHA256).Hash.ToLower()
        $expected = $ExpectedZipHash
        Write-Step "校验" "检查 ${ZipFileName}..."

        # 硬编码期望值校验
        if ($hash -eq $expected) {
            Write-Host "  哈希匹配: ${hash}" -ForegroundColor Green
        } else {
            Write-Host "  哈希不匹配" -ForegroundColor Red
            Write-Host "  期望(硬编码): ${expected}" -ForegroundColor Red
            Write-Host "  实际: ${hash}" -ForegroundColor Red
            $allValid = $false
        }

        # 交叉验证（checksums.txt 存在时）
        $chkExpected = $checksums[$ZipFileName]
        if ($chkExpected -and $hash -ne $chkExpected) {
            Write-Host "  [交叉验证失败] checksums.txt 中哈希不一致!" -ForegroundColor Red
            Write-Host "  硬编码: ${expected}" -ForegroundColor Red
            Write-Host "  checksums.txt: ${chkExpected}" -ForegroundColor Red
            $allValid = $false
        }
    }

    if (-not $allValid) {
        Write-Host ""
        Write-Host "[错误] 文件哈希校验失败！请从 Release 重新下载文件。" -ForegroundColor Red
        Write-Host "  Release: https://github.com/Mr-cjf/opencode-patches/releases/tag/v1.17.20-patched-recovery" -ForegroundColor Cyan
        exit 1
    }

    Write-Step "校验" "所有文件哈希校验通过。"
    return $true
}

# ---------- 数据库修复联动 ----------
function Invoke-DatabaseFix {
    Write-Step "数据库" "准备修复数据库 time 字段..."

    # 检测 python
    $pythonCmd = $null
    try { $null = & python --version 2>&1; if ($LASTEXITCODE -eq 0) { $pythonCmd = "python" } } catch {}
    if (-not $pythonCmd) {
        try { $null = & python3 --version 2>&1; if ($LASTEXITCODE -eq 0) { $pythonCmd = "python3" } } catch {}
    }

    if (-not $pythonCmd) {
        Write-Host "[错误] 未找到 Python。请手动运行: python fix-db-time-fields.py" -ForegroundColor Red
        return
    }

    $fixScript = "$PSScriptRoot\fix-db-time-fields.py"
    if (-not (Test-Path $fixScript)) {
        Write-Host "[错误] 未找到修复脚本 ${fixScript}" -ForegroundColor Red
        return
    }

    Write-Step "数据库" "找到 Python，执行 dry-run 预览..."

    # 先 dry-run 预览
    & $pythonCmd "$fixScript" --dry-run
    $dryRunExit = $LASTEXITCODE
    if ($dryRunExit -ne 0) {
        Write-Host "[警告] dry-run 失败（exit code: ${dryRunExit}），跳过数据库修复。" -ForegroundColor Yellow
        return
    }

    # 询问确认
    if (-not $Yes) {
        Write-Host ""
        Write-Host "[确认] 以上为预览结果。是否继续执行修复？(y/N): " -NoNewline
        $answer = Read-Host
        if ($answer -notin @('y', 'Y', 'yes', 'YES')) {
            Write-Host "[取消] 用户取消了数据库修复。" -ForegroundColor Yellow
            return
        }
    } else {
        Write-Step "数据库" "-Yes 已指定，跳过确认。"
    }

    # 执行修复
    Write-Step "数据库" "执行修复..."
    if ($Yes) {
        & $pythonCmd "$fixScript" --yes
    } else {
        & $pythonCmd "$fixScript"
    }
    if ($LASTEXITCODE -eq 0) {
        Write-Step "数据库" "数据库修复完成。"
    } else {
        Write-Host "[警告] 数据库修复异常（exit code: ${LASTEXITCODE}）" -ForegroundColor Yellow
    }
}

# ============================================================
#  主流程
# ============================================================

Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "   OpenCode 一键恢复工具 v2.0" -ForegroundColor Cyan
Write-Host "   目标版本: 1.17.20（含补丁）" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

# ---- 第 1 步：自动下载缺失资产 ----
Invoke-AutoDownload

# ---- 第 1 步后：哈希校验 ----
Invoke-HashCheck

# ---------- 步骤 1：关闭 OpenCode ----------
Write-Step "1/6" "正在关闭 OpenCode 进程..."

$procs = Get-Process -Name "*opencode*" -ErrorAction SilentlyContinue
if ($procs) {
    $procs | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 3
    $remaining = Get-Process -Name "*opencode*" -ErrorAction SilentlyContinue
    if ($remaining) {
        Write-Host "[错误] OpenCode 进程未能完全关闭，请手动结束后重试。" -ForegroundColor Red
        exit 1
    }
    Write-Step "1/6" "OpenCode 已关闭。"
} else {
    Write-Step "1/6" "未检测到运行中的 OpenCode 进程。"
}

# ---------- 步骤 2：卸载当前版本 ----------
Write-Step "2/6" "卸载当前 OpenCode 版本..."

$uninstaller = "$env:LOCALAPPDATA\Programs\@opencode-aidesktop\Uninstall OpenCode.exe"
if (Test-Path $uninstaller) {
    Write-Step "2/6" "找到卸载程序，正在执行静默卸载..."
    Start-Process -Wait -FilePath $uninstaller -ArgumentList "/S" -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 5
    Write-Step "2/6" "卸载完成。"
} else {
    Write-Step "2/6" "未找到卸载程序（可能已卸载或未安装），继续下一步。"
}

# ---------- 步骤 3：安装 1.17.20 ----------
Write-Step "3/6" "安装 OpenCode 1.17.20..."

$installer = "$PSScriptRoot\opencode-desktop-win-x64-1.17.20.exe"
if (-not (Test-Path $installer)) {
    Write-Host "[错误] 安装包不存在: ${installer}" -ForegroundColor Red
    exit 1
}

Write-Step "3/6" "正在运行安装程序（静默模式）..."
Start-Process -Wait -FilePath $installer -ArgumentList "/S" -ErrorAction SilentlyContinue
Start-Sleep -Seconds 5
Write-Step "3/6" "安装完成。"

# ---------- 步骤 4：应用补丁 asar ----------
Write-Step "4/6" "应用补丁 app.asar..."

$resourcesDir = "$env:LOCALAPPDATA\Programs\@opencode-aidesktop\resources"
$targetAsar = "$resourcesDir\app.asar"

$patchedFile = "$PSScriptRoot\app.asar.patched"
$zipFile = "$PSScriptRoot\app.asar.patched.zip"

if (-not (Test-Path $resourcesDir)) {
    Write-Host "[错误] 未找到 OpenCode 资源目录: ${resourcesDir}" -ForegroundColor Red
    exit 1
}

if ((-not (Test-Path $patchedFile)) -and (Test-Path $zipFile)) {
    Write-Step "4/6" "解压 app.asar.patched.zip..."
    Expand-Archive -Path $zipFile -DestinationPath "$PSScriptRoot" -Force -ErrorAction SilentlyContinue
    $patchedFile = "$PSScriptRoot\app.asar.patched"
}

if (-not (Test-Path $patchedFile)) {
    Write-Host "[错误] 未找到补丁文件 app.asar.patched 或 app.asar.patched.zip" -ForegroundColor Red
    exit 1
}

if (Test-Path $targetAsar) {
    $backupAsar = "$targetAsar.pre-restore.bak"
    Copy-Item -Path $targetAsar -Destination $backupAsar -Force -ErrorAction SilentlyContinue
    Write-Step "4/6" "已备份原 app.asar -> app.asar.pre-restore.bak"
}

Copy-Item -Path $patchedFile -Destination $targetAsar -Force -ErrorAction SilentlyContinue
Write-Step "4/6" "补丁已应用。"

# ---------- 步骤 5：冻结自动升级 ----------
Write-Step "5/6" "冻结自动升级..."

# 5a. 修改 app-update.yml
$updateYmlPath = "$resourcesDir\app-update.yml"
if (Test-Path $updateYmlPath) {
    $content = Get-Content $updateYmlPath -Raw -ErrorAction SilentlyContinue
    if ($content -match 'repo:\s*opencode') {
        Copy-Item -Path $updateYmlPath -Destination "$updateYmlPath.bak" -Force -ErrorAction SilentlyContinue
        $content = $content -replace 'repo:\s*opencode', 'repo: block-opencode-update'
        Set-Content -Path $updateYmlPath -Value $content -Force -ErrorAction SilentlyContinue
        Write-Step "5/6" "已修改 app-update.yml（原文件备份为 .bak）"
    } else {
        Write-Step "5/6" "app-update.yml 无需修改。"
    }
} else {
    Write-Step "5/6" "app-update.yml 不存在，跳过。"
}

# 5b. 清空 pending 目录
$pendingDir = "$env:LOCALAPPDATA\@opencode-aidesktop-updater\pending"
if (Test-Path $pendingDir) {
    Remove-Item "$pendingDir\*" -Recurse -Force -ErrorAction SilentlyContinue
    Write-Step "5/6" "已清空待更新目录: ${pendingDir}"
} else {
    Write-Step "5/6" "待更新目录不存在，跳过。"
}

# 5c. 删除 updater 目录
$updaterDir = "$env:APPDATA\ai.opencode.desktop\opencode.updater"
if (Test-Path $updaterDir) {
    Remove-Item $updaterDir -Recurse -Force -ErrorAction SilentlyContinue
    Write-Step "5/6" "已删除 updater: ${updaterDir}"
} else {
    Write-Step "5/6" "updater 目录不存在，跳过。"
}

# ---------- 步骤 6：收尾验证 ----------
Write-Step "6/6" "收尾验证..."

$exePath = "$env:LOCALAPPDATA\Programs\@opencode-aidesktop\OpenCode.exe"
if (Test-Path $exePath) {
    try {
        $version = (Get-Item $exePath).VersionInfo.FileVersion
        Write-Step "6/6" "OpenCode 版本: $version"
        if ($version -match '1\.17\.20') {
            Write-Host "[完成] 恢复成功！当前版本为 ${version}" -ForegroundColor Green
        } else {
            Write-Host "[警告] 版本不匹配：期望 1.17.20，实际 ${version}），请检查安装步骤。" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "[警告] 无法读取版本信息。" -ForegroundColor Yellow
    }
} else {
    Write-Host "[警告] 未找到 OpenCode.exe，安装可能未成功。" -ForegroundColor Yellow
}

# ---------- 数据库修复（-FixDatabase 时） ----------
if ($FixDatabase) {
    Write-Host ""
    Write-Step "DB" "检测到 -FixDatabase 参数，进入数据库修复流程..."
    Invoke-DatabaseFix
}

Write-Host ""
Write-Host "===== 下一步 =====" -ForegroundColor Cyan
Write-Host "启动 OpenCode 验证："
Write-Host "  1. 工作区可用"
Write-Host "  2. 多 diffs 会话不卡顿"
Write-Host "  3. 更新检查返回 404（被阻断）"
Write-Host "  4. 如遇到 reading time 崩溃，运行 fix-db-time-fields.py 修复数据库"
Write-Host ""

if ($script:ExitCode -ne 0) {
    exit $script:ExitCode
}