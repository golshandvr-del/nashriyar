// Bundles the server for both runtimes (run after `vite build`, which fills dist/ with the SPA).
//   dist/_worker.js        Cloudflare Pages advanced-mode worker (D1 + R2)
//   dist/_routes.json      only /api/* invokes the worker; static files + SPA fallback are served by Pages
//   server-dist/node.mjs   self-hosted Node >= 22.5 server (node:sqlite + disk storage)
import { build } from 'esbuild'
import fs from 'node:fs'

const common = {
  bundle: true,
  format: 'esm',
  target: 'es2022',
  loader: { '.sql': 'text' },
  legalComments: 'none',
  logLevel: 'info'
}

fs.mkdirSync('dist', { recursive: true })

await build({
  ...common,
  entryPoints: ['src/entry/cloudflare.ts'],
  outfile: 'dist/_worker.js',
  platform: 'browser',
  conditions: ['workerd', 'worker', 'browser'],
  minify: true
})

fs.writeFileSync('dist/_routes.json', JSON.stringify({ version: 1, include: ['/api/*', '/robots.txt'], exclude: [] }, null, 2))

await build({
  ...common,
  entryPoints: ['src/entry/node.ts'],
  outfile: 'server-dist/node.mjs',
  platform: 'node',
  external: ['node:*'],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" }
})

console.log('server bundles ready: dist/_worker.js, server-dist/node.mjs')
