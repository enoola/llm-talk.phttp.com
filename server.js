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

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
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
  // form-urlencoded
  const params = new URLSearchParams(body);
  for (const [k, v] of params) fields[k] = v;
  return fields;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    const file = path.join(__dirname, 'public', 'index.html');
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end('Internal error');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
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

  // 404
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

server.listen(PORT, HOST, () => {
  console.log(`llm-talk listening on http://${HOST}:${PORT}`);
});
