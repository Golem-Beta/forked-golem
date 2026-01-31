#!/bin/bash

# 定義顏色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "\n${CYAN}=============================================================${NC}"
echo -e "${CYAN} 🦞 Project Golem v6.3 (Ouroboros Edition)${NC}"
echo -e "${CYAN} -----------------------------------------------------------${NC}"
echo -e "${CYAN} 自動化部署與環境初始化腳本 (Mac/Linux)${NC}"
echo -e "${CYAN}=============================================================${NC}\n"

echo -e "[1/4] 正在檢查系統環境..."

# 1. 檢查 Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}[X] 錯誤: 未偵測到 Node.js！${NC}"
    echo "    請前往 https://nodejs.org/ 下載並安裝 (v16+)。"
    exit 1
else
    echo -e "${GREEN}[v] Node.js 已安裝。${NC}"
fi

# 2. 檢查 Ollama
if ! command -v ollama &> /dev/null; then
    echo -e "${YELLOW}[!] 警告: 未偵測到 Ollama 指令。${NC}"
    echo "    請確保您已安裝 Ollama (https://ollama.com) 並已啟動服務。"
    echo "    (您可以繼續安裝，但後續需手動設定模型)"
    read -p "按 Enter 繼續..."
else
    echo -e "${GREEN}[v] Ollama 已安裝。${NC}"
fi

echo -e "\n[2/4] 正在安裝核心依賴 (這可能需要幾分鐘)..."
echo "-----------------------------------------------------------"
npm install

if [ $? -ne 0 ]; then
    echo -e "${RED}[X] npm install 失敗，請檢查網路連線。${NC}"
    exit 1
fi

echo -e "\n正在下載 Chrome 瀏覽器核心 (Puppeteer)..."
node node_modules/puppeteer/install.js

echo -e "\n[3/4] 正在初始化 AI 模型 (Llama3)..."
if command -v ollama &> /dev/null; then
    echo "正在拉取 llama3 模型..."
    ollama pull llama3
fi

# ============================================================
# 互動式設定 (.env 生成)
# ============================================================
clear
echo -e "\n${CYAN}=============================================================${NC}"
echo -e "${CYAN} 🔑 身份驗證設定 (Security Clearance)${NC}"
echo -e "${CYAN}=============================================================${NC}\n"
echo "請輸入您的 Telegram Bot 資訊以建立安全連線。"
echo ""

while [ -z "$TG_TOKEN" ]; do
    read -p "👉 請輸入 Bot Token (來自 @BotFather): " TG_TOKEN
done

echo ""
while [ -z "$ADMIN_ID" ]; do
    read -p "👉 請輸入您的 Admin ID (來自 @userinfobot): " ADMIN_ID
done

echo -e "\n[4/4] 正在生成 .env 設定檔..."

cat > .env <<EOF
TELEGRAM_TOKEN=$TG_TOKEN
ADMIN_ID=$ADMIN_ID
USER_DATA_DIR=./golem_memory
OLLAMA_MODEL=llama3
EOF

echo -e "\n${GREEN}=============================================================${NC}"
echo -e "${GREEN} ✅ 部署完成！(Mission Accomplished)${NC}"
echo -e "${GREEN}=============================================================${NC}\n"
echo -e " 輸入 ${YELLOW}npm start${NC} 或 ${YELLOW}node index.js${NC} 即可啟動 Golem。\n"
