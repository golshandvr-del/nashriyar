// WCAG AA contrast check for the design tokens (ROADMAP phase 16): reads the light (:root) and dark (.dark) tokens
// straight from src/web/styles.css, so a palette change that breaks AA fails CI. No server or browser needed.
// Usage: node tests/contrast.mjs
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('../src/web/styles.css', import.meta.url), 'utf8')
const block = (sel) => {
  const m = new RegExp(`(^|\\n)${sel.replace('.', '\\.')}\\s*\\{([^}]*)\\}`).exec(css)
  if (!m) throw new Error('token block not found: ' + sel)
  return Object.fromEntries([...m[2].matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((x) => [x[1], x[2]]))
}
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

// text-bearing tokens that must reach 4.5:1 on every background they are used on
const FG = ['text', 'muted', 'brand', 'lapis', 'gold', 'ochre', 'danger', 'warn', 'ok']
const BG = ['bg', 'surface', 'surface-2']
let failures = 0
for (const [name, sel] of [['light', ':root'], ['dark', '.dark']]) {
  const t = block(sel)
  const rows = []
  for (const fg of FG) {
    if (!t[fg]) (failures++, rows.push(`  ✗ missing token --${fg}`))
    for (const bg of BG) {
      if (!t[fg] || !t[bg]) continue
      const r = ratio(t[fg], t[bg])
      if (r < 4.5) (failures++, rows.push(`  ✗ ${fg} on ${bg}: ${r.toFixed(2)}:1`))
    }
  }
  const bi = ratio(t['brand'], t['brand-ink'])
  if (bi < 4.5) (failures++, rows.push(`  ✗ brand-ink on brand: ${bi.toFixed(2)}:1`))
  console.log(`${name}: ${rows.length ? 'problems' : 'all tokens ≥ 4.5:1'}`)
  rows.forEach((r) => console.log(r))
}
console.log(failures ? `\n✗ contrast: ${failures} failure(s)` : '\n✓ contrast: WCAG AA in both themes')
process.exit(failures ? 1 : 0)
