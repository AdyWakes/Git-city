import { createServer, type Server } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

export interface ServeOptions {
  root: string;
  cityJson: string;
  port: number;
  host: string;
}

/** Static file server for the bundled viewer plus the generated city at /city.json. Local only. */
export async function serve(opts: ServeOptions): Promise<{ server: Server; url: string }> {
  const city = Buffer.from(opts.cityJson);
  const cityGz = gzipSync(city, { level: 6 });
  const root = resolve(opts.root);

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      let path = decodeURIComponent(url.pathname);
      const gz = /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
      if (path === '/city.json') {
        res.writeHead(200, {
          'content-type': TYPES['.json'],
          'cache-control': 'no-store',
          ...(gz ? { 'content-encoding': 'gzip' } : {}),
        });
        res.end(gz ? cityGz : city);
        return;
      }
      if (path === '/manifest.json') {
        // The CLI never serves a demo manifest; answer fast so the viewer falls back to /city.json.
        res.writeHead(404).end();
        return;
      }
      if (path.endsWith('/')) path += 'index.html';
      const file = normalize(join(root, path));
      if (file !== root && !file.startsWith(root + sep)) {
        res.writeHead(403).end();
        return;
      }
      const info = await stat(file).catch(() => null);
      if (!info || !info.isFile()) {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, {
        'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
        'cache-control': path.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      });
      res.end(body);
    } catch (e) {
      res.writeHead(500, { 'content-type': 'text/plain' }).end(String(e));
    }
  });

  const port = await listen(server, opts.port, opts.host);
  const shownHost = opts.host === '0.0.0.0' || opts.host === '::' ? 'localhost' : opts.host;
  return { server, url: `http://${shownHost}:${port}/` };
}

/** Tries the requested port, then the next 20, then any free port. */
async function listen(server: Server, port: number, host: string): Promise<number> {
  const attempt = (p: number) =>
    new Promise<number>((resolve, reject) => {
      const onError = (e: NodeJS.ErrnoException) => {
        server.off('listening', onListening);
        reject(e);
      };
      const onListening = () => {
        server.off('error', onError);
        const addr = server.address();
        resolve(typeof addr === 'object' && addr ? addr.port : p);
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(p, host);
    });
  for (let p = port; p < port + 20; p++) {
    try {
      return await attempt(p);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw e;
    }
  }
  return attempt(0);
}
