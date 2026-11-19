// SOLANO HEAT — local play server.
//
// Running `node serve.ts` serves the game/ folder on http://localhost:8080
// so the game can be played in a desktop browser with no build step and no
// network access. An optional --port flag picks a different port, which the
// screenshot tooling uses to avoid clashing with anything already running.
//
// The server is deliberately boring: it maps a small table of extensions to
// MIME types, refuses any request that tries to escape the game/ folder,
// and streams the file back. It is a development convenience only.

import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const gameRoot = resolve(fileURLToPath(new URL('./game', import.meta.url)));

const argv = process.argv.slice(2);
const flagAt = argv.indexOf('--port');
const wanted = flagAt === -1 ? 8080 : Number(argv[flagAt + 1]);
const listenPort =
  Number.isInteger(wanted) && wanted > 0 && wanted < 65536 ? wanted : 8080;

const typesByExtension: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

const server = createServer((req, res) => {
  let rawPath = '/';
  try {
    rawPath = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end('bad request');
    return;
  }
  if (rawPath.endsWith('/')) rawPath += 'index.html';
  const candidate = resolve(join(gameRoot, normalize(rawPath)));
  if (candidate !== gameRoot && !candidate.startsWith(gameRoot + sep)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  let length = 0;
  try {
    const info = statSync(candidate);
    if (!info.isFile()) throw new Error('directory');
    length = info.size;
  } catch {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, {
    'content-type': typesByExtension[extname(candidate).toLowerCase()] ?? 'application/octet-stream',
    'content-length': length,
    'cache-control': 'no-store',
  });
  createReadStream(candidate).pipe(res);
});

server.listen(listenPort, '127.0.0.1', () => {
  console.log(`SOLANO HEAT is playable at http://localhost:${listenPort}`);
});
