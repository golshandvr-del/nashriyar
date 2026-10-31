// End-to-end test runner: seeds a throwaway database, starts the Node server on a free port,
// runs every suite in tests/ against it, then shuts the server down.
// Usage: npm run build && npm test        (CI runs exactly this)
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const PORT = Number(process.env.TEST_PORT || 3999)
const BASE = `http://127.0.0.1:${PORT}`
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nashriyar-test-'))
const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR, BASE }
const SUITES = ['tests/smoke.mjs', 'tests/admin-writes.mjs', 'tests/security.mjs']

if (!fs.existsSync('server-dist/node.mjs') || !fs.existsSync('dist/index.html')) {
  console.error('Build first: npm run build')
  process.exit(1)
}

const seed = spawnSync(process.execPath, ['server-dist/node.mjs', '--seed'], { env, stdio: 'inherit' })
if (seed.status !== 0) process.exit(seed.status || 1)

const server = spawn(process.execPath, ['server-dist/node.mjs'], { env, stdio: ['ignore', 'inherit', 'inherit'] })
let failed = 0
try {
  // wait until /api/health answers (max ~20s)
  let up = false
  for (let i = 0; i < 80 && !up; i++) {
    await new Promise((r) => setTimeout(r, 250))
    up = await fetch(`${BASE}/api/health`).then((r) => r.ok).catch(() => false)
  }
  if (!up) throw new Error('server did not become healthy')

  for (const suite of SUITES) {
    console.log(`\n▶ ${suite}`)
    const r = spawnSync(process.execPath, [suite], { env, stdio: 'inherit' })
    if (r.status !== 0) failed++
  }
} catch (e) {
  console.error(e)
  failed++
} finally {
  server.kill('SIGTERM')
  fs.rmSync(DATA_DIR, { recursive: true, force: true })
}

console.log(failed ? `\n✗ ${failed} suite(s) failed` : '\n✓ all e2e suites passed')
process.exit(failed ? 1 : 0)
