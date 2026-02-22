/**
 * OpenAICompatAdapter — OpenAI-compatible API 的通用 adapter
 * 適用於 Groq, DeepSeek, Mistral, OpenRouter
 */
const https = require('https');
const ProviderAdapter = require('./base');

class OpenAICompatAdapter extends ProviderAdapter {
    constructor(name, config) {
        super(name, config);
        this.baseUrl = config.baseUrl;
        this.apiKey = (process.env[config.envKey] || '').trim();

        if (this.apiKey) {
            console.log(`🔑 [${name}] API key loaded`);
        }
    }

    isAvailable() {
        return !!this.apiKey;
    }

    async complete(params) {
        const {
            model,
            messages = [],
            maxTokens = 4096,
            temperature = 0.7,
            requireJson = false,
            systemInstruction,
        } = params;

        // 組裝 OpenAI 格式的 messages
        const apiMessages = [];
        if (systemInstruction) {
            apiMessages.push({ role: 'system', content: systemInstruction });
        }
        for (const m of messages) {
            apiMessages.push({ role: m.role || 'user', content: m.content });
        }

        const body = {
            model,
            messages: apiMessages,
            max_tokens: maxTokens,
            temperature,
        };

        if (requireJson) {
            body.response_format = { type: 'json_object' };
        }

        const url = new URL(this.baseUrl + '/chat/completions');
        const postData = JSON.stringify(body);

        return new Promise((resolve, reject) => {
            const options = {
                hostname: url.hostname,
                port: url.port || 443,
                path: url.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Length': Buffer.byteLength(postData),
                },
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const json = JSON.parse(data);

                        if (res.statusCode === 429) {
                            const retryAfter = res.headers['retry-after'];
                            const err = new Error(`[${this.name}] 429 Too Many Requests`);
                            err.providerError = '429';
                            err.retryAfterMs = retryAfter ? parseInt(retryAfter) * 1000 : 90000;
                            reject(err);
                            return;
                        }

                        if (res.statusCode === 503) {
                            const err = new Error(`[${this.name}] 503 Service Unavailable`);
                            err.providerError = '503';
                            reject(err);
                            return;
                        }

                        if (res.statusCode >= 400) {
                            const errMsg = json.error?.message || JSON.stringify(json);
                            const err = new Error(`[${this.name}] HTTP ${res.statusCode}: ${errMsg}`);
                            err.providerError = 'error';
                            reject(err);
                            return;
                        }

                        const choice = json.choices?.[0];
                        const text = choice?.message?.content || '';
                        const usage = json.usage || {};

                        resolve({
                            text: text.trim(),
                            usage: {
                                inputTokens: usage.prompt_tokens || 0,
                                outputTokens: usage.completion_tokens || 0,
                            },
                        });
                    } catch (e) {
                        reject(new Error(`[${this.name}] response parse error: ${e.message}`));
                    }
                });
            });

            req.on('error', (e) => {
                const err = new Error(`[${this.name}] network error: ${e.message}`);
                err.providerError = 'error';
                reject(err);
            });

            req.setTimeout(60000, () => {
                req.destroy();
                const err = new Error(`[${this.name}] request timeout (60s)`);
                err.providerError = 'error';
                reject(err);
            });

            req.write(postData);
            req.end();
        });
    }
}

module.exports = OpenAICompatAdapter;
