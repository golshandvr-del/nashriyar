// Phase 19 E2E (ROADMAP "future" features) against a seeded server.
// Sections are added as features land; each is self-contained.
// Usage: BASE=http://localhost:3000 node tests/future-e2e.mjs   (server-dist built, same DATA_DIR as the server)
import { spawnSync } from 'node:child_process'
import { createHmac } from 'node:crypto'

const BASE = process.env.BASE || 'http://localhost:3000'
let failures = 0
let passed = 0
const ok = (cond, msg) => {
  if (cond) passed++
  else {
    failures++
    console.log('FAIL', msg)
  }
}

function client() {
  let cookie = ''
  return async function call(path, opts = {}) {
    const headers = {
      Origin: BASE,
      ...(opts.json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(opts.headers || {})
    }
    const res = await fetch(BASE + path, {
      method: opts.method || (opts.json !== undefined ? 'POST' : 'GET'),
      headers,
      body: opts.json !== undefined ? JSON.stringify(opts.json) : opts.body,
      redirect: 'manual'
    })
    const sc = res.headers.get('set-cookie')
    if (sc && sc.includes('nsh_sid=')) cookie = sc.split(';')[0]
    const ct = res.headers.get('content-type') || ''
    const buf = new Uint8Array(await res.arrayBuffer())
    const text = new TextDecoder().decode(buf)
    let json = null
    if (ct.includes('json')) {
      try {
        json = JSON.parse(text)
      } catch {}
    }
    return { status: res.status, ct, buf, text, json, headers: res.headers }
  }
}

async function login(username, password) {
  const c = client()
  const r = await c('/api/auth/login', { json: { username, password } })
  ok(r.status === 200, `login ${username} -> ${r.status}`)
  return c
}

function totp(secret, offset = 0) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = 0
  let val = 0
  const out = []
  for (const ch of secret.toUpperCase().replace(/[^A-Z2-7]/g, '')) {
    val = (val << 5) | A.indexOf(ch)
    bits += 5
    if (bits >= 8) {
      out.push((val >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offset))
  const h = createHmac('sha1', Buffer.from(out)).update(msg).digest()
  const o = h[h.length - 1] & 15
  return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, '0')
}

/** A developer created from the CLI (same DATA_DIR as the server), with 2FA enabled and sudo mode on. */
async function developer() {
  const username = 'dev-future-' + Date.now().toString(36)
  const r = spawnSync(process.execPath, ['server-dist/node.mjs', '--create-developer', username], { env: process.env, encoding: 'utf8' })
  const pw = /password: (\S+)/.exec(r.stdout || '')?.[1]
  if (!pw) throw new Error('create-developer failed: ' + (r.stderr || r.stdout))
  const dv = client()
  ok((await dv('/api/auth/login', { json: { username, password: pw } })).status === 200, 'developer login')
  const next = pw + '-New9'
  ok((await dv('/api/auth/change-password', { json: { current: pw, next } })).status === 200, 'developer change password')
  const setup = await dv('/api/auth/totp/setup', { json: {} })
  const secret = setup.json?.secret || ''
  ok((await dv('/api/auth/totp/enable', { json: { code: totp(secret) } })).status === 200, 'developer totp enable')
  const el = await dv('/api/system/elevate', { json: { password: next, totp: totp(secret, 1) } })
  ok(el.status === 200, `developer sudo -> ${el.status}`)
  return dv
}

const anon = client()
const officer = await login('officer', 'officer1234')
const student = await login('40012345', 'student1234')
const dev = await developer()

// ───────── 1. read-only public API (/api/open) ─────────
{
  ok((await anon('/api/open/publications')).status === 401, 'open: no key -> 401')
  ok((await anon('/api/open/publications', { headers: { 'X-API-Key': 'nsk_' + 'x'.repeat(32) } })).status === 401, 'open: unknown key -> 401')
  ok((await officer('/api/system/api-keys')).status === 403, 'open: officer cannot manage API keys')
  ok((await officer('/api/system/api-keys', { json: { name: 'x' } })).status === 403, 'open: officer cannot create API keys')
  ok((await student('/api/system/api-keys')).status === 403, 'open: student cannot manage API keys')

  const created = await dev('/api/system/api-keys', { json: { name: 'سامانهٔ آموزش', rate_per_min: 30 } })
  ok(created.status === 200 && /^nsk_[A-Za-z0-9]{32}$/.test(created.json?.key || ''), `open: developer creates a key -> ${created.status} ${created.text.slice(0, 120)}`)
  const key = created.json?.key || ''
  const list = await dev('/api/system/api-keys')
  const row = (list.json?.keys || []).find((k) => k.id === created.json?.id)
  ok(!!row && row.prefix === key.slice(0, 8) && !('key_hash' in row) && !JSON.stringify(list.json).includes(key), 'open: list shows the prefix only, never the key or its hash')

  const K = { headers: { 'X-API-Key': key } }
  const pubs = await anon('/api/open/publications?limit=5', K)
  ok(pubs.status === 200 && pubs.json?.publications?.length === 5 && !!pubs.json?.next_cursor, `open: publications page -> ${pubs.status}`)
  ok(pubs.headers.get('access-control-allow-origin') === '*', 'open: CORS header on responses')
  ok(pubs.headers.get('x-ratelimit-limit') === '30', `open: X-RateLimit-Limit = ${pubs.headers.get('x-ratelimit-limit')}`)
  const p2 = await anon(`/api/open/publications?limit=5&cursor=${pubs.json?.next_cursor}`, K)
  ok(p2.status === 200 && p2.json.publications.every((p) => !pubs.json.publications.some((q) => q.id === p.id)), 'open: next page has different rows')

  const all = []
  let cursor = ''
  for (let i = 0; i < 20; i++) {
    const r = await anon(`/api/open/publications?limit=200${cursor ? `&cursor=${cursor}` : ''}`, K)
    all.push(...(r.json?.publications || []))
    if (!r.json?.next_cursor) break
    cursor = r.json.next_cursor
  }
  const site = (await anon('/api/public/publications')).json?.publications || []
  ok(all.length > 0 && all.length === site.length, `open: every active publication (${all.length} = storefront ${site.length})`)
  ok(!/follower|view_count|"views"|phone|student_number|email|password/i.test(JSON.stringify(pubs.json)), 'open: no follower/view counts or personal data')

  const one = await anon(`/api/open/publications/${all[0]?.slug}`, K)
  ok(one.status === 200 && one.json?.publication?.slug === all[0]?.slug && Array.isArray(one.json?.issues), 'open: publication detail')

  const iss = await anon('/api/open/issues?limit=3', K)
  ok(iss.status === 200 && iss.json?.issues?.length === 3, `open: issues list -> ${iss.status}`)
  const dates = (iss.json?.issues || []).map((i) => i.published_at)
  ok(dates.every((d, i) => i === 0 || dates[i - 1] >= d), 'open: issues newest first')
  const id = iss.json?.issues?.[0]?.id
  const det = await anon(`/api/v1/open/issues/${id}`, K)
  ok(det.status === 200 && Array.isArray(det.json?.toc) && /\/issue\//.test(det.json?.issue?.url || ''), `open: issue detail with TOC (+ /api/v1 alias) -> ${det.status}`)
  ok(!/main_pdf|storage_key|\/page\/\d|cover_key|image_key/.test(det.text), 'open: no file keys / page URLs (paid content never exposed)')
  ok((await anon('/api/open/issues/nope', K)).status === 404, 'open: unknown issue -> 404')
  ok((await anon('/api/open/faculties', K)).json?.faculties?.length > 0, 'open: faculties')
  ok((await anon('/api/open/categories', K)).json?.categories?.length > 0, 'open: categories')

  const spec = await anon('/api/open/openapi.json')
  ok(spec.status === 200 && String(spec.json?.openapi || '').startsWith('3.') && !!spec.json?.paths?.['/issues'], 'open: openapi.json without a key')
  const post = await anon('/api/open/issues', { method: 'POST', body: '{}', headers: { ...K.headers, 'Content-Type': 'application/json' } })
  ok(post.status === 405, `open: POST -> 405 (read-only), got ${post.status}`)
  const pre = await anon('/api/open/issues', {
    method: 'OPTIONS',
    headers: { Origin: 'https://edu.example.ac.ir', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'x-api-key' }
  })
  ok(pre.status === 204 && /x-api-key/i.test(pre.headers.get('access-control-allow-headers') || ''), `open: CORS preflight -> ${pre.status}`)

  // per-key rate limit: a 2-per-minute key is throttled on the 3rd call
  const slow = (await dev('/api/system/api-keys', { json: { name: 'آزمون نرخ', rate_per_min: 2 } })).json?.key
  const codes = []
  for (let i = 0; i < 3; i++) codes.push((await anon('/api/open/faculties', { headers: { 'X-API-Key': slow } })).status)
  ok(codes.join(',') === '200,200,429', `open: per-key rate limit ${codes}`)

  // revocation is immediate and audited
  ok((await dev(`/api/system/api-keys/${created.json?.id}/revoke`, { json: {} })).status === 200, 'open: revoke')
  ok((await anon('/api/open/faculties', K)).status === 401, 'open: revoked key -> 401')
  const used = (await dev('/api/system/api-keys')).json?.keys?.find((k) => k.id === created.json?.id)
  ok(!!used?.revoked_at && used.use_count >= 8 && !!used.last_used_at, `open: usage counted (${used?.use_count}) and revocation recorded`)
  const acts = ((await dev('/api/system/audit')).json?.items || []).map((a) => a.action)
  ok(acts.includes('system.api_key_create') && acts.includes('system.api_key_revoke'), 'open: key create / revoke in the technical audit log')
}

// ───────── 2. article index with persistent ids (/api/articles, /a/:pid, OAI-PMH) ─────────
{
  const team = await login('pub1-director', 'team1234')
  const me = (await team('/api/auth/me')).json
  const pubId = me?.publications?.[0]?.publication_id
  const issues = (await team(`/api/team/${pubId}/issues?limit=200`)).json?.issues || []
  const pubd = issues.find((i) => i.status === 'published')
  ok(!!pubd, 'articles: team has a published issue')
  const base = `/api/team/${pubId}/issues/${pubd?.id}`
  const list = await team(`${base}/articles`)
  const arts = list.json?.articles || []
  ok(list.status === 200 && arts.length > 0 && arts.every((a) => /^NSH-\d{4}-[0-9A-HJKMNP-TV-Z]{8}$/.test(a.pid)), `articles: every section of a published issue has a PID (${arts.length})`)
  const pid = arts[0]?.pid
  ok((await student(`${base}/articles`)).status === 403, 'articles: student cannot list team article metadata')
  ok((await student(`${base}/articles/${pid}`, { method: 'PUT', json: { abstract: 'x' } })).status === 403, 'articles: student cannot edit')

  // public TOC carries the pid
  const pubIssue = await anon(`/api/public/issues/${pubd?.id}`)
  ok((pubIssue.json?.toc || []).some((t) => t.pid === pid), 'articles: public issue TOC carries the pid')

  // team edits metadata; DOI is validated and unique; the PID can never change
  const doi = `10.5555/nsh.${Date.now()}`
  const put = await team(`${base}/articles/${pid}`, { method: 'PUT', json: { abstract: 'چکیدهٔ آزمایشی دربارهٔ نشریات دانشجویی', keywords: 'نشریه، دانشجو، آزمون', lang: 'fa', doi: `https://doi.org/${doi}`, pid: 'NSH-1400-AAAAAAAA' } })
  ok(put.status === 200, `articles: team updates metadata -> ${put.status} ${put.text.slice(0, 120)}`)
  const bad = await team(`${base}/articles/${pid}`, { method: 'PUT', json: { doi: 'not-a-doi' } })
  ok(bad.status === 400, `articles: invalid DOI -> ${bad.status}`)
  if (arts[1]) ok((await team(`${base}/articles/${arts[1].pid}`, { method: 'PUT', json: { doi } })).status === 400, 'articles: duplicate DOI rejected')
  const after = ((await team(`${base}/articles`)).json?.articles || []).find((a) => a.pid === pid)
  ok(after?.doi === doi && after?.keywords === 'نشریه،دانشجو،آزمون' && /چکیده/.test(after?.abstract || ''), `articles: metadata saved (doi normalised) ${JSON.stringify(after).slice(0, 160)}`)
  ok(((await team(`${base}/articles`)).json?.articles || []).length === arts.length && !(await team(`${base}/articles`)).text.includes('NSH-1400-AAAAAAAA'), 'articles: PID is immutable')

  // public JSON + citations
  const j = await anon(`/api/articles/${pid}`)
  ok(j.status === 200 && j.json?.article?.pid === pid && j.json.article.doi === doi && j.json.article.url.endsWith(`/a/${pid}`) && !!j.json.article.citation, `articles: public JSON -> ${j.status}`)
  ok(!/main_pdf|storage_key|cover_key|\/page\/\d|phone|student_number|password/.test(j.text), 'articles: JSON exposes metadata only')
  const bib = await anon(`/api/articles/${pid}/cite.bib`)
  ok(bib.status === 200 && bib.text.startsWith(`@article{${pid},`) && bib.text.includes(doi) && /bibtex/.test(bib.ct), 'articles: BibTeX')
  const ris = await anon(`/api/articles/${pid}/cite.ris`)
  ok(ris.status === 200 && /^TY {2}- /m.test(ris.text) && /^ER {2}- ?/m.test(ris.text) && ris.text.includes(doi), 'articles: RIS')
  ok((await anon('/api/articles/NSH-1400-AAAAAAAA')).status === 404, 'articles: unknown pid -> 404')
  ok((await anon('/api/articles/garbage')).status === 404, 'articles: malformed pid -> 404')

  // landing page: server-rendered with citation_* meta
  const page = await anon(`/a/${pid}`)
  ok(page.status === 200 && /text\/html/.test(page.ct), `articles: /a/:pid -> ${page.status}`)
  ok(page.text.includes('name="citation_title"') && page.text.includes(`content="${doi}"`) && page.text.includes('citation_journal_title') && page.text.includes('rel="canonical"'), 'articles: landing page carries citation_* meta, DOI and canonical')
  ok((await anon('/a/NSH-1400-AAAAAAAA')).status === 404, 'articles: unknown landing page -> 404')
  ok((await anon('/api/public/sitemap.xml')).text.includes(`/a/${pid}</loc>`), 'articles: sitemap lists the landing page')
  ok(/^Allow: \/api\/articles\/$/m.test((await anon('/robots.txt')).text), 'articles: robots.txt allows /api/articles/')

  // OAI-PMH 2.0
  const oai = (q) => anon(`/api/articles/oai?${q}`)
  const idf = await oai('verb=Identify')
  ok(idf.status === 200 && /text\/xml/.test(idf.ct) && idf.text.includes('<protocolVersion>2.0</protocolVersion>'), 'oai: Identify')
  ok((await oai('verb=ListMetadataFormats')).text.includes('<metadataPrefix>oai_dc</metadataPrefix>'), 'oai: ListMetadataFormats')
  ok((await oai('verb=ListSets')).text.includes('<setSpec>pub:'), 'oai: ListSets')
  const lr = await oai('verb=ListRecords&metadataPrefix=oai_dc')
  const tok = /<resumptionToken>([^<]+)</.exec(lr.text)?.[1]
  ok((lr.text.match(/<record>/g) || []).length === 100 && !!tok, 'oai: ListRecords page of 100 with resumptionToken')
  const lr2 = await oai(`verb=ListRecords&resumptionToken=${tok}`)
  const ids1 = lr.text.match(/<identifier>[^<]+/g) || []
  const ids2 = lr2.text.match(/<identifier>[^<]+/g) || []
  ok(ids2.length > 0 && !ids2.some((x) => ids1.includes(x)), 'oai: next page has new records')
  const host = new URL(BASE).hostname
  const gr = await oai(`verb=GetRecord&metadataPrefix=oai_dc&identifier=oai:${host}:${pid}`)
  ok(gr.text.includes(`<dc:identifier>https://doi.org/${doi}</dc:identifier>`) && gr.text.includes('<dc:subject>نشریه</dc:subject>'), 'oai: GetRecord with DOI and keywords')
  ok((await oai('verb=Bad')).text.includes('code="badVerb"'), 'oai: badVerb')
  ok((await oai('verb=ListRecords')).text.includes('code="badArgument"'), 'oai: missing metadataPrefix -> badArgument')
  ok((await oai('verb=ListRecords&metadataPrefix=marc')).text.includes('code="cannotDisseminateFormat"'), 'oai: unknown format')
  ok((await oai('verb=ListRecords&resumptionToken=%%%')).text.includes('code="badResumptionToken"'), 'oai: bad resumption token')
  ok((await oai('verb=ListRecords&metadataPrefix=oai_dc&from=2999-01-01')).text.includes('code="noRecordsMatch"'), 'oai: noRecordsMatch')
  ok((await oai('verb=GetRecord&metadataPrefix=oai_dc&identifier=oai:x:NSH-1400-AAAAAAAA')).text.includes('code="idDoesNotExist"'), 'oai: idDoesNotExist')
}

// ───────── 3. digitised archive of old printed issues (/api/admin/print-archive, /api/public/print-archive) ─────────
{
  const pubs = (await officer('/api/admin/publications')).json?.publications || []
  const pa = pubs.find((p) => p.status === 'active') || pubs[0]
  ok(!!pa, 'archive: officer sees a publication')
  const number = 90000 + Math.floor(Math.random() * 9000)
  const token = `zqarch${Date.now().toString(36)}`
  const reg = {
    publication_id: pa?.id, number, title: 'شمارهٔ چاپی آزمایشی', original_jy: 1378, original_jm: 7,
    summary: 'نسخهٔ اسکن‌شدهٔ قدیمی', keywords: 'آرشیو، چاپی',
    toc: [{ title: 'سرمقالهٔ قدیمی', page_start: 1, page_end: 1 }, { title: 'گفت‌وگوی قدیمی', page_start: 2, page_end: 2 }]
  }
  ok((await student('/api/admin/print-archive', { json: reg })).status === 403, 'archive: student cannot register')
  ok((await officer('/api/admin/print-archive', { json: { ...reg, original_jy: 1490 } })).status === 400, 'archive: future print date rejected')
  ok((await officer('/api/admin/print-archive', { json: { ...reg, original_jm: null, original_jd: 5 } })).status === 400, 'archive: day without month rejected')
  const cr = await officer('/api/admin/print-archive', { json: reg })
  ok(cr.status === 200 && /^1999-09-2\d$/.test(cr.json?.original_date || '') && cr.json?.original_label === 'مهر ۱۳۷۸', `archive: registered -> ${cr.status} ${cr.text.slice(0, 160)}`)
  const id = cr.json?.id
  ok((await officer('/api/admin/print-archive', { json: reg })).status === 400, 'archive: duplicate number rejected')
  const list = (await officer('/api/admin/print-archive')).json?.issues || []
  ok(list.some((r) => r.id === id && r.status === 'planning' && r.pages_uploaded === 0), 'archive: listed as waiting for scan')
  ok((await officer(`/api/admin/print-archive/${id}/publish`, { json: {} })).status === 400, 'archive: cannot publish before the scan is uploaded')
  ok((await officer(`/api/team/${pa?.id}/issues/${id}/request-approval`, { json: {} })).status === 400, 'archive: team approval flow refused for archival issues')
  // scanned pages (tiny PNG) with a text layer
  const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), (ch) => ch.charCodeAt(0))
  for (const n of [1, 2]) {
    const fd = new FormData()
    fd.set('file', new Blob([png], { type: 'image/png' }), `p${n}.png`)
    fd.set('page_number', String(n))
    fd.set('text', n === 2 ? `متن صفحهٔ دوم ${token} پایان` : 'متن صفحهٔ اول')
    const up = await officer(`/api/media/pages/${id}`, { method: 'POST', body: fd })
    ok(up.status === 200, `archive: page ${n} uploaded -> ${up.status} ${up.text.slice(0, 120)}`)
  }
  ok((await student(`/api/admin/print-archive/${id}/publish`, { json: {} })).status === 403, 'archive: student cannot publish')
  const pub = await officer(`/api/admin/print-archive/${id}/publish`, { json: { pricing: 'free' } })
  ok(pub.status === 200 && pub.json?.published_at?.startsWith(cr.json?.original_date) && pub.json?.pages === 2 && pub.json?.articles_indexed === 2, `archive: published with the ORIGINAL date -> ${pub.text.slice(0, 160)}`)
  ok((await officer(`/api/admin/print-archive/${id}/publish`, { json: {} })).status === 400, 'archive: double publish rejected')
  // public surfaces
  const pi = (await anon(`/api/public/issues/${id}`)).json?.issue
  ok(pi?.archival === 1 && pi?.original_label === 'مهر ۱۳۷۸' && !!pi?.cover_key, 'archive: public issue carries archival flag, label and a cover from page 1')
  const arc = (q) => anon(`/api/public/print-archive?${q}`)
  const all = await arc('')
  ok(all.status === 200 && all.json.issues.some((i) => i.id === id) && all.json.publications.length > 0 && !!all.json.span.from, 'archive: public list')
  ok((await arc(`q=${token}`)).json.issues.map((i) => i.id).join() === id, 'archive: full-text search hits the scanned text layer')
  ok((await arc('q=' + encodeURIComponent('گفت‌وگوی قدیمی'))).json.issues.some((i) => i.id === id), 'archive: search by TOC title')
  ok((await arc('from=1378&to=1378')).json.issues.some((i) => i.id === id), 'archive: year range includes the original year')
  ok(!(await arc('from=1379')).json.issues.some((i) => i.id === id), 'archive: year range excludes later years')
  ok(!(await arc(`publication=nope-${token}`)).json.issues.length, 'archive: publication filter')
  ok(!(await anon('/api/public/home')).text.includes(id), 'archive: does not flood the "latest" shelves')
  const arts = (await officer(`/api/team/${pa?.id}/issues/${id}/articles`)).json?.articles || []
  ok(arts.length === 2 && arts.every((a) => /^NSH-1999-/.test(a.pid) || /^NSH-13\d\d-/.test(a.pid)), `archive: TOC items got persistent ids (${arts.map((a) => a.pid).join(',')})`)
  const spa = await anon('/archive')
  ok(spa.status === 200 && /text\/html/.test(spa.ct), 'archive: /archive SPA route')
}

console.log(failures ? `future-e2e: ${failures} failed, ${passed} passed` : `future-e2e: ${passed} checks passed`)
process.exit(failures ? 1 : 0)
