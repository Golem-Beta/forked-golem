/**
 * 🦞 Project Golem v2.5 (Battle Hardened)
 * 核心升級：
 * - 加入 Browser Manager 類別管理生命週期
 * - 優化 DOM 操作 (移除慢速鍵盤模擬)
 * - 增加錯誤時自動截圖 (Debug Screenshot)
 * - 支援長訊息自動切分
 * - 增強的等待回應機制
 */

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { default: ollama } = require('ollama');
const fs = require('fs');

// 1. 穿上隱形斗篷
puppeteer.use(StealthPlugin());

// --- 設定檢查 ---
const CONFIG = {
    TOKEN: process.env.TELEGRAM_TOKEN,
    USER_DATA_DIR: process.env.USER_DATA_DIR || './golem_memory',
    TIMEOUT: 120000, // 2分鐘超時
    DEBUG_DIR: './debug_screenshots'
};

if (!CONFIG.TOKEN) {
    console.error('❌ 錯誤: 請在 .env 設定 TELEGRAM_TOKEN');
    process.exit(1);
}

// 確保 debug 目錄存在
if (!fs.existsSync(CONFIG.DEBUG_DIR)) fs.mkdirSync(CONFIG.DEBUG_DIR);

// --- Browser Manager (瀏覽器管家) ---
class GolemBrowser {
    constructor() {
        this.browser = null;
        this.page = null;
        this.isInitializing = false;
    }

    async init() {
        if (this.browser && this.page && !this.page.isClosed()) return;
        if (this.isInitializing) return; // 避免同時喚醒

        this.isInitializing = true;
        console.log('🧱 Golem 正在甦醒 (啟動瀏覽器)...');

        try {
            this.browser = await puppeteer.launch({
                headless: false, // 建議保持 false 以避免被 Google 封鎖
                userDataDir: CONFIG.USER_DATA_DIR,
                defaultViewport: null,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,900']
            });

            const pages = await this.browser.pages();
            this.page = pages.length > 0 ? pages[0] : await this.browser.newPage();
            
            // 偽裝
            await this.page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

            console.log('🌊 連線至 Gemini...');
            await this.page.goto('https://gemini.google.com/app', { waitUntil: 'networkidle2' });
            
            console.log('✅ Golem 就緒！');
        } catch (error) {
            console.error('❌ 喚醒失敗:', error);
            await this.cleanup();
        } finally {
            this.isInitializing = false;
        }
    }

    async cleanup() {
        if (this.browser) await this.browser.close().catch(() => {});
        this.browser = null;
        this.page = null;
    }

    async resetChat() {
        await this.init();
        try {
            console.log('🔄 重置對話...');
            await this.page.goto('https://gemini.google.com/app', { waitUntil: 'networkidle2' });
            return "已開啟新話題 ✨";
        } catch (e) {
            return "重置失敗，請稍後再試。";
        }
    }

    async sendMessage(text) {
        await this.init();
        const page = this.page;

        try {
            // 1. 尋找輸入框 (多種選擇器容錯)
            const selectors = [
                'div[contenteditable="true"]',
                'rich-textarea > div',
                'div[role="textbox"]'
            ];
            const inputSelector = await page.waitForSelector(selectors.join(','), { timeout: 10000 });

            // 2. 高速清空與輸入 (使用 DOM 操作代替鍵盤刪除)
            await page.evaluate((sel) => {
                const el = document.querySelector(sel);
                if (el) {
                    el.focus();
                    el.innerHTML = ''; // 直接清空 DOM
                }
            }, selectors[0]); // 這裡假設第一個選到的就是對的，通常是 contenteditable

            // 稍微等待讓 React/Angular 偵測到清空
            await new Promise(r => setTimeout(r, 100));
            
            // 輸入文字 (type 觸發事件最穩)
            await page.type(selectors[0], text, { delay: 2 });
            await page.keyboard.press('Enter');

            // 3. 等待回應
            // 策略：等待 "Stop generating" 出現然後消失，或者等待新的 model-response-text 出現
            console.log('⏳ 等待 Gemini 回應...');
            
            // 等待 loading 結束
            await page.waitForFunction(() => {
                const stopBtn = document.querySelector('[aria-label="Stop generating"], [aria-label="停止產生"]');
                const thinking = document.querySelector('.streaming-icon');
                return !stopBtn && !thinking;
            }, { timeout: CONFIG.TIMEOUT, polling: 500 });

            // 4. 抓取最後一條回應
            const responseText = await page.evaluate(() => {
                // 排除自己的輸入，只抓模型回應
                const bubbles = document.querySelectorAll('message-content, .model-response-text');
                if (bubbles.length === 0) return null;
                const lastBubble = bubbles[bubbles.length - 1];
                return lastBubble.innerText || lastBubble.textContent;
            });

            if (!responseText) throw new Error("抓不到回應內容 (可能是 DOM 結構改變)");
            return responseText;

        } catch (error) {
            console.error('❌ 操作錯誤:', error);
            // 錯誤時截圖
            const filename = `${CONFIG.DEBUG_DIR}/error_${Date.now()}.png`;
            await page.screenshot({ path: filename });
            console.log(`📸 已儲存錯誤截圖: ${filename}`);
            
            throw error; // 往外拋給 Bot 處理
        }
    }
}

// --- 初始化 Bot 與 Browser ---
const bot = new TelegramBot(CONFIG.TOKEN, { polling: true });
const golem = new GolemBrowser();

// 🔒 訊息隊列鎖
let messageQueue = Promise.resolve();

// --- 輔助：切分長訊息 ---
function splitMessage(text, maxLength = 4000) {
    const chunks = [];
    for (let i = 0; i < text.length; i += maxLength) {
        chunks.push(text.substring(i, i + maxLength));
    }
    return chunks;
}

// --- 🧠 Ollama 摘要 ---
async function summarizeWithOllama(text) {
    try {
        await ollama.list(); 
        const response = await ollama.chat({
            model: 'llama3.2:3b',
            messages: [{
                role: 'user',
                content: `請用繁體中文摘要以下內容，直接講重點：\n\n${text.substring(0, 2000)}`
            }]
        });
        return response.message.content;
    } catch (e) {
        return null;
    }
}

// --- 🤖 Telegram 處理邏輯 ---
bot.on('message', (msg) => {
    // 隊列處理，防止併發打架
    messageQueue = messageQueue.then(async () => {
        await handleMessage(msg);
    }).catch(err => {
        console.error('Queue Error:', err);
    });
});

async function handleMessage(msg) {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text) return;
    console.log(`📩 [${msg.from.first_name}]: ${text.substring(0, 20)}...`);

    // 指令
    if (text === '/start') return bot.sendMessage(chatId, '👋 Golem v2.5 Online.\n直接對話即可。/new 開啟新話題。');
    if (text === '/new') {
        const status = await golem.resetChat();
        return bot.sendMessage(chatId, status);
    }

    bot.sendChatAction(chatId, 'typing');
    const startMsg = await bot.sendMessage(chatId, '🧱 Golem 讀取中...');

    try {
        // 核心調用
        const geminiResponse = await golem.sendMessage(text);
        
        // 刪除 "讀取中"
        await bot.deleteMessage(chatId, startMsg.message_id).catch(() => {});

        // 處理長回應
        if (geminiResponse.length > 4000) {
            // 1. 先發送 Ollama 摘要 (如果可用)
            bot.sendMessage(chatId, '📜 內容較長，生成摘要中...', { disable_notification: true });
            const summary = await summarizeWithOllama(geminiResponse);
            if (summary) {
                await bot.sendMessage(chatId, `🧠 **重點摘要:**\n${summary}`, { parse_mode: 'Markdown' });
            }

            // 2. 切分發送完整內容
            const chunks = splitMessage(geminiResponse);
            for (const chunk of chunks) {
                await bot.sendMessage(chatId, chunk); // 這裡不開 Markdown 避免切斷語法報錯
            }
        } else {
            // 短回應直接發送 (嘗試 Markdown)
            try {
                await bot.sendMessage(chatId, geminiResponse, { parse_mode: 'Markdown' });
            } catch (e) {
                // Markdown 失敗 (常見於未閉合的符號)，降級發送
                await bot.sendMessage(chatId, geminiResponse);
            }
        }

    } catch (error) {
        await bot.editMessageText(`⚠️ 發生錯誤: ${error.message}\n(管理員請檢查 debug_screenshots)`, { chat_id: chatId, message_id: startMsg.message_id });
        // 發生嚴重錯誤時，嘗試重啟瀏覽器以修復下一次請求
        await golem.cleanup();
    }
}

console.log('📡 Golem v2.5 (Battle Hardened) 啟動完成。');
