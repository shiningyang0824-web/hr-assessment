const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const crypto = require('crypto');

const API_KEY     = 'YOUR_WILDCARD_API_KEY';
const TARGET_HOST = 'api.gptsapi.net';
const PORT        = 3000;
const REPORTS_DIR = path.join(__dirname, 'reports');

// 确保报告存储目录存在
if (!fs.existsSync(REPORTS_DIR)) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

// 生成6位短ID
function genId() {
  return crypto.randomBytes(3).toString('hex'); // e.g. "a3f9c2"
}

// 解析请求 body
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, anthropic-version, x-api-key');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ── 健康检查 ──
  if (req.url === '/' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('HR Assessment Proxy OK');
    return;
  }

  // ── 保存报告：POST /save-report ──
  if (req.url === '/save-report' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const data = JSON.parse(body);

      // 生成唯一ID，避免冲突
      let id = genId();
      while (fs.existsSync(path.join(REPORTS_DIR, id + '.json'))) {
        id = genId();
      }

      fs.writeFileSync(
        path.join(REPORTS_DIR, id + '.json'),
        JSON.stringify({ ...data, savedAt: new Date().toISOString() }),
        'utf8'
      );

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id, url: `http://43.129.169.251/report/${id}` }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ── 读取报告：GET /report/:id ──
  const reportMatch = req.url.match(/^\/report\/([a-f0-9]{6})$/);
  if (reportMatch && req.method === 'GET') {
    const id = reportMatch[1];
    const filePath = path.join(REPORTS_DIR, id + '.json');

    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Report not found' }));
      return;
    }

    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ── Claude API 转发：POST /v1/messages ──
  if (req.url === '/v1/messages' && req.method === 'POST') {
    const body = await readBody(req);

    const options = {
      hostname: TARGET_HOST,
      port: 443,
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body),
      }
    };

    const proxyReq = https.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (e) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    });

    proxyReq.write(body);
    proxyReq.end();
    return;
  }

  // ── 404 ──
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`Proxy running on port ${PORT}`);
});
