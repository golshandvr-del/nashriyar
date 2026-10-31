// Admin write-path test: exercises every POST/PUT/DELETE the admin panel uses, end to end.
// Usage: BASE=http://localhost:3000 node tests/admin-writes.mjs   (server running with freshly seeded demo data)
const BASE = process.env.BASE || 'http://localhost:3000'
let failures = 0
const ok = (cond, msg) => {
  if (!cond) {
    failures++
    console.log('FAIL', msg)
  }
}

function client() {
  let cookie = ''
  return async function call(path, opts = {}) {
    const headers = { Origin: BASE, ...(opts.json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }
    const res = await fetch(BASE + path, { method: opts.method || (opts.json !== undefined ? 'POST' : 'GET'), headers, body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined, redirect: 'manual' })
    const sc = res.headers.get('set-cookie')
    if (sc && sc.includes('nsh_sid=')) cookie = sc.split(';')[0]
    const ct = res.headers.get('content-type') || ''
    const data = ct.includes('json') ? await res.json().catch(() => null) : await res.text()
    return { status: res.status, data }
  }
}

async function login(username, password) {
  const c = client()
  const r = await c('/api/auth/login', { json: { username, password } })
  ok(r.status === 200, `login ${username} -> ${r.status}`)
  return c
}

/** Calls and asserts status; returns data. */
async function call(c, method, path, json, status = 200) {
  const r = await c(path, { method, json })
  ok(r.status === status, `${method} ${path} -> ${r.status} (expected ${status}) ${JSON.stringify(r.data).slice(0, 220)}`)
  return r.data || {}
}

const of = await login('officer', 'officer1234')
const sa = await login('admin', 'admin1234')
const sup = await login('supervisor', 'super1234')
const an = await login('analyst', 'analyst1234')
const stamp = Date.now().toString(36)

// ───── structure ─────
const fac = await call(of, 'POST', '/api/admin/faculties', { name: 'دانشکدهٔ آزمایشی ' + stamp })
ok(fac.id, 'faculty id returned')
const major = await call(of, 'POST', '/api/admin/majors', { name: 'رشتهٔ آزمایشی', faculty_id: fac.id })
await call(of, 'DELETE', `/api/admin/majors/${major.id}`)
const assoc = await call(of, 'POST', '/api/admin/associations', { name: 'انجمن آزمایشی ' + stamp, kind: 'cultural_club', faculty_id: fac.id })
const structure = await call(of, 'GET', '/api/admin/structure')
ok(structure.faculties.some((f) => f.id === fac.id), 'new faculty listed')
ok(structure.associations.some((a) => a.id === assoc.id), 'new association listed')
await call(an, 'POST', '/api/admin/faculties', { name: 'نباید ساخته شود' }, 403)

// ───── categories ─────
const c1 = await call(of, 'POST', '/api/admin/categories', { name: 'دستهٔ الف ' + stamp, type: 'subject' })
const c2 = await call(of, 'POST', '/api/admin/categories', { name: 'دستهٔ ب ' + stamp, type: 'subject', parent_id: c1.id })
await call(of, 'POST', '/api/admin/categories', { id: c2.id, name: 'دستهٔ ب (ویرایش)', type: 'subject', parent_id: c2.id }, 400)
await call(of, 'POST', '/api/admin/categories/order', { order: [{ id: c2.id, parent_id: null }, { id: c1.id, parent_id: null }] })
await call(of, 'POST', '/api/admin/categories/merge', { from: c2.id, into: c1.id })
const cats = await call(of, 'GET', '/api/admin/categories')
ok(cats.categories.find((x) => x.id === c2.id)?.is_active === 0, 'merged category deactivated')

// ───── publication lifecycle ─────
const pub = await call(of, 'POST', '/api/admin/publications', {
  title: 'نشریهٔ آزمایشی ' + stamp,
  association_id: assoc.id,
  frequency: 'monthly',
  category_ids: [c1.id],
  accounts: {
    managing_director: { display_name: 'مدیر آزمایشی' },
    editor_in_chief: { display_name: 'سردبیر آزمایشی' },
    license_holder: { display_name: 'صاحب امتیاز آزمایشی' }
  }
})
ok(pub.id && pub.credentials?.length === 3, 'publication created with 3 credentials')
ok(pub.credentials?.every((x) => x.password && x.username), 'credentials have username + temp password')
// the new director can log in with the temp password and must change it
if (pub.credentials?.[0]) {
  const dir = client()
  const r = await dir('/api/auth/login', { json: { username: pub.credentials[0].username, password: pub.credentials[0].password } })
  ok(r.status === 200, 'new director can log in with temp password')
  const me = await dir('/api/auth/me')
  ok(me.data?.user?.must_change_password === 1 || me.data?.user?.must_change_password === true, 'temp password forces change')
}
await call(of, 'PUT', `/api/admin/publications/${pub.id}`, { tagline: 'شعار تازه', license_number: 'LIC-' + stamp })
const dossier = await call(of, 'GET', `/api/admin/publications/${pub.id}`)
ok(JSON.stringify(dossier).includes('LIC-' + stamp), 'publication update persisted')
const replaced = await call(of, 'POST', `/api/admin/publications/${pub.id}/roles`, { role: 'editor_in_chief', display_name: 'سردبیر جدید', username: 'ed-' + stamp })
ok(replaced.credentials?.password, 'role replacement issues credentials')
await call(of, 'POST', `/api/admin/publications/${pub.id}/status`, { status: 'suspended', reason: 'آزمون' })
await call(of, 'POST', `/api/admin/publications/${pub.id}/status`, { status: 'active' })
await call(sup, 'POST', `/api/admin/publications/${pub.id}/status`, { status: 'archived' }, 403)

// ───── users ─────
const staff = await call(of, 'POST', '/api/admin/users', { display_name: 'تحلیلگر آزمایشی', username: 'an-' + stamp, system_role: 'analyst' })
ok(staff.credentials?.password, 'staff user temp password')
await call(of, 'POST', '/api/admin/users', { display_name: 'مسئول دوم', username: 'po-' + stamp, system_role: 'pub_officer' }, 400) // officer cannot mint officers
await call(sa, 'POST', '/api/admin/users', { display_name: 'مسئول دوم', username: 'po-' + stamp, system_role: 'pub_officer' })
await call(of, 'POST', '/api/admin/users', { display_name: 'ناظر بی‌دانشکده', username: 'sv-' + stamp, system_role: 'faculty_supervisor' }, 400)
const reset = await call(of, 'POST', `/api/admin/users/${staff.id}/reset-password`)
ok(reset.credentials?.password && reset.credentials.password !== staff.credentials?.password, 'reset password issues a new temp password')
await call(of, 'POST', `/api/admin/users/${staff.id}/status`, { status: 'suspended' })
const suspended = client()
const sr = await suspended('/api/auth/login', { json: { username: 'an-' + stamp, password: reset.credentials?.password } })
ok(sr.status !== 200, 'suspended user cannot log in')
await call(of, 'POST', `/api/admin/users/${staff.id}/status`, { status: 'active' })
const users = await call(of, 'GET', '/api/admin/users?role=analyst')
ok(users.users.every((u) => u.system_role === 'analyst'), 'users role filter works')

// ───── moderation ─────
const posts = await call(of, 'GET', '/api/admin/posts')
const post = posts.posts?.[0]
if (post) {
  await call(of, 'POST', `/api/admin/posts/${post.id}/visibility`, { hidden: true, reason: 'آزمون' })
  const hidden = await call(of, 'GET', '/api/admin/posts?status=hidden_by_admin')
  ok(hidden.posts.some((p) => p.id === post.id), 'post hidden')
  const pub404 = await client()(`/api/public/posts/${post.id}`)
  ok(pub404.status !== 200 || pub404.data?.post?.status !== 'published', 'hidden post not served as published')
  await call(of, 'POST', `/api/admin/posts/${post.id}/visibility`, { hidden: false })
}
const comments = await call(of, 'GET', '/api/admin/comments?status=approved')
if (comments.comments?.[0]) {
  const cid = comments.comments[0].id
  await call(of, 'POST', `/api/admin/comments/${cid}`, { action: 'spam' })
  await call(of, 'POST', `/api/admin/comments/${cid}`, { action: 'approve' })
}
await call(of, 'POST', '/api/admin/comments/x', { action: 'nuke' }, 400)

// ───── storefront ─────
const shelves = await call(of, 'GET', '/api/admin/shelves')
const issueIds = (shelves.issues || []).slice(0, 3).map((i) => i.id)
await call(of, 'POST', '/api/admin/shelves', { title: 'قفسهٔ آزمایشی ' + stamp, issue_ids: issueIds, sort_order: 9 })
const after = await call(of, 'GET', '/api/admin/shelves')
const shelf = after.shelves.find((s) => s.title === 'قفسهٔ آزمایشی ' + stamp)
ok(shelf && shelf.issue_ids.length === issueIds.length, 'shelf saved with issues')
if (shelf) {
  await call(of, 'POST', '/api/admin/shelves', { id: shelf.id, title: shelf.title, issue_ids: shelf.issue_ids, sort_order: 9, is_active: false })
  await call(of, 'DELETE', `/api/admin/shelves/${shelf.id}`)
}
const prevBanners = shelves.banners || []
await call(of, 'POST', '/api/admin/banners', { banners: [{ title: 'بنر آزمایشی', subtitle: 'زیرعنوان', link: '/explore', color: 'red' }] })
const bn = await call(of, 'GET', '/api/admin/shelves')
ok(bn.banners?.[0]?.color === '#4f46e5', 'invalid banner color is sanitized')
await call(of, 'POST', '/api/admin/banners', { banners: prevBanners })

// ───── announcements & deadlines ─────
await call(of, 'POST', '/api/admin/announcements', { title: 'بی‌مقصد', body: 'متن', audience: 'faculty' }, 400)
const ann = await call(of, 'POST', '/api/admin/announcements', { title: 'اطلاعیهٔ آزمایشی ' + stamp, body: 'متن اطلاعیه', audience: 'publication', target_id: pub.id, pinned: true })
ok(ann.id, 'announcement created')
await call(of, 'DELETE', `/api/admin/announcements/${ann.id}`)
const dl = await call(of, 'POST', '/api/admin/deadlines', { title: 'مهلت آزمایشی', due_at: '2027-01-01', description: 'توضیح' })
await call(of, 'DELETE', `/api/admin/deadlines/${dl.id}`)

// ───── settings ─────
const s0 = await call(of, 'GET', '/api/admin/settings')
ok(!('ai_api_key' in s0.settings), 'officer never sees AI settings')
await call(of, 'POST', '/api/admin/settings', { site_name: 'نشریار آزمایشی', ai_enabled: true })
const s1 = await call(sa, 'GET', '/api/admin/settings')
ok(s1.settings.site_name === 'نشریار آزمایشی', 'officer setting persisted')
// Technical settings live only in the developer console (phase 13): /api/admin/settings ignores them for every role.
ok(!('ai_enabled' in s1.settings) && !('feature_flags' in s1.settings), 'super admin settings carry no technical keys')
await call(sa, 'POST', '/api/admin/settings', { ai_api_key: 'sk-test-1234567890abcd', max_sessions: 1 })
const s2 = await call(sa, 'GET', '/api/admin/settings')
ok(!('ai_api_key' in s2.settings) && !('max_sessions' in s2.settings), 'technical keys posted to admin settings are ignored')
await call(sa, 'POST', '/api/admin/settings', { site_name: s0.settings.site_name })

// ───── audit trail ─────
const audit = await call(of, 'GET', '/api/admin/audit')
for (const a of ['publication.create', 'user.create', 'post.visibility', 'shelf.save', 'settings.update', 'category.merge']) ok(audit.items.some((x) => x.action === a), `audit has ${a}`)
const filtered = await call(of, 'GET', '/api/admin/audit?action=user')
ok(filtered.items.length && filtered.items.every((x) => x.action.startsWith('user')), 'audit prefix filter works')

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL ADMIN WRITE CHECKS PASSED')
process.exit(failures ? 1 : 0)
