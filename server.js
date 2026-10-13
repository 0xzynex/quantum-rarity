// Local preview: node server.js, then open http://localhost:5190
// On a VPS, Caddy serves these same files (see deploy/).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('.', import.meta.url).pathname;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const ALLOWED = /^\/(index\.html|web\/[\w.-]+|src\/[\w.-]+|data\/[\w.-]+\.json|assets\/[\w./-]+)$/;
const PORT = +(process.env.PORT || 5190);

createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/') path = '/index.html';
  path = normalize(path).replace(/\\/g, '/');
  if (!ALLOWED.test(path) || path.includes('..')) { res.writeHead(404); return res.end('not found'); }
  try {
    const body = await readFile(join(ROOT, path));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream', 'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'" });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
}).listen(PORT, '127.0.0.1', () => console.log(`\n  Quantum Rarity  →  http://localhost:${PORT}\n`));
