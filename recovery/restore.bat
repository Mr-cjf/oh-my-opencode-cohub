@echo off
chcp 65001 > nul

echo =============================================
echo   OpenCode 一键恢复工具 v2.0
echo   双击自动完成恢复（无需手动开 PowerShell）
echo =============================================
echo.

set "SCRIPT_DIR=%~dp0"
set "PS_SCRIPT=%SCRIPT_DIR%restore-opencode.ps1"

if not exist "%PS_SCRIPT%" (
    echo [信息] 未找到 restore-opencode.ps1，尝试从 Release 下载...
    
    set "DL_URL=https://github.com/Mr-cjf/opencode-patches/releases/download/v1.17.20-patched-recovery/restore-opencode.ps1"
    set "DL_TARGET=%PS_SCRIPT%"
    
    where gh > nul 2>&1
    if %errorlevel% equ 0 (
        echo [下载] 使用 gh CLI（首选）...
        gh release download v1.17.20-patched-recovery --repo Mr-cjf/opencode-patches --pattern "restore-opencode.ps1" --dir "%SCRIPT_DIR%" --clobber
    ) else (
        where curl.exe > nul 2>&1
        if %errorlevel% equ 0 (
            echo [下载] 使用 curl.exe ...
            curl.exe -L -o "%PS_SCRIPT%" "%DL_URL%" 2> nul
        ) else (
            echo [下载] 使用 PowerShell ...
            powershell -NoProfile -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -UseBasicParsing -Uri '%DL_URL%' -OutFile '%PS_SCRIPT%'"
        )
    )
    
    if not exist "%PS_SCRIPT%" (
        echo [错误] 无法自动下载 restore-opencode.ps1
        echo.
        echo 请手动下载:
        echo   1. 打开 https://github.com/Mr-cjf/opencode-patches/releases/tag/v1.17.20-patched-recovery
        echo   2. 下载 restore-opencode.ps1
        echo   3. 放入 %SCRIPT_DIR%
        echo   4. 重新双击本文件
        echo.
        pause
        exit /b 1
    )
    echo [完成] restore-opencode.ps1 下载成功
    echo.
)

echo [启动] 正在调用 PowerShell 恢复脚本...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%" %*

echo.
if %errorlevel% equ 0 (
    echo [完成] 恢复流程执行完毕
) else (
    echo [警告] 恢复脚本返回了非零退出码 (%errorlevel%)，请检查上方日志
)
echo.
pause