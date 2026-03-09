/**
 * threads-client.js — Threads API 客戶端
 * 功能：發文、讀自己的 posts、自動刷新 long-lived token
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const TOKEN_CACHE = path.join(process.cwd(), 'memory', 'threads-token.json');
const BASE = 'graph.threads.net';

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('JSON parse failed: ' + data.slice(0, 200))); }
      });
    }).on('error', reject);
  });
}

function httpsPost(hostname, path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const opts = {
      hostname, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('JSON parse failed: ' + data.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// 取得有效 token（優先讀快取，過期則刷新）
async function getToken() {
  let cached = null;
  try {
    if (fs.existsSync(TOKEN_CACHE)) {
      cached = JSON.parse(fs.readFileSync(TOKEN_CACHE, 'utf8'));
    }
  } catch {}

  const now = Date.now();

  // 若快取存在且距離過期 > 7 天，直接用
  if (cached && cached.expires_at && (cached.expires_at - now) > 7 * 24 * 3600 * 1000) {
    return cached.access_token;
  }

  // 若快取存在但快過期（< 7 天），刷新
  if (cached && cached.access_token) {
    console.log('[Threads] 刷新 long-lived token...');
    const appSecret = process.env.THREADS_APP_SECRET;
    const url = `https://${BASE}/refresh_access_token?grant_type=th_refresh_token&access_token=${cached.access_token}`;
    const res = await httpsGet(url);
    if (res.access_token) {
      const newCache = {
        access_token: res.access_token,
        expires_at: now + (res.expires_in * 1000),
        refreshed_at: new Date().toISOString()
      };
      fs.writeFileSync(TOKEN_CACHE, JSON.stringify(newCache, null, 2));
      return res.access_token;
    }
  }

  // 直接使用 .env 的 token（透過 Meta Developer 產生存取權杖）
  const token = process.env.THREADS_ACCESS_TOKEN;
  if (!token) throw new Error('缺少 THREADS_ACCESS_TOKEN');
  // 快取起來供刷新流程使用
  const cache = {
    access_token: token,
    expires_at: now + (60 * 24 * 3600 * 1000), // 假設 60 天後需要手動更新
    obtained_at: new Date().toISOString()
  };
  fs.writeFileSync(TOKEN_CACHE, JSON.stringify(cache, null, 2));
  return token;
}

// 取得自己的 user ID
async function getMyUserId(token) {
  const res = await httpsGet(`https://${BASE}/v1.0/me?fields=id,username,name&access_token=${token}`);
  if (!res.id) throw new Error('無法取得 user ID: ' + JSON.stringify(res));
  return res;
}

// 發文（純文字）
async function publish(text) {
  const token = await getToken();
  const me = await getMyUserId(token);

  // Step 1: 建立 container
  const container = await httpsPost(BASE, `/v1.0/${me.id}/threads`, {
    media_type: 'TEXT',
    text,
    access_token: token
  });

  if (!container.id) throw new Error('建立 container 失敗: ' + JSON.stringify(container));

  // Step 2: 等 1 秒後發布
  await new Promise(r => setTimeout(r, 1000));
  const result = await httpsPost(BASE, `/v1.0/${me.id}/threads_publish`, {
    creation_id: container.id,
    access_token: token
  });

  if (!result.id) throw new Error('發布失敗: ' + JSON.stringify(result));
  return { id: result.id, text, username: me.username };
}

// 讀自己最近的 posts
async function getMyPosts(limit = 5) {
  const token = await getToken();
  const me = await getMyUserId(token);
  const res = await httpsGet(
    `https://${BASE}/v1.0/${me.id}/threads?fields=id,text,timestamp,like_count,reply_count&limit=${limit}&access_token=${token}`
  );
  return res.data || [];
}

// 讀取某貼文的回覆
async function getReplies(postId, limit = 5) {
  const token = await getToken();
  const res = await httpsGet(
    `https://${BASE}/v1.0/${postId}/replies?fields=id,text,username,timestamp&limit=${limit}&access_token=${token}`
  );
  return res.data || [];
}

// 回覆某貼文（兩步驟：建立 container → publish）
async function replyToPost(postId, text) {
  const token = await getToken();
  const me = await getMyUserId(token);
  const container = await httpsPost(BASE, `/v1.0/${me.id}/threads`, {
    media_type: 'TEXT',
    text,
    reply_to_id: postId,
    access_token: token,
  });
  if (!container.id) throw new Error('建立 reply container 失敗: ' + JSON.stringify(container));
  await new Promise(r => setTimeout(r, 1000));
  const result = await httpsPost(BASE, `/v1.0/${me.id}/threads_publish`, {
    creation_id: container.id,
    access_token: token,
  });
  if (!result.id) throw new Error('reply 發布失敗: ' + JSON.stringify(result));
  return { id: result.id };
}

module.exports = { publish, getMyPosts, getReplies, replyToPost, getToken, getMyUserId };
