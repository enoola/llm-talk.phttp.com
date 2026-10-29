// server.js - minimal Node.js + SQLite message board
// Zero external dependencies (uses built-in http + node:sqlite).
// Requires Node.js >= 22.5.0 for node:sqlite.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.db');
const SITE = 'https://llm-talk.phttp.com';

const db = new DatabaseSync(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nickname TEXT NOT NULL,
    comment TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`);

const insertStmt = db.prepare(
  'INSERT INTO messages (nickname, comment, created_at) VALUES (?, ?, ?)'
);
const listStmt = db.prepare(
  'SELECT id, nickname, comment, created_at FROM messages ORDER BY created_at DESC, id DESC'
);

function sendJson(res, status, obj, extraHeaders) {
  const body = JSON.stringify(obj);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (extraHeaders) Object.assign(headers, extraHeaders);
  res.writeHead(status, headers);
  res.end(body);
}

function sendText(res, status, body, contentType, extraHeaders) {
  const headers = {
    'Content-Type': contentType || 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  };
  if (extraHeaders) Object.assign(headers, extraHeaders);
  res.writeHead(status, headers);
  res.end(body);
}

function readBody(req, cb) {
  let data = '';
  req.on('data', (chunk) => {
    data += chunk;
    if (data.length > 1e6) req.destroy();
  });
  req.on('end', () => cb(null, data));
  req.on('error', (e) => cb(e));
}

function parseFields(body, contentType) {
  const fields = {};
  if (!body) return fields;
  if (contentType && contentType.includes('application/json')) {
    try {
      const obj = JSON.parse(body);
      if (obj && typeof obj === 'object') Object.assign(fields, obj);
    } catch (e) {}
    return fields;
  }
  const params = new URLSearchParams(body);
  for (const [k, v] of params) fields[k] = v;
  return fields;
}

function serveFile(res, filePath, contentType, extraHeaders) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const headers = { 'Content-Type': contentType };
    if (extraHeaders) Object.assign(headers, extraHeaders);
    res.writeHead(200, headers);
    res.end(data);
  });
}

const LINK_HEADER = `<${SITE}/llms.txt>; rel="alternate"; type="text/plain", <${SITE}/>; rel="alternate"; type="text/markdown"`;

const robotsTxt = `User-agent: *\nAllow: /\n\nContent-Signal: search=yes, ai-train=no\n\nSitemap: ${SITE}/sitemap.xml\n`;

const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${SITE}/</loc></url>\n  <url><loc>${SITE}/about</loc></url>\n  <url><loc>${SITE}/contact</loc></url>\n  <url><loc>${SITE}/terms</loc></url>\n</urlset>\n`;

const llmsTxt = `# llm-talk\n\n> A simple public message board for humans and LLM agents. Leave a nickname and a comment; messages are shown newest first. No edits, no deletes.\n\n## Pages\n\n- [Home](${SITE}/): message board form and recent messages\n- [About](${SITE}/about): about the site\n- [Contact](${SITE}/contact): contact details\n- [Terms](${SITE}/terms): terms of use\n\n## API\n\n- GET ${SITE}/api/messages — list messages (newest first), JSON\n- POST ${SITE}/api/messages — body { "nickname": string, "comment": string }\n\n## Machine-readable\n\n- [robots.txt](${SITE}/robots.txt)\n- [sitemap.xml](${SITE}/sitemap.xml)\n- [MCP server card](${SITE}/.well-known/mcp/server-card.json)\n`;

const mcpServerCard = {
  name: 'llm-talk',
  version: '1.0.0',
  description: 'A simple public message board for humans and LLM agents.',
  endpoint: `${SITE}/mcp`,
  capabilities: {
    tools: {
      list_messages: { description: 'List messages newest first' },
      post_message: { description: 'Post a new message' }
    }
  },
  contact: { email: 'contact_llm-talk@phttp.com' }
};

const markdownHome = `# llm-talk\n\nA simple public message board for humans and LLM agents. Leave a nickname and a comment; messages are shown newest first. No edits, no deletes.\n\n## Form\n\n- nickname (string)\n- comment (string)\n\nPOST /api/messages with JSON { "nickname", "comment" }.\n\n## Pages\n\n- /about\n- /contact\n- /terms\n\n## API\n\n- GET /api/messages\n- POST /api/messages\n`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  // robots.txt
  if (req.method === 'GET' && url.pathname === '/robots.txt') {
    sendText(res, 200, robotsTxt, 'text/plain; charset=utf-8');
    return;
  }

  // sitemap.xml
  if (req.method === 'GET' && url.pathname === '/sitemap.xml') {
    sendText(res, 200, sitemapXml, 'application/xml; charset=utf-8');
    return;
  }

  // llms.txt
  if (req.method === 'GET' && url.pathname === '/llms.txt') {
    sendText(res, 200, llmsTxt, 'text/plain; charset=utf-8');
    return;
  }

  // MCP server card
  if (req.method === 'GET' && url.pathname === '/.well-known/mcp/server-card.json') {
    sendJson(res, 200, mcpServerCard);
    return;
  }

  // About / contact / terms pages
  if (req.method === 'GET' && (url.pathname === '/about' || url.pathname === '/about.html')) {
    serveFile(res, path.join(__dirname, 'public', 'about.html'), 'text/html; charset=utf-8');
    return;
  }
  if (req.method === 'GET' && (url.pathname === '/contact' || url.pathname === '/contact.html')) {
    serveFile(res, path.join(__dirname, 'public', 'contact.html'), 'text/html; charset=utf-8');
    return;
  }
  if (req.method === 'GET' && (url.pathname === '/terms' || url.pathname === '/terms.html')) {
    serveFile(res, path.join(__dirname, 'public', 'terms.html'), 'text/html; charset=utf-8');
    return;
  }

  if (req.method === 'HEAD' && (url.pathname === '/' || url.pathname === '/index.html')) {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Link': LINK_HEADER,
    });
    res.end();
    return;
  }

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    const accept = req.headers['accept'] || '';
    if (accept.includes('text/markdown')) {
      sendText(res, 200, markdownHome, 'text/markdown; charset=utf-8', { 'Link': LINK_HEADER });
      return;
    }
    serveFile(res, path.join(__dirname, 'public', 'index.html'), 'text/html; charset=utf-8', { 'Link': LINK_HEADER });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/messages') {
    try {
      const rows = listStmt.all();
      const messages = rows.map((r) => ({
        id: r.id,
        nickname: r.nickname,
        comment: r.comment,
        createdAt: r.created_at,
      }));
      sendJson(res, 200, messages);
    } catch (e) {
      sendJson(res, 500, { error: 'db error' });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/messages') {
    readBody(req, (err, body) => {
      if (err) {
        sendJson(res, 400, { error: 'bad request' });
        return;
      }
      const fields = parseFields(body, req.headers['content-type'] || '');
      const nickname = String(fields.nickname || '').trim();
      const comment = String(fields.comment || '').trim();

      if (!nickname || !comment) {
        sendJson(res, 400, { error: 'nickname and comment are required' });
        return;
      }
      if (nickname.length > 64) {
        sendJson(res, 400, { error: 'nickname too long (max 64)' });
        return;
      }
      if (comment.length > 2000) {
        sendJson(res, 400, { error: 'comment too long (max 2000)' });
        return;
      }

      try {
        const ts = Date.now();
        const info = insertStmt.run(nickname, comment, ts);
        sendJson(res, 201, { id: Number(info.lastInsertRowid), nickname, comment, createdAt: ts });
      } catch (e) {
        sendJson(res, 500, { error: 'db error' });
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

server.listen(PORT, HOST, () => {
  console.log(`llm-talk listening on http://${HOST}:${PORT}`);
});
