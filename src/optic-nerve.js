'use strict';
/**
 * @module optic-nerve
 * @role OpticNerve — 視覺感知，透過 ModelRouter 下載並分析圖片/文件
 * @when-to-modify 調整視覺分析 prompt 或 vision intent 設定時
 */
const https = require('https');

class OpticNerve {
    static async analyze(fileUrl, mimeType, router) {
        console.log(`👁️ [OpticNerve] 正在透過 ModelRouter 分析檔案 (${mimeType})...`);
        try {
            const buffer = await new Promise((resolve, reject) => {
                https.get(fileUrl, (res) => {
                    const data = [];
                    res.on('data', (chunk) => data.push(chunk));
                    res.on('end', () => resolve(Buffer.concat(data)));
                    res.on('error', reject);
                });
            });
            const prompt = mimeType.startsWith('image/')
                ? "請詳細描述這張圖片的視覺內容。如果包含文字或程式碼，請完整轉錄。如果是介面截圖，請描述UI元件。請忽略無關的背景雜訊。"
                : "請閱讀這份文件，並提供詳細的摘要、關鍵數據與核心內容。";

            const result = await router.complete({
                intent: 'vision',
                messages: [{ role: 'user', content: prompt }],
                maxTokens: 8192,
                temperature: 0.5,
                inlineData: { data: buffer.toString('base64'), mimeType },
            });

            console.log("✅ [OpticNerve] 分析完成 (長度: " + result.text.length + ", via " + result.meta.provider + ")");
            return result.text;
        } catch (e) {
            console.error("❌ [OpticNerve] 解析失敗:", e.message);
            return `(系統錯誤：視神經無法解析此檔案。原因：${e.message})`;
        }
    }
}

module.exports = OpticNerve;
