@echo off
setlocal
chcp 65001 >nul
title Golem v7.1 Setup Wizard

echo ========================================================
echo      🦞 Golem v7.1 (Tri-Brain Ultimate) 安裝精靈
echo ========================================================
echo.

:: 1. 檢查 Node.js 環境
echo 🔍 [1/5] 正在檢查 Node.js 環境...
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [錯誤] 未偵測到 Node.js！
    echo 請前往 https://nodejs.org/ 下載並安裝 LTS 版本。
    pause
    exit /b
)
echo    ✅ Node.js 已安裝。

:: 2. 清理舊環境 (確保移除 Ollama)
echo.
echo 🧹 [2/5] 清理舊依賴與緩存...
if exist node_modules (
    echo    - 正在刪除舊的 node_modules...
    rmdir /s /q node_modules
)
if exist package-lock.json (
    echo    - 正在刪除舊的 package-lock.json...
    del package-lock.json
)
echo    ✅ 環境清理完成。

:: 3. 安裝新依賴
echo.
echo 📦 [3/5] 正在下載 Golem v7.1 核心組件...
echo    (這可能需要幾分鐘，請稍候...)
call npm install
if %errorlevel% neq 0 (
    echo.
    echo [錯誤] npm install 失敗！請檢查網路連線。
    pause
    exit /b
)
echo    ✅ 依賴安裝完成。

:: 4. 初始化記憶體與設定檔
echo.
echo 🧠 [4/5] 初始化神經網路記憶體...

:: 建立記憶體目錄
if not exist golem_memory (
    mkdir golem_memory
    echo    - 建立 golem_memory 資料夾
)

:: 建立/檢查 .env
if not exist .env (
    echo    - 未偵測到 .env，正在建立預設設定檔...
    (
        echo # ==========================================
        echo # 🤖 Golem v7.1 環境配置檔
        echo # ==========================================
        echo.
        echo # 1. Google Gemini API Keys ^(維修技師與自癒機制用^)
        echo # 支援多組 Key 輪動，請用逗號分隔
        echo GEMINI_API_KEYS=填入你的Key1,填入你的Key2
        echo.
        echo # 2. Telegram Bot Token
        echo TELEGRAM_TOKEN=填入你的BotToken
        echo.
        echo # 3. 管理員 ID ^(安全性設定^)
        echo ADMIN_ID=填入你的TelegramID
        echo.
        echo # 4. 記憶體儲存路徑
        echo USER_DATA_DIR=./golem_memory
        echo.
        echo # 5. 測試模式
        echo GOLEM_TEST_MODE=false
    ) > .env
    echo    ⚠️ 已建立 .env 檔案，請記得填入 API Key！
) else (
    echo    ✅ .env 設定檔已存在。
)

:: 初始化 JSON 檔案 (避免初次讀取錯誤)
if not exist golem_persona.json echo {} > golem_persona.json
if not exist golem_learning.json echo {} > golem_learning.json

:: 5. 完成
echo.
echo ========================================================
echo      🎉 Golem v7.1 部署就緒！
echo ========================================================
echo.
echo [下一步指引]
echo 1. 請打開專案目錄下的 .env 檔案。
echo 2. 填入 GEMINI_API_KEYS (必要！)。
echo 3. 填入 TELEGRAM_TOKEN (必要！)。
echo 4. 填入 ADMIN_ID (建議)。
echo.
echo 設定完成後，請執行: npm start
echo.
pause
