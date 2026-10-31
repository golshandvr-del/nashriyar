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
// phase 14 events calendar: kind/time/location + validation
const ev = await call(of, 'POST', '/api/admin/deadlines', { title: 'کارگاه آزمایشی', due_at: '2027-01-02', kind: 'workshop', start_time: '14:00', location: 'سالن ۱' })
const evs = await call(of, 'GET', '/api/admin/deadlines')
const evRow = evs.deadlines.find((x) => x.id === ev.id)
ok(evRow?.kind === 'workshop' && evRow?.start_time === '14:00' && evRow?.location === 'سالن ۱', 'event kind/time/location stored')
await call(of, 'POST', '/api/admin/deadlines', { title: 'x', due_at: '2027-01-02', kind: 'meeting', start_time: '99:00' }, 400)
await call(of, 'POST', '/api/admin/deadlines', { title: 'x', due_at: '1405/10/12' }, 400)
await call(of, 'DELETE', `/api/admin/deadlines/${ev.id}`)

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

// ───── phase 14: publications festival (call → entries → judging → results) ─────
{
  const tmc = await login('pub1-director', 'team1234')
  const tmMe = await call(tmc, 'GET', '/api/auth/me')
  const pubId = tmMe.publications[0].publication_id
  const ofMe = await call(of, 'GET', '/api/auth/me')
  await call(tmc, 'POST', '/api/festivals', { title: 'x' }, 403)
  await call(of, 'POST', '/api/festivals', { title: 'x', criteria: [{ label: 'a', max: 0 }] }, 400)
  const fe = await call(of, 'POST', '/api/festivals', { title: 'جشنوارهٔ آزمایشی', submit_until: '2099-12-30', criteria: [{ key: 'content', label: 'محتوا', max: 10 }, { key: 'design', label: 'طراحی', max: 5 }] })
  const tv0 = await call(tmc, 'GET', `/api/festivals/team/${pubId}`)
  ok(!tv0.festivals.some((x) => x.id === fe.id), 'draft festival hidden from teams')
  await call(of, 'PATCH', `/api/festivals/${fe.id}`, { status: 'judging' }, 400) // must go in order
  await call(of, 'PATCH', `/api/festivals/${fe.id}`, { status: 'open' })
  const tv = await call(tmc, 'GET', `/api/festivals/team/${pubId}`)
  ok(tv.festivals.find((x) => x.id === fe.id)?.accepting === true, 'open festival accepts entries')
  ok(tv.issues.length > 0, 'team sees its published issues')
  const en = await call(tmc, 'POST', `/api/festivals/${fe.id}/entries`, { publication_id: pubId, issue_id: tv.issues[0].id, note: 'اثر آزمایشی' })
  await call(tmc, 'POST', `/api/festivals/${fe.id}/entries`, { publication_id: pubId, issue_id: tv.issues[0].id }, 400) // duplicate
  await call(of, 'PATCH', `/api/festivals/${fe.id}`, { status: 'judging' }, 400) // no judges yet
  await call(of, 'PUT', `/api/festivals/${fe.id}/judges`, { user_ids: [ofMe.user.id] })
  await call(of, 'PATCH', `/api/festivals/${fe.id}`, { status: 'judging' })
  await call(tmc, 'DELETE', `/api/festivals/${fe.id}/entries/${en.id}`, undefined, 400) // locked after the call closes
  await call(tmc, 'PUT', `/api/festivals/${fe.id}/entries/${en.id}/score`, { scores: { content: 5, design: 5 } }, 403) // not a judge
  await call(of, 'PUT', `/api/festivals/${fe.id}/entries/${en.id}/score`, { scores: { content: 11, design: 5 } }, 400) // over max
  const sc = await call(of, 'PUT', `/api/festivals/${fe.id}/entries/${en.id}/score`, { scores: { content: 8.5, design: 4 }, comment: 'خوب' })
  ok(sc.total === 12.5, 'judge total computed from criteria')
  const mine = await call(of, 'GET', '/api/festivals/judging/mine')
  ok(mine.festivals.find((x) => x.id === fe.id)?.entries[0]?.total === 12.5, 'judge sees own score')
  const pubBefore = await call(client(), 'GET', '/api/festivals/public/results')
  ok(!pubBefore.festivals.some((x) => x.id === fe.id), 'results hidden before announcement')
  await call(of, 'PATCH', `/api/festivals/${fe.id}`, { status: 'announced' })
  await call(of, 'PATCH', `/api/festivals/${fe.id}`, { status: 'open' }, 400) // no going back
  const pubAfter = await call(client(), 'GET', '/api/festivals/public/results')
  ok(pubAfter.festivals.find((x) => x.id === fe.id)?.results[0]?.rank === 1, 'announced results are public and ranked')
  const det = await call(of, 'GET', `/api/festivals/${fe.id}`)
  ok(det.entries[0]?.avg_total === 12.5 && det.judges[0]?.scored === 1, 'admin detail shows ranking and judge progress')
  await call(of, 'DELETE', `/api/festivals/${fe.id}`, undefined, 400) // only drafts can be deleted
}

// ───── phase 15: full profile + team membership requests (two-path sign-up → queue → approve/reject) ─────
{
  const opt = await call(client(), 'GET', '/api/membership/options')
  ok(opt.publications.length > 0 && Array.isArray(opt.roles), 'membership options list publications and roles')
  const tmc = await login('pub1-director', 'team1234')
  const tmMe = await call(tmc, 'GET', '/api/auth/me')
  const pubId = tmMe.publications[0].publication_id
  const other = opt.publications.find((p) => p.id !== pubId).id
  const sn = String(Date.now()).slice(-9)
  const nu = client()
  const reg = await call(nu, 'POST', '/api/auth/register', { student_number: sn, password: 'abcd12345', display_name: 'عضو آزمایشی', accept_terms: true, join: { publication_id: pubId, role_name: opt.roles[0]?.name, message: 'سلام' } })
  ok(!!reg.request && reg.home === '/settings?tab=membership', 'sign-up with join files a membership request')
  await call(nu, 'POST', '/api/membership/requests', { publication_id: pubId }, 400) // duplicate pending
  await call(nu, 'POST', '/api/membership/requests', { publication_id: other, role_name: 'نقش ناموجود' }, 400)
  await call(nu, 'GET', `/api/membership/queue?publication_id=${pubId}`, undefined, 403)
  await call(tmc, 'GET', `/api/membership/queue?publication_id=${other}`, undefined, 403)
  const q = await call(tmc, 'GET', `/api/membership/queue?publication_id=${pubId}`)
  const rq = q.requests.find((r) => r.id === reg.request)
  ok(!!rq && rq.student_number === sn, 'director sees the request with the student number')
  const ap = await call(tmc, 'POST', `/api/membership/requests/${reg.request}/decide`, { decision: 'approve' })
  ok(!!ap.team_member_id, 'approval links a team member record')
  await call(tmc, 'POST', `/api/membership/requests/${reg.request}/decide`, { decision: 'reject' }, 400)
  await call(nu, 'POST', '/api/membership/requests', { publication_id: pubId }, 400) // already a member
  const r2 = await call(nu, 'POST', '/api/membership/requests', { publication_id: other })
  await call(of, 'POST', `/api/membership/requests/${r2.id}/decide`, { decision: 'reject', note: 'آزمون' })
  const mine = await call(nu, 'GET', '/api/membership/mine')
  ok(mine.requests.find((r) => r.id === r2.id)?.status === 'rejected', 'requester sees the rejection')
  // profile: consent gate, validation, the student-number lock, history
  await call(nu, 'POST', '/api/me/profile', { gender: 'male' }, 400)
  await call(nu, 'POST', '/api/me/profile', { phone: '123' , consent: true }, 400)
  await call(nu, 'POST', '/api/me/profile', { student_number: '11111111' }, 400)
  const cats = await call(client(), 'GET', '/api/public/categories')
  await call(nu, 'POST', '/api/me/profile', { faculty_id: cats.faculties[0].id, degree: 'bachelor', entry_year: 1402, gender: 'male', phone: '09121234567', consent: true })
  const pr = await call(nu, 'GET', '/api/me/profile')
  ok(pr.complete === true && pr.user.phone === '09121234567', 'profile complete after required fields + consent')
  ok(pr.memberships.some((m) => m.publication_id === pubId && m.is_active), 'collaboration history shows the approved team')
  await call(nu, 'POST', '/api/me/profile/consent', { consent: false })
  const pr2 = await call(nu, 'GET', '/api/me/profile')
  ok(pr2.user.phone === null && pr2.user.gender === null, 'withdrawing consent erases sensitive fields')
}

// ───── audit trail ─────
const audit = await call(of, 'GET', '/api/admin/audit')
for (const a of ['publication.create', 'user.create', 'post.visibility', 'shelf.save', 'settings.update', 'category.merge']) ok(audit.items.some((x) => x.action === a), `audit has ${a}`)
const filtered = await call(of, 'GET', '/api/admin/audit?action=user')
ok(filtered.items.length && filtered.items.every((x) => x.action.startsWith('user')), 'audit prefix filter works')

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL ADMIN WRITE CHECKS PASSED')
process.exit(failures ? 1 : 0)
