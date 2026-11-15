// Local static serving of a checkout for development and preview (#2380). The
// checkout keeps placeholder shell identities, so index.html and sw.js are
// stamped with the values computed from the files being served, exactly as the
// Pages deploy does; every other file is served as it is on disk.
//
//   node scripts/serve-shell.mjs [--root <checkout>] [--port <port>]
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { servedShellReader } from './shell-fingerprints.mjs';

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.md': 'text/markdown' };

export function createShellServer(root) {
  const base = path.resolve(root);
  return http.createServer((request, response) => {
    let file;
    try { file = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname).replace(/^\/+/, '') || 'index.html'; }
    catch { response.writeHead(400); response.end(); return; }
    const absolute = path.resolve(base, file);
    if (!absolute.startsWith(base + path.sep)) { response.writeHead(403); response.end(); return; }
    let bytes = null;
    // Recomputed per request so an edit shows on the next reload.
    const read = servedShellReader(name => fs.readFileSync(path.join(base, name)));
    const relative = path.relative(base, absolute).split(path.sep).join('/');
    try { bytes = read(relative); } catch (error) {
      // A stale committed identity is a refusal, never a silently stale shell.
      if (relative === 'index.html' || relative === 'sw.js') { response.writeHead(500, { 'Content-Type': 'text/plain' }); response.end(error.message); return; }
      /* a missing file or a directory is a 404 */
    }
    response.writeHead(bytes ? 200 : 404, { 'Content-Type': MIME[path.extname(absolute)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    response.end(bytes || 'Not found');
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  const port = Number(option('--port') ?? 8934);
  const server = createShellServer(option('--root') ?? process.cwd());
  server.listen(port, '127.0.0.1', () => process.stdout.write('Serving on http://127.0.0.1:' + server.address().port + '/\n'));
}
