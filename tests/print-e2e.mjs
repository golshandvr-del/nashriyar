// Print preview E2E (ROADMAP phase 18): opens a DataTable in a real browser, prints it (window.print is stubbed) and
// asserts the print sheet: paper size/orientation in the injected @page rule, the same columns and exactly the same rows
// (filter + sort) as the server export, header row repeated (thead = table-header-group), rows never split, automatic
// zoom within bounds, only the sheet visible under print media, and a rendered PDF with the chosen paper size.
// Playwright is optional: without it the suite is skipped (exit 0), like tests/browser-e2e.mjs.
// Usage: BASE=http://127.0.0.1:3000 node tests/print-e2e.mjs   (or via `npm test`)
const BASE = process.env.BASE || 'http://127.0.0.1:3000'
let chromium
try {
  ;({ chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright'))
} catch {
  console.log('⏭  playwright not installed — print suite skipped')
  process.exit(0)
}
let failures = 0
const ok = (cond, msg) => (cond ? console.log('  ✓', msg) : (failures++, console.log('  ✗ FAIL', msg)))

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
await page.addInitScript(() => {
  window.__printed = 0
  window.print = () => void (window.__printed += 1)
})
await page.goto(BASE + '/login')
await page.fill('input[autocomplete=username]', 'officer')
await page.fill('input[autocomplete=current-password]', 'officer1234')
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 }).catch(() => {}), page.click('button[type=submit]')])

const state = 'dt_f_system_role=student&dt_sort=entry_year.desc&dt_cols=display_name,student_number,entry_year,faculty_name'
await page.goto(`${BASE}/admin/users?${state}`)
await page.locator('[data-table-id=admin-users] table').first().waitFor({ timeout: 20000 })

// reference: the server export of the same table state
const csv = await (await page.request.get(`${BASE}/api/admin/users/export?format=csv&${state}`)).text()
const lines = csv.replace(/^\uFEFF/, '').trim().split(/\r?\n/)
const header = lines[0].split(',')
const expected = lines.slice(1).map((l) => l.split(',')[0])

const table = page.locator('[data-table-id=admin-users]')
await table.locator('button:has-text("چاپ")').first().click()
const dlg = page.locator('[role=dialog]')
await dlg.waitFor()
await dlg.locator('select').nth(0).selectOption('A3')
await dlg.locator('select').nth(1).selectOption('landscape')
await dlg.locator('button:has-text("چاپ")').click()
await page.waitForFunction(() => window.__printed > 0, null, { timeout: 5000 }).catch(() => {})

const info = await page.evaluate(() => {
  const sheet = document.querySelector('.dt-print')
  const t = sheet?.querySelector('table')
  return {
    printed: window.__printed,
    printing: document.documentElement.classList.contains('dt-printing'),
    pageRule: document.getElementById('dt-page-style')?.textContent || '',
    head: [...(t?.querySelectorAll('thead th') || [])].map((th) => th.textContent.trim()),
    first: [...(t?.querySelectorAll('tbody tr:not(.dt-print-group)') || [])].map((tr) => tr.querySelector('td')?.textContent.trim()),
    zoom: Number(sheet?.style.zoom || 0),
    title: sheet?.querySelector('h1')?.textContent || '',
    letterhead: sheet?.querySelector('.dt-print-uni')?.textContent || ''
  }
})
ok(info.printed === 1, `window.print called once (${info.printed})`)
ok(info.printing, 'html.dt-printing set while printing')
ok(/size:\s*A3 landscape/.test(info.pageRule) && /counter\(page\)/.test(info.pageRule) && /counter\(pages\)/.test(info.pageRule), `@page rule A3 landscape with «صفحه N از M»: ${info.pageRule.slice(0, 80)}`)
ok(info.head.join('|') === header.join('|'), `print columns = export columns (${info.head.join('، ')})`)
ok(info.first.length === expected.length, `print rows ${info.first.length} = export rows ${expected.length}`)
ok(info.first.every((v, i) => v === expected[i]), 'print row order = export order (same filter + sort)')
ok(info.zoom >= 0.35 && info.zoom <= 1, `automatic zoom within [0.35, 1]: ${info.zoom}`)
ok(info.title === 'کاربران' && info.letterhead.length > 0, `letterhead «${info.letterhead}» + title «${info.title}»`)

await page.emulateMedia({ media: 'print' })
const css = await page.evaluate(() => {
  const s = document.querySelector('.dt-print')
  const tr = s?.querySelector('tbody tr')
  return {
    root: getComputedStyle(document.getElementById('root')).display,
    sheet: s ? getComputedStyle(s).display : '',
    thead: getComputedStyle(s.querySelector('thead')).display,
    rowBreak: tr ? getComputedStyle(tr).breakInside : ''
  }
})
ok(css.root === 'none' && css.sheet === 'block', `print media shows only the sheet (root=${css.root}, sheet=${css.sheet})`)
ok(css.thead === 'table-header-group', `header row repeats on every page (thead ${css.thead})`)
ok(css.rowBreak === 'avoid', `rows never split (break-inside ${css.rowBreak})`)

const pdf = Buffer.from(await page.pdf({ preferCSSPageSize: true, printBackground: true })).toString('latin1')
const pages = (pdf.match(/\/Type\s*\/Page[^s]/g) || []).length
const box = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(pdf)
ok(pages >= 1, `PDF rendered (${pages} page(s))`)
ok(!!box && Math.abs(Number(box[1]) - 1191) < 3 && Math.abs(Number(box[2]) - 842) < 3, `PDF page is A3 landscape (${box ? `${box[1]}×${box[2]}pt` : 'no MediaBox'})`)
ok(!errors.length, `no page errors ${errors.join(' | ').slice(0, 200)}`)

await browser.close()
console.log(failures ? `\n✗ print-e2e: ${failures} problem(s)` : '\n✓ print-e2e: print preview matches the export')
process.exit(failures ? 1 : 0)
