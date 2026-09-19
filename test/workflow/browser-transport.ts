import { createServer, request, type Server } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import tailwindConfig from '../../tailwind.config';

/** Assets only are fixture-generated. Every API byte comes from the real app. */
export async function browserTransport() {
  const root = resolve('.');
  const bundle = await build({
    absWorkingDir: root, stdin: { resolveDir: root, loader: 'tsx', contents:
      `import React from 'react'; import {createRoot} from 'react-dom/client'; import App from './client/src/App'; createRoot(document.getElementById('root')).render(<App/>);` },
    bundle: true, write: false, format: 'esm', platform: 'browser', jsx: 'automatic',
    loader: { '.css': 'empty' },
    alias: { '@': resolve(root, 'client/src'), '@shared': resolve(root, 'shared') },
    define: { 'import.meta.env': JSON.stringify({ DEV: false, PROD: false, BASE_URL: '/' }), 'process.env.NODE_ENV': '"test"' },
  });
  const source = (await readFile(resolve(root, 'client/src/index.css'), 'utf8'))
    .replace('@import "./design/tokens.generated.css";', await readFile(resolve(root, 'client/src/design/tokens.generated.css'), 'utf8'));
  const css = (await postcss([tailwindcss(tailwindConfig)]).process(source, { from: resolve(root, 'client/src/index.css') })).css;
  let upstream: string | undefined;
  const errors: string[] = [];
  const server = createServer((req, res) => {
    if (req.url?.startsWith('/api/')) {
      if (!upstream) { res.writeHead(503).end(); return; }
      // Keep Origin and Cookie untouched: Better Auth must trust the actual front origin.
      const proxy = request(new URL(req.url, upstream), { method: req.method, headers: req.headers }, incoming => {
        res.writeHead(incoming.statusCode ?? 502, incoming.headers); incoming.pipe(res);
      });
      proxy.on('error', error => {
        errors.push(error.message);
        if (!res.headersSent) { res.writeHead(502); }
        res.end();
      });
      res.on('close', () => { if (!res.writableEnded) proxy.destroy(); });
      req.pipe(proxy); return;
    }
    if (req.url === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); return; }
    if (req.url === '/fixture.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); return; }
    if (req.url?.startsWith('/api')) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'");
    res.end('<!doctype html><html><head><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing browser listener');
  return { origin: `http://127.0.0.1:${address.port}`, errors,
    connect: (origin: string) => { upstream = origin; }, close: () => closeServer(server) };
}
async function closeServer(server: Server) {
  await new Promise<void>((ok, fail) => { server.close(error => error ? fail(error) : ok()); server.closeAllConnections(); });
}