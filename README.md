# project-golem
Headless browser agent powered by Gemini &amp; Ollama.
🦞 Project Golem (魔像計畫)
"Body of a machine, Mind of a god." 一個基於 Puppeteer (手腳) 與 Ollama (小腦) 的雙腦協作 AI 代理人。

Project Golem 是一個為了實踐 "Vibe Coding" 精神而生的實驗性專案。它將本地電腦轉化為一個「執行端 (Body)」，透過瀏覽器自動化技術，借用網頁版 AI (如 Gemini Advanced) 作為「大腦 (Brain)」，並透過 Telegram 介面讓你隨時隨地指揮家裡的電腦。

✨ 核心特色 (Features)
🧠 雙腦架構 (Dual-Brain):
大腦: 使用網頁版 Gemini/ChatGPT 處理複雜邏輯與程式碼生成。
小腦: 使用本地 Ollama (Llama 3) 進行網頁視覺辨識與長文摘要。
💸 完全免費 (Free Tier Hacker): 繞過 API 付費牆，直接使用強大的網頁版模型。
🕵️‍♂️ 隱形模式 (Stealth Mode): 整合 puppeteer-extra-plugin-stealth，有效規避機器人偵測。
📱 隨身指揮 (Telegram Bot): 躺在沙發上也能透過手機指揮電腦寫程式。


🛠️ 安裝指南 (Installation)
1. 環境準備 (Prerequisites)
請確保你的電腦已安裝以下軟體：
Node.js (v18 或更高版本)
Google Chrome 瀏覽器
Ollama (並下載 Llama 3 模型: ollama pull llama3.2:3b)
2. 下載專案
git clone [https://github.com/Arvincreator/project-golem.git](https://github.com/Arvincreator/project-golem.git)
cd project-golem


4. 安裝依賴套件
npm install


5. 設定環境變數
請將 .env.example 複製並改名為 .env，然後填入你的 Telegram Token：
Windows:
copy .env.example .env


Mac/Linux:
cp .env.example .env


用文字編輯器打開 .env 並填入：
TELEGRAM_TOKEN=你的_Telegram_Bot_Token_在這裡
USER_DATA_DIR=./golem_memory


🚀 使用教學 (Usage)
步驟 1：喚醒魔像
在終端機輸入以下指令啟動程式：
node index.js


步驟 2：首次登入 (關鍵！)
程式啟動後，會自動彈出一個 Chrome 視窗並前往 Gemini 網站。
第一次執行時，請手動在該視窗輸入你的 Google 帳號密碼登入。
登入完成後，你不需要關閉視窗，魔像會自動記住你的登入狀態 (Cookie)。

步驟 3：開始指揮
打開你的手機 Telegram App。
找到你的 Bot (例如 @MyGolemBot)。
傳送訊息給它，例如：「幫我用 Python 寫一個貪吃蛇遊戲」 「解釋量子力學是什麼」
觀察電腦螢幕： 你會看到瀏覽器自動打字、發送訊息。
接收回應： 幾秒鐘後，魔像會把 Gemini 的回答傳回你的手機 (如果是長文，Ollama 會幫你做摘要)。

❓ 常見問題 (Troubleshooting)
Q: 程式顯示「找不到輸入框」？ A: Google 有時會更改網頁結構。請確認你的瀏覽器視窗是否為「已登入」狀態。如果已登入仍失敗，可能需要更新 index.js 中的 CSS Selector。
Q: 需要一直開著電腦嗎？ A: 是的，因為這是一個本地執行的程式，你的電腦就是伺服器。
Q: 會被 Google 封鎖帳號嗎？ A: 本專案使用了 puppeteer-extra-plugin-stealth 來模擬真人行為，但仍建議不要進行極高頻率的請求 (例如每秒 10 次)，以免觸發風控。
🤝 貢獻 (Contributing)
歡迎提交 PR 或 Issue，讓我們一起完善這隻魔像！
⚠️ 免責聲明 (Disclaimer)
本專案僅供學術研究與個人自動化測試使用。請遵守相關服務條款。
Created with the spirit of Vibe Coding.
