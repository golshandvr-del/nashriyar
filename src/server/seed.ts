// Demo data loader (Phase 0/12). Deterministic (seeded PRNG) so screenshots and tests are reproducible.
// Generates SVG covers / pages / post images directly into Storage — no external assets needed.
import type { Deps } from './context'
import { hashPassword, newId, normalizePurchaseCode, randomId, sha256 } from './lib/crypto'
import { normalizeFa } from '../shared/fa'

type Stmt = { sql: string; params?: unknown[] }

// ───────── deterministic randomness ─────────
let _s = 20261029
const rnd = () => {
  _s = (_s * 1664525 + 1013904223) % 4294967296
  return _s / 4294967296
}
const ri = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1))
const pick = <T>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)]
const shuffle = <T>(arr: T[]): T[] => arr.map((v) => [rnd(), v] as const).sort((a, b) => a[0] - b[0]).map((x) => x[1])
const DAY = 86400_000
const iso = (t: number) => new Date(t).toISOString()
const dayOf = (t: number) => iso(t).slice(0, 10)
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// ───────── SVG artwork ─────────
const FONT = "Vazirmatn, Tahoma, 'Segoe UI', sans-serif"

function coverSvg(title: string, pubTitle: string, number: number, color: string, seed: number): string {
  const shapes: string[] = []
  for (let k = 0; k < 7; k++) {
    const x = (seed * (k + 3) * 37) % 600
    const y = 120 + ((seed * (k + 5) * 53) % 520)
    const r = 30 + ((seed * (k + 1)) % 140)
    shapes.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" opacity="${(0.05 + (k % 4) * 0.04).toFixed(2)}"/>`)
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 850" width="600" height="850">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="#111827"/></linearGradient></defs>
<rect width="600" height="850" fill="url(#g)"/>${shapes.join('')}
<rect x="40" y="40" width="520" height="770" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="2"/>
<text x="300" y="130" font-family="${FONT}" font-size="54" font-weight="800" fill="#fff" text-anchor="middle" direction="rtl">${esc(pubTitle)}</text>
<text x="300" y="185" font-family="${FONT}" font-size="22" fill="#fff" fill-opacity=".8" text-anchor="middle" direction="rtl">شمارهٔ ${number.toLocaleString('fa-IR')}</text>
<rect x="60" y="600" width="480" height="150" rx="14" fill="#000" fill-opacity=".35"/>
<text x="300" y="690" font-family="${FONT}" font-size="34" font-weight="700" fill="#fff" text-anchor="middle" direction="rtl">${esc(title)}</text>
</svg>`
}

const LOREM = [
  'پژوهش‌های دانشجویی پلی میان کلاس درس و جامعه است و هر شماره فرصتی برای گفت‌وگوی تازه فراهم می‌کند.',
  'در این بخش به بررسی ابعاد گوناگون موضوع پرداخته‌ایم و دیدگاه استادان و دانشجویان را کنار هم گذاشته‌ایم.',
  'یافته‌ها نشان می‌دهد که مشارکت فعال دانشجویان در تولید محتوا، کیفیت یادگیری را به شکل محسوسی افزایش می‌دهد.',
  'نویسنده با نگاهی انتقادی، پیشینهٔ بحث را مرور کرده و پرسش‌هایی برای پژوهش‌های آینده مطرح می‌کند.',
  'گفت‌وگوی این شماره با یکی از چهره‌های شناخته‌شدهٔ دانشگاه، تجربه‌ای ارزشمند از مسیر حرفه‌ای را روایت می‌کند.',
  'جدول‌ها و نمودارهای این مقاله از داده‌های میدانی گردآوری‌شده در نیم‌سال گذشته استخراج شده‌اند.',
  'ترجمهٔ این متن با هدف آشنایی خوانندگان با تازه‌ترین رویکردهای جهانی در این حوزه انجام شده است.',
  'یادداشت سردبیر: از همهٔ همراهانی که با نقد و پیشنهادهایشان به بهتر شدن نشریه کمک کردند سپاسگزاریم.'
]

function pageSvg(issueTitle: string, pubTitle: string, n: number, section: string, color: string): string {
  const lines: string[] = []
  let y = 200
  for (let k = 0; k < 16; k++) {
    const t = LOREM[(n * 3 + k) % LOREM.length]
    lines.push(`<text x="540" y="${y}" font-family="${FONT}" font-size="17" fill="#1f2937" text-anchor="end" direction="rtl">${esc(t.slice(0, 62))}</text>`)
    y += 34
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 850" width="600" height="850">
<rect width="600" height="850" fill="#fffdf8"/>
<rect x="0" y="0" width="600" height="8" fill="${color}"/>
<text x="540" y="60" font-family="${FONT}" font-size="14" fill="#6b7280" text-anchor="end" direction="rtl">${esc(pubTitle)} — ${esc(issueTitle)}</text>
<text x="540" y="140" font-family="${FONT}" font-size="28" font-weight="700" fill="${color}" text-anchor="end" direction="rtl">${esc(section)}</text>
${lines.join('\n')}
<line x1="60" y1="790" x2="540" y2="790" stroke="#e5e7eb"/>
<text x="300" y="820" font-family="${FONT}" font-size="15" fill="#6b7280" text-anchor="middle">${n.toLocaleString('fa-IR')}</text>
</svg>`
}

function postSvg(caption: string, pubTitle: string, color: string, seed: number): string {
  const a = (seed * 47) % 360
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" width="800" height="800">
<defs><linearGradient id="p" gradientTransform="rotate(${a})"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="#0f172a"/></linearGradient></defs>
<rect width="800" height="800" fill="url(#p)"/>
<circle cx="${200 + (seed % 400)}" cy="${250 + (seed % 300)}" r="${120 + (seed % 120)}" fill="#fff" opacity=".08"/>
<text x="740" y="90" font-family="${FONT}" font-size="30" font-weight="700" fill="#fff" fill-opacity=".85" text-anchor="end" direction="rtl">${esc(pubTitle)}</text>
<text x="400" y="420" font-family="${FONT}" font-size="40" font-weight="800" fill="#fff" text-anchor="middle" direction="rtl">${esc(caption.slice(0, 26))}</text>
</svg>`
}

function logoSvg(title: string, color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
<rect width="200" height="200" rx="40" fill="${color}"/>
<text x="100" y="128" font-family="${FONT}" font-size="86" font-weight="800" fill="#fff" text-anchor="middle">${esc(title.trim().charAt(0))}</text>
</svg>`
}

// ───────── static demo dictionaries ─────────
const FACULTIES = [
  { code: 'eng', name: 'فنی و مهندسی', majors: ['مهندسی برق', 'مهندسی کامپیوتر', 'مهندسی مکانیک', 'مهندسی عمران'] },
  { code: 'sci', name: 'علوم پایه', majors: ['فیزیک', 'شیمی', 'ریاضی', 'زیست‌شناسی'] },
  { code: 'hum', name: 'علوم انسانی', majors: ['ادبیات فارسی', 'فلسفه', 'علوم اجتماعی', 'اقتصاد', 'علوم سیاسی'] },
  { code: 'med', name: 'پزشکی', majors: ['پزشکی عمومی', 'روان‌شناسی بالینی', 'پرستاری'] },
  { code: 'art', name: 'هنر و معماری', majors: ['معماری', 'عکاسی', 'موسیقی', 'گرافیک'] },
  { code: 'agr', name: 'کشاورزی و منابع طبیعی', majors: ['علوم خاک', 'محیط زیست', 'زراعت'] }
]

const CATEGORIES = [
  { slug: 'science-tech', name: 'علمی و فناوری', icon: 'atom', color: '#2563eb' },
  { slug: 'literature-art', name: 'ادبی و هنری', icon: 'feather', color: '#db2777' },
  { slug: 'social', name: 'اجتماعی', icon: 'users', color: '#ea580c' },
  { slug: 'culture-religion', name: 'فرهنگی و دینی', icon: 'landmark', color: '#0d9488' },
  { slug: 'politics-economy', name: 'سیاسی و اقتصادی', icon: 'scale', color: '#7c3aed' },
  { slug: 'health', name: 'سلامت', icon: 'heart-pulse', color: '#dc2626' },
  { slug: 'environment', name: 'محیط زیست', icon: 'leaf', color: '#16a34a' },
  { slug: 'philosophy', name: 'فلسفه و اندیشه', icon: 'brain', color: '#4b5563' }
]

const PRODUCTION_ROLES = ['نویسنده', 'مترجم', 'ویراستار', 'گرافیست', 'تصویرگر', 'صفحه‌آرا', 'عکاس', 'خبرنگار', 'مصاحبه‌گر']

// faculty index, association name, kind
const ASSOCIATIONS: [number, string, string][] = [
  [0, 'انجمن علمی مهندسی برق', 'scientific_association'],
  [0, 'انجمن علمی مهندسی کامپیوتر', 'scientific_association'],
  [0, 'انجمن علمی مهندسی مکانیک', 'scientific_association'],
  [1, 'انجمن علمی فیزیک', 'scientific_association'],
  [1, 'انجمن علمی شیمی', 'scientific_association'],
  [1, 'انجمن علمی ریاضی', 'scientific_association'],
  [1, 'انجمن علمی زیست‌شناسی', 'scientific_association'],
  [2, 'انجمن علمی ادبیات فارسی', 'scientific_association'],
  [2, 'انجمن علمی فلسفه', 'scientific_association'],
  [2, 'انجمن علمی علوم اجتماعی و اقتصاد', 'scientific_association'],
  [3, 'انجمن علمی پزشکی', 'scientific_association'],
  [4, 'کانون عکس و معماری', 'cultural_club'],
  [4, 'کانون موسیقی', 'cultural_club'],
  [5, 'انجمن علمی منابع طبیعی', 'scientific_association'],
  [2, 'انجمن اسلامی دانشجویان', 'islamic_association']
]

// slug, title, tagline, association idx, category slugs, color, frequency, activity level (0 = stalled .. 3 = very active)
const PUBS: [string, string, string, number, string[], string, string, number][] = [
  ['faramatn', 'فرامتن', 'ماهنامهٔ ادبی دانشجویی', 7, ['literature-art'], '#9d174d', 'monthly', 3],
  ['madar', 'مدار', 'نشریهٔ علمی مهندسی برق', 0, ['science-tech'], '#1d4ed8', 'bimonthly', 2],
  ['selol', 'سلول', 'دوماهنامهٔ علوم زیستی', 6, ['science-tech', 'health'], '#047857', 'bimonthly', 2],
  ['quantum', 'کوانتوم', 'فیزیک به زبان ساده', 3, ['science-tech'], '#4338ca', 'quarterly', 1],
  ['porsesh', 'پرسش', 'فصلنامهٔ فلسفه و اندیشه', 8, ['philosophy'], '#374151', 'quarterly', 2],
  ['shahr', 'شهر و معماری', 'نگاهی به فضاهای زندگی', 11, ['literature-art', 'social'], '#b45309', 'quarterly', 1],
  ['nabz', 'نبض', 'نشریهٔ دانشجویان پزشکی', 10, ['health'], '#b91c1c', 'monthly', 3],
  ['khak', 'خاک و زندگی', 'کشاورزی پایدار', 13, ['environment'], '#65a30d', 'biannual', 0],
  ['algorithm', 'الگوریتم', 'نشریهٔ علمی کامپیوتر', 1, ['science-tech'], '#0e7490', 'monthly', 3],
  ['revayat', 'روایت', 'جامعه از نگاه دانشجو', 9, ['social'], '#c2410c', 'bimonthly', 2],
  ['eghtesad', 'اقتصاد امروز', 'تحلیل اقتصادی دانشجویی', 9, ['politics-economy'], '#6d28d9', 'quarterly', 1],
  ['sabz', 'سبز', 'محیط زیست و توسعهٔ پایدار', 13, ['environment', 'social'], '#15803d', 'quarterly', 2],
  ['ghab', 'قاب', 'نشریهٔ عکاسی', 11, ['literature-art'], '#1f2937', 'irregular', 1],
  ['mechanic', 'مکانیک نو', 'فناوری و صنعت', 2, ['science-tech'], '#475569', 'biannual', 0],
  ['shimi', 'شیمی و جامعه', 'شیمی در زندگی روزمره', 4, ['science-tech', 'environment'], '#0891b2', 'quarterly', 1],
  ['hekmat', 'حکمت', 'فرهنگی، دینی، اجتماعی', 14, ['culture-religion'], '#0f766e', 'monthly', 2],
  ['dialog', 'دیالوگ', 'گفت‌وگوی سیاسی دانشجویی', 14, ['politics-economy', 'social'], '#7e22ce', 'bimonthly', 2],
  ['ravan', 'سلامت روان', 'روان‌شناسی برای همه', 10, ['health', 'social'], '#db2777', 'bimonthly', 3],
  ['hamnava', 'هم‌نوا', 'موسیقی و هنرهای شنیداری', 12, ['literature-art'], '#a21caf', 'irregular', 1],
  ['riazi', 'ریاضیات زنده', 'ریاضی فراتر از کلاس', 5, ['science-tech'], '#2563eb', 'quarterly', 1]
]

const ISSUE_TITLES = [
  'آیندهٔ هوش مصنوعی', 'زن، زندگی، دانشگاه', 'شهر و حافظه', 'بحران آب', 'ادبیات مهاجرت', 'دانشجو و اشتغال', 'سلامت خواب',
  'انرژی‌های نو', 'ترجمه و فرهنگ', 'اقتصاد دیجیتال', 'فلسفهٔ تکنولوژی', 'عکاسی خیابانی', 'رسانه و حقیقت', 'خوابگاه‌ها',
  'تنهایی مدرن', 'علم باز', 'بازی‌های رایانه‌ای', 'موسیقی نواحی', 'ریاضیات و زیبایی', 'تغییر اقلیم', 'کتاب‌خوانی',
  'کارآفرینی دانشجویی', 'اخلاق پزشکی', 'سفر به فضا', 'زبان مادری', 'میراث معماری', 'آلودگی هوا', 'روان‌شناسی امید'
]
const TOC_TITLES = ['سرمقاله', 'گفت‌وگوی ویژه', 'پرونده: نگاه نخست', 'پرونده: نقد و بررسی', 'ترجمه', 'گزارش میدانی', 'یادداشت آزاد', 'معرفی کتاب', 'شعر و داستان', 'پیشنهاد سردبیر']
const FIRST = ['علی', 'زهرا', 'محمد', 'فاطمه', 'حسین', 'مریم', 'رضا', 'سارا', 'امیر', 'نرگس', 'مهدی', 'الهام', 'پارسا', 'نیلوفر', 'سینا', 'هانیه', 'آرمان', 'یاسمن', 'کیان', 'ریحانه']
const LAST = ['محمدی', 'حسینی', 'کریمی', 'رضایی', 'احمدی', 'موسوی', 'جعفری', 'رحیمی', 'صادقی', 'نوری', 'شریفی', 'کاظمی', 'عباسی', 'قاسمی', 'یزدانی', 'افشار']
const STAGES = [
  ['writing', 'نویسندگی'], ['editing', 'ویراستاری'], ['graphics', 'گرافیک و تصویرسازی'], ['layout', 'صفحه‌آرایی'], ['review', 'بازبینی نهایی'], ['publish', 'انتشار']
]
const FREQ_DAYS: Record<string, number> = { monthly: 30, bimonthly: 60, quarterly: 90, biannual: 180, irregular: 120 }

export interface SeedOptions {
  log?: (m: string) => void
}

/** Creates the first super admin if the database has no users at all (first boot of a fresh install). */
export async function ensureBootstrapAdmin(deps: Deps, password = 'admin1234'): Promise<boolean> {
  const any = await deps.db.first('SELECT id FROM users LIMIT 1')
  if (any) return false
  await deps.db.run(
    "INSERT INTO users (id, username, display_name, password_hash, must_change_password, system_role, created_at) VALUES (?,?,?,?,1,'super_admin',?)",
    [newId(), 'admin', 'مدیر سامانه', await hashPassword(password), new Date().toISOString()]
  )
  return true
}

export async function seed(deps: Deps, opts: SeedOptions = {}): Promise<void> {
  const log = opts.log || (() => {})
  const { db, storage } = deps
  _s = 20261029
  const NOW = Date.now()
  const queue: Stmt[] = []
  const q = (sql: string, ...params: unknown[]) => queue.push({ sql, params })
  const flush = async () => {
    while (queue.length) await db.batch(queue.splice(0, 400))
  }
  const put = (key: string, svg: string) => storage.put(key, new TextEncoder().encode(svg), 'image/svg+xml')

  // password hashes: one PBKDF2 per distinct password keeps the seed fast
  const hashes = new Map<string, string>()
  const pw = async (p: string) => {
    if (!hashes.has(p)) hashes.set(p, await hashPassword(p))
    return hashes.get(p)!
  }

  // ───────── settings ─────────
  const settings: Record<string, unknown> = {
    site_name: 'نشریار',
    university_name: 'دانشگاه نمونه',
    registration_open: true,
    guest_can_read_free: true,
    supervisor_can_approve: false,
    ai_enabled: false,
    home_banners: [],
    // Demo databases only: lets the login page list the demo accounts. Never set on a real install.
    demo_mode: true
  }
  for (const [k, v] of Object.entries(settings)) q('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?,?,?)', k, JSON.stringify(v), iso(NOW))

  // ───────── organization ─────────
  const facultyIds: string[] = []
  const majorIds: string[][] = []
  FACULTIES.forEach((f, i) => {
    const id = newId()
    facultyIds.push(id)
    q('INSERT INTO faculties (id, name, code, sort_order, is_active, created_at) VALUES (?,?,?,?,1,?)', id, f.name, f.code, i, iso(NOW - 900 * DAY))
    majorIds.push(f.majors.map((m) => {
      const mid = newId()
      q('INSERT INTO majors (id, faculty_id, name, created_at) VALUES (?,?,?,?)', mid, id, m, iso(NOW - 900 * DAY))
      return mid
    }))
  })
  const assocIds = ASSOCIATIONS.map(([fi, name, kind]) => {
    const id = newId()
    q('INSERT INTO associations (id, faculty_id, name, kind, is_active, created_at) VALUES (?,?,?,?,1,?)', id, facultyIds[fi], name, kind, iso(NOW - 800 * DAY))
    return id
  })
  const catIds: Record<string, string> = {}
  CATEGORIES.forEach((c, i) => {
    const id = newId()
    catIds[c.slug] = id
    q("INSERT INTO categories (id, parent_id, type, name, slug, icon, color, sort_order, is_active, created_at) VALUES (?,NULL,'subject',?,?,?,?,?,1,?)", id, c.name, c.slug, c.icon, c.color, i, iso(NOW - 800 * DAY))
  })
  // a sub-category and major-type categories (browse by field of study)
  q("INSERT INTO categories (id, parent_id, type, name, slug, icon, color, sort_order, is_active, created_at) VALUES (?,?,'subject','هوش مصنوعی','ai',NULL,NULL,0,1,?)", newId(), catIds['science-tech'], iso(NOW - 700 * DAY))
  FACULTIES.forEach((f, i) => q("INSERT INTO categories (id, parent_id, type, name, slug, icon, color, sort_order, is_active, created_at) VALUES (?,NULL,'major',?,?,NULL,NULL,?,1,?)", newId(), f.name, 'major-' + f.code, i, iso(NOW - 700 * DAY)))
  PRODUCTION_ROLES.forEach((r, i) => q('INSERT INTO production_roles (id, name, sort_order) VALUES (?,?,?)', newId(), r, i))
  await flush()
  log('organization, categories and roles')

  // ───────── staff accounts ─────────
  const addUser = async (username: string, name: string, role: string, password: string, extra: { sn?: string; faculty?: string; scope?: string; major?: string } = {}) => {
    const id = newId()
    q(
      'INSERT INTO users (id, username, student_number, display_name, faculty_id, major_id, password_hash, must_change_password, system_role, scope_faculty_id, status, created_at) VALUES (?,?,?,?,?,?,?,0,?,?,?,?)',
      id, username, extra.sn ?? null, name, extra.faculty ?? null, extra.major ?? null, await pw(password), role, extra.scope ?? null, 'active', iso(NOW - ri(200, 700) * DAY)
    )
    return id
  }
  const adminId = await addUser('admin', 'مدیر سامانه', 'super_admin', 'admin1234')
  const officerId = await addUser('officer', 'مسئول نشریات دانشگاه', 'pub_officer', 'officer1234')
  await addUser('supervisor', 'ناظر دانشکدهٔ فنی', 'faculty_supervisor', 'super1234', { scope: facultyIds[0] })
  await addUser('analyst', 'کارشناس آمار', 'analyst', 'analyst1234')
  // Demo-only developer account (phase 13). The /system console stays locked until it enables 2FA itself;
  // on real installs the developer account is created only via `--create-developer`.
  await addUser('developer', 'طراح سامانه', 'developer', 'dev12345678')

  // ───────── students ─────────
  const studentIds: string[] = []
  const mainStudent = await addUser('40012345', 'سارا محمدی', 'student', 'student1234', { sn: '40012345', faculty: facultyIds[2], major: majorIds[2][0] })
  studentIds.push(mainStudent)
  for (let k = 1; k < 60; k++) {
    const fi = ri(0, FACULTIES.length - 1)
    const sn = String(39010000 + k * 137 + ri(0, 99))
    studentIds.push(await addUser(sn, `${pick(FIRST)} ${pick(LAST)}`, 'student', 'student1234', { sn, faculty: facultyIds[fi], major: pick(majorIds[fi]) }))
  }
  await flush()
  log(`users: ${studentIds.length} students + staff`)

  // ───────── publications ─────────
  const issueCards: { id: string; pub: number; published: boolean; pricing: string; publishedAt: number | null }[] = []
  const pubIds: string[] = []
  const pubTocs: Record<string, { issueId: string; tocIds: string[] }[]> = {}
  let coverSeed = 7
  let demoCodeMade = false

  for (let pi = 0; pi < PUBS.length; pi++) {
    const [slug, title, tagline, ai, cats, color, freq, level] = PUBS[pi]
    const pubId = newId()
    pubIds.push(pubId)
    const facultyId = facultyIds[ASSOCIATIONS[ai][0]]
    const founded = NOW - ri(500, 1600) * DAY
    const logoKey = `pub/${pubId}/misc/logo.svg`
    await put(logoKey, logoSvg(title, color))
    const keywords = [tagline.split(' ').slice(-1)[0], ...cats.map((c) => CATEGORIES.find((x) => x.slug === c)!.name)].join('،')
    const status = pi === 13 ? 'suspended' : 'active'
    q(
      `INSERT INTO publications (id, slug, title, tagline, description, association_id, faculty_id, license_number, license_issued_at, license_expires_at, frequency, theme_color, logo_key, keywords, contacts_json, status, search_text, founded_at, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      pubId, slug, title, tagline,
      `${title} نشریهٔ دانشجویی ${ASSOCIATIONS[ai][1]} است که با همکاری دانشجویان علاقه‌مند منتشر می‌شود. ${tagline}.`,
      assocIds[ai], facultyId, `${1400 + (pi % 5)}/${120 + pi * 7}`, iso(founded), iso(NOW + (pi === 4 ? 20 : ri(120, 900)) * DAY),
      freq, color, logoKey, keywords,
      JSON.stringify([{ kind: 'telegram', value: '@' + slug + '_mag', label: 'کانال تلگرام' }, { kind: 'email', value: slug + '@uni.example.ac.ir', label: 'رایانامه' }]),
      status, normalizeFa([title, tagline, keywords, ASSOCIATIONS[ai][1]].join(' ')), iso(founded), iso(founded)
    )
    for (const c of cats) q('INSERT INTO publication_categories (publication_id, category_id) VALUES (?,?)', pubId, catIds[c])

    // three main accounts (+ history for the first publication: a previous managing director)
    const n = pi + 1
    const director = await addUser(`pub${n}-director`, `${pick(FIRST)} ${pick(LAST)}`, 'team', 'team1234')
    const editor = await addUser(`pub${n}-editor`, `${pick(FIRST)} ${pick(LAST)}`, 'team', 'team1234')
    const holder = await addUser(`pub${n}-holder`, `${pick(FIRST)} ${pick(LAST)}`, 'team', 'team1234')
    const tenureStart = NOW - (pi === 0 ? 200 : ri(250, 700)) * DAY
    if (pi === 0) {
      const prev = await addUser('pub1-former-director', 'مدیرمسئول پیشین فرامتن', 'team', 'team1234')
      q('INSERT INTO publication_roles (id, publication_id, user_id, role, started_at, ended_at) VALUES (?,?,?,?,?,?)', newId(), pubId, prev, 'managing_director', iso(founded), iso(tenureStart))
    }
    q('INSERT INTO publication_roles (id, publication_id, user_id, role, started_at) VALUES (?,?,?,?,?)', newId(), pubId, director, 'managing_director', iso(tenureStart))
    q('INSERT INTO publication_roles (id, publication_id, user_id, role, started_at) VALUES (?,?,?,?,?)', newId(), pubId, editor, 'editor_in_chief', iso(tenureStart))
    q('INSERT INTO publication_roles (id, publication_id, user_id, role, started_at) VALUES (?,?,?,?,?)', newId(), pubId, holder, 'license_holder', iso(founded))

    // team members
    const members: string[] = []
    const memberCount = ri(5, 11)
    for (let m = 0; m < memberCount; m++) {
      const id = newId()
      members.push(id)
      const joined = founded + ri(0, 300) * DAY
      q(
        'INSERT INTO team_members (id, publication_id, full_name, student_number, faculty_id, default_role, joined_at, is_active, created_at) VALUES (?,?,?,?,?,?,?,1,?)',
        id, pubId, `${pick(FIRST)} ${pick(LAST)}`, String(39900000 + pi * 100 + m), facultyId, pick(PRODUCTION_ROLES), iso(joined), iso(joined)
      )
      q("INSERT INTO activity_events (id, actor_user_id, publication_id, type, created_at) VALUES (?,?,?,'member.added',?)", newId(), director, pubId, iso(Math.min(NOW - DAY, joined)))
    }

    // ───────── issues ─────────
    const period = FREQ_DAYS[freq] * DAY
    const count = level === 0 ? ri(1, 2) : ri(2, 4) + (level >= 2 ? 1 : 0)
    // stalled publications stopped publishing long ago
    let lastPublish = NOW - (level === 0 ? ri(220, 320) : level === 1 ? ri(40, 150) : ri(5, 40)) * DAY
    const titles = shuffle(ISSUE_TITLES)
    pubTocs[pubId] = []
    for (let k = count; k >= 1; k--) {
      const issueId = newId()
      const isCurrent = k === count && level > 0
      const publishedAt = isCurrent ? null : lastPublish - (count - 1 - k) * period
      const createdAt = (publishedAt ?? NOW) - ri(35, 80) * DAY
      const status = isCurrent ? pick(['planning', 'in_production', 'in_production', 'awaiting_approval', 'changes_requested']) : 'published'
      const pricing = rnd() < 0.3 ? 'paid' : 'free'
      const pageCount = ri(8, 14)
      const ititle = titles[k % titles.length]
      const coverKey = `pub/${pubId}/${issueId}/cover.svg`
      await put(coverKey, coverSvg(ititle, title, k, color, coverSeed++ * 13))
      const hasPages = status !== 'planning'
      q(
        `INSERT INTO issues (id, publication_id, number, title, summary, keywords, status, progress_view, planned_publish_at, published_at, page_count, pricing, price_digital, price_print, print_run, free_preview_pages, cover_key, code_ttl_hours, director_user_id, search_text, created_by, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        issueId, pubId, k, ititle, `شمارهٔ ${k} ${title} به موضوع «${ititle}» می‌پردازد؛ با مقاله، گفت‌وگو و گزارش‌هایی از دانشجویان.`,
        `${ititle}،${title}`, status, pick(['timeline', 'checklist', 'kanban']),
        isCurrent ? iso(NOW + ri(10, 40) * DAY) : null, publishedAt ? iso(publishedAt) : null, hasPages ? pageCount : 0, pricing,
        pricing === 'paid' ? pick([20000, 25000, 30000, 40000, 50000]) : null, pick([null, 60000, 80000]), pick([null, 100, 200, 300]),
        3, coverKey, pick([6, 12, 24]), director, normalizeFa([ititle, title, 'شماره ' + k].join(' ')), director, iso(createdAt), iso(publishedAt ?? NOW - ri(1, 6) * DAY)
      )
      q('INSERT INTO media_assets (id, publication_id, issue_id, kind, role, title, storage_key, mime, size_bytes, access, uploaded_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        newId(), pubId, issueId, 'image', 'cover', 'جلد', coverKey, 'image/svg+xml', 4000, 'free', director, iso(createdAt + 20 * DAY))
      q('INSERT INTO issue_categories (issue_id, category_id) VALUES (?,?)', issueId, catIds[cats[0]])
      q("INSERT INTO activity_events (id, actor_user_id, publication_id, issue_id, type, created_at) VALUES (?,?,?,?,'issue.created',?)", newId(), director, pubId, issueId, iso(createdAt))

      // table of contents + assignments
      const tocTitles = shuffle(TOC_TITLES).slice(0, ri(4, 7))
      const tocIds: string[] = []
      let page = 2
      const per = Math.max(1, Math.floor((pageCount - 1) / tocTitles.length))
      for (let t = 0; t < tocTitles.length; t++) {
        const tid = newId()
        tocIds.push(tid)
        const done = status === 'published' || status === 'awaiting_approval' || rnd() < 0.4
        const tStatus = done ? 'done' : pick(['todo', 'writing', 'written', 'editing', 'edited'])
        q('INSERT INTO issue_toc_items (id, issue_id, sort_order, title, kind, page_start, page_end, status, due_at, done_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
          tid, issueId, t, tocTitles[t], 'article', page, Math.min(pageCount, page + per - 1), tStatus, iso(createdAt + 25 * DAY), done ? iso(createdAt + ri(10, 30) * DAY) : null, iso(createdAt))
        page += per
        const author = pick(members)
        q("INSERT INTO toc_assignments (id, toc_item_id, team_member_id, role) VALUES (?,?,?,'author')", newId(), tid, author)
        q("INSERT INTO toc_assignments (id, toc_item_id, team_member_id, role) VALUES (?,?,?,'editor')", newId(), tid, pick(members))
        q("INSERT INTO stage_events (id, issue_id, toc_item_id, from_status, to_status, actor_user_id, created_at) VALUES (?,?,?,?,?,?,?)",
          newId(), issueId, tid, 'todo', tStatus, editor, iso(createdAt + ri(3, 30) * DAY))
        q("INSERT INTO activity_events (id, actor_user_id, publication_id, issue_id, type, created_at) VALUES (?,?,?,?,'toc.status',?)", newId(), editor, pubId, issueId, iso(Math.min(NOW - DAY, createdAt + ri(3, 30) * DAY)))
      }
      pubTocs[pubId].push({ issueId, tocIds })
      for (const m of shuffle(members).slice(0, Math.min(members.length, 5))) {
        q('INSERT INTO issue_members (id, issue_id, team_member_id, production_role) VALUES (?,?,?,?)', newId(), issueId, m, pick(PRODUCTION_ROLES))
      }

      // production stages (durations feed the "production speed" analytics)
      let t0 = createdAt
      const doneUpTo = status === 'published' || status === 'awaiting_approval' ? 6 : status === 'planning' ? 0 : ri(1, 4)
      for (let s = 0; s < STAGES.length; s++) {
        const sid = newId()
        const dur = ri(3, 14) * DAY
        const sStatus = s < doneUpTo ? 'done' : s === doneUpTo && status !== 'planning' ? 'in_progress' : 'pending'
        q('INSERT INTO issue_stages (id, issue_id, key, title, sort_order, status, started_at, completed_at, due_at) VALUES (?,?,?,?,?,?,?,?,?)',
          sid, issueId, STAGES[s][0], STAGES[s][1], s, sStatus, sStatus !== 'pending' ? iso(t0) : null, sStatus === 'done' ? iso(t0 + dur) : null, iso(createdAt + (s + 1) * 10 * DAY))
        if (sStatus !== 'pending') {
          q('INSERT INTO stage_events (id, issue_id, stage_id, from_status, to_status, actor_user_id, created_at) VALUES (?,?,?,?,?,?,?)', newId(), issueId, sid, 'pending', 'in_progress', editor, iso(Math.min(NOW - 3600_000, t0)))
          q("INSERT INTO activity_events (id, actor_user_id, publication_id, issue_id, type, created_at) VALUES (?,?,?,?,'stage.status',?)", newId(), editor, pubId, issueId, iso(Math.min(NOW - 3600_000, t0)))
        }
        if (sStatus === 'done') q('INSERT INTO stage_events (id, issue_id, stage_id, from_status, to_status, actor_user_id, created_at) VALUES (?,?,?,?,?,?,?)', newId(), issueId, sid, 'in_progress', 'done', editor, iso(Math.min(NOW - 3600_000, t0 + dur)))
        t0 += dur
      }

      // approvals (publishing ALWAYS requires officer approval)
      if (status === 'published') {
        q('INSERT INTO issue_approvals (id, issue_id, requested_by, requested_at, decided_by, decision, note, decided_at) VALUES (?,?,?,?,?,?,?,?)',
          newId(), issueId, director, iso(publishedAt! - 3 * DAY), officerId, 'approved', null, iso(publishedAt!))
      } else if (status === 'awaiting_approval' || status === 'changes_requested') {
        const reqAt = NOW - ri(1, 5) * DAY
        q('INSERT INTO issue_approvals (id, issue_id, requested_by, requested_at, decided_by, decision, note, decided_at) VALUES (?,?,?,?,?,?,?,?)',
          newId(), issueId, director, iso(reqAt), status === 'changes_requested' ? officerId : null, status === 'changes_requested' ? 'changes_requested' : null,
          status === 'changes_requested' ? 'لطفاً منبع تصاویر صفحهٔ ۵ را اضافه کنید.' : 'آماده برای انتشار', status === 'changes_requested' ? iso(reqAt + DAY) : null)
        q("INSERT INTO activity_events (id, actor_user_id, publication_id, issue_id, type, created_at) VALUES (?,?,?,?,'issue.approval_requested',?)", newId(), director, pubId, issueId, iso(reqAt))
        if (status === 'awaiting_approval') q('INSERT INTO notifications (id, user_id, type, title, link, created_at) VALUES (?,?,?,?,?,?)', newId(), officerId, 'approval', `درخواست انتشار: ${title} — شمارهٔ ${k}`, '/admin/approvals', iso(reqAt))
      }

      // page images (rendered in the browser by pdf.js in production; generated here)
      if (hasPages) {
        for (let pn = 1; pn <= pageCount; pn++) {
          const key = `pub/${pubId}/${issueId}/pages/${String(pn).padStart(4, '0')}.svg`
          const section = pn === 1 ? 'فهرست مطالب' : tocTitles[Math.min(tocTitles.length - 1, Math.floor((pn - 2) / per))]
          await put(key, pageSvg(ititle, title, pn, section, color))
          q('INSERT INTO issue_pages (id, issue_id, page_number, image_key, text_content) VALUES (?,?,?,?,?)', newId(), issueId, pn, key, LOREM[pn % LOREM.length])
        }
      }

      // purchase codes + entitlements + physical sales for paid published issues
      if (status === 'published' && pricing === 'paid') {
        const codes = ri(3, 12)
        q("INSERT INTO activity_events (id, actor_user_id, publication_id, issue_id, type, created_at) VALUES (?,?,?,?,'codes.created',?)", newId(), director, pubId, issueId, iso(publishedAt! + DAY))
        for (let cc = 0; cc < codes; cc++) {
          // the first paid issue gets a known, still-valid demo code: NSH-DEMO-2026
          const demo = !demoCodeMade && cc === codes - 1
          const plain = demo ? normalizePurchaseCode('NSH-DEMO-2026') : normalizePurchaseCode('NSH-' + randomId(8).toUpperCase())
          const created = demo ? NOW - 3600_000 : Math.min(NOW - 3600_000, publishedAt! + ri(0, 60) * DAY)
          const redeemedBy = !demo && cc < codes - 2 ? pick(studentIds) : null
          if (demo) demoCodeMade = true
          const codeId = newId()
          q(
            'INSERT INTO access_codes (id, issue_id, publication_id, code_hash, code_last4, price_paid, channel, created_by, created_at, expires_at, redeemed_at, redeemed_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
            codeId, issueId, pubId, await sha256(plain), plain.slice(-4), 30000, pick(['card_to_card', 'cash', 'gift']), director, iso(created), iso(created + 24 * 3600_000),
            redeemedBy ? iso(created + 3600_000) : null, redeemedBy
          )
          if (redeemedBy) q("INSERT OR IGNORE INTO entitlements (id, user_id, issue_id, source, access_code_id, granted_at) VALUES (?,?,?,'code',?,?)", newId(), redeemedBy, issueId, codeId, iso(created + 3600_000))
        }
        q('INSERT INTO physical_sales (id, issue_id, publication_id, quantity, unit_price, sold_at, channel, recorded_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
          newId(), issueId, pubId, ri(10, 80), 60000, dayOf(publishedAt! + 7 * DAY), 'booth', director, iso(publishedAt! + 7 * DAY))
      }
      if (publishedAt) issueCards.push({ id: issueId, pub: pi, published: true, pricing, publishedAt })
    }
    await flush()
    log(`publication ${n}/${PUBS.length}: ${title}`)
  }

  // ───────── explore: posts (each cites issue + section), highlights, comments ─────────
  const postIds: { id: string; pub: number; at: number }[] = []
  const CAPTIONS = ['نگاهی به پروندهٔ این شماره', 'بخشی از گفت‌وگوی ویژه', 'جمله‌ای که باید خواند', 'پشت صحنهٔ تولید', 'پیشنهاد مطالعه', 'از دل گزارش میدانی']
  for (let pi = 0; pi < PUBS.length; pi++) {
    const [, title, , , , color, , level] = PUBS[pi]
    const pubId = pubIds[pi]
    const published = pubTocs[pubId].filter((x) => issueCards.some((ic) => ic.id === x.issueId))
    if (!published.length) continue
    const n = level === 0 ? 1 : ri(2, 3 + level)
    const hlId = level >= 2 ? newId() : null
    if (hlId) q('INSERT INTO highlights (id, publication_id, title, sort_order, created_at) VALUES (?,?,?,?,?)', hlId, pubId, 'برگزیده‌ها', 0, iso(NOW - 100 * DAY))
    for (let k = 0; k < n; k++) {
      const src = pick(published)
      const id = newId()
      const cap = pick(CAPTIONS)
      const imgs: string[] = []
      for (let im = 0; im < (rnd() < 0.3 ? 2 : 1); im++) {
        const key = `pub/${pubId}/misc/post-${id}-${im}.svg`
        await put(key, postSvg(cap, title, color, ri(1, 9999)))
        imgs.push(key)
        q("INSERT INTO media_assets (id, publication_id, kind, role, title, storage_key, mime, size_bytes, access, created_at) VALUES (?,?,'image','post',?,?,'image/svg+xml',3000,'free',?)", newId(), pubId, cap, key, iso(NOW - 10 * DAY))
      }
      const at = NOW - ri(1, level === 0 ? 300 : 120) * DAY
      q(
        "INSERT INTO posts (id, publication_id, kind, caption, images_json, source_issue_id, source_toc_item_id, is_story, status, published_at, created_at) VALUES (?,?,?,?,?,?,?,0,'published',?,?)",
        id, pubId, imgs.length > 1 ? 'carousel' : 'image', `${cap} — از ${title}`, JSON.stringify(imgs), src.issueId, pick(src.tocIds), iso(at), iso(at)
      )
      q("INSERT INTO activity_events (id, publication_id, issue_id, type, created_at) VALUES (?,?,?,'post.published',?)", newId(), pubId, src.issueId, iso(at))
      if (hlId && k < 2) q('INSERT OR IGNORE INTO highlight_items (highlight_id, post_id) VALUES (?,?)', hlId, id)
      postIds.push({ id, pub: pi, at })
    }
  }
  const COMMENTS = ['خیلی مفید بود، ممنون از تیم نشریه.', 'منتظر شمارهٔ بعد هستیم!', 'منبع این آمار کجاست؟', 'عالی بود 👏', 'کاش نسخهٔ چاپی هم در کتابخانه باشد.', 'این بخش را با دوستانم به اشتراک گذاشتم.']
  for (const p of postIds) {
    for (let k = 0; k < ri(0, 4); k++) {
      const st = rnd() < 0.7 ? 'approved' : 'pending'
      q('INSERT INTO comments (id, post_id, user_id, body, status, moderated_by, moderated_at, created_at) VALUES (?,?,?,?,?,?,?,?)',
        newId(), p.id, pick(studentIds), pick(COMMENTS), st, st === 'approved' ? officerId : null, st === 'approved' ? iso(p.at + DAY) : null, iso(Math.min(NOW - 3600_000, p.at + ri(1, 48) * 3600_000)))
    }
  }
  await flush()
  log(`explore: ${postIds.length} posts`)

  // ───────── follows (never shown publicly), saved posts, library, progress ─────────
  for (const sid of studentIds) {
    for (const pi of shuffle([...Array(PUBS.length).keys()]).slice(0, ri(1, 6))) {
      const unf = rnd() < 0.08
      q('INSERT OR IGNORE INTO follows (user_id, publication_id, created_at, unfollowed_at) VALUES (?,?,?,?)', sid, pubIds[pi], iso(NOW - ri(5, 360) * DAY), unf ? iso(NOW - ri(1, 4) * DAY) : null)
    }
  }
  for (const p of shuffle(postIds).slice(0, 5)) q('INSERT OR IGNORE INTO saved_posts (user_id, post_id, created_at) VALUES (?,?,?)', mainStudent, p.id, iso(NOW - ri(1, 20) * DAY))
  for (const ic of shuffle(issueCards.filter((x) => x.pricing === 'free')).slice(0, 4)) {
    q("INSERT OR IGNORE INTO entitlements (id, user_id, issue_id, source, granted_at) VALUES (?,?,?,'free',?)", newId(), mainStudent, ic.id, iso(NOW - ri(2, 30) * DAY))
    q('INSERT OR REPLACE INTO reading_progress (user_id, issue_id, last_page, percent, updated_at) VALUES (?,?,?,?,?)', mainStudent, ic.id, ri(2, 8), ri(20, 90), iso(NOW - ri(1, 10) * DAY))
  }
  await flush()

  // ───────── views (aggregated analytics source; ~1 year, weekly + seasonal pattern) ─────────
  const weights = PUBS.map((p) => 1 + p[7] * 2)
  const wsum = weights.reduce((a, b) => a + b, 0)
  const pubIssues = pubIds.map((_, pi) => issueCards.filter((x) => x.pub === pi))
  const pubPosts = pubIds.map((_, pi) => postIds.filter((x) => x.pub === pi))
  let views = 0
  for (let d = 364; d >= 0; d--) {
    const t = NOW - d * DAY
    const wd = new Date(t).getDay() // Friday (5) is the Iranian weekend -> fewer visits
    const month = new Date(t).getMonth()
    const seasonal = month === 6 || month === 7 ? 0.45 : 1 // summer break dip
    const growth = 0.6 + (0.4 * (364 - d)) / 364
    const total = Math.round((wd === 5 ? 18 : wd === 4 ? 28 : 42) * seasonal * growth * (0.8 + rnd() * 0.4))
    for (let v = 0; v < total; v++) {
      let r = rnd() * wsum
      let pi = 0
      while (r > weights[pi]) r -= weights[pi++]
      const ts = t - ri(0, 23) * 3600_000
      const issues = pubIssues[pi].filter((x) => x.publishedAt! <= ts)
      const posts = pubPosts[pi].filter((x) => x.at <= ts)
      const kindR = rnd()
      let type = 'publication'
      let entity: string | null = pubIds[pi]
      if (kindR < 0.35 && posts.length) [type, entity] = ['post', pick(posts).id]
      else if (kindR < 0.65 && issues.length) [type, entity] = ['issue', pick(issues).id]
      else if (kindR < 0.85 && issues.length) [type, entity] = ['issue_read', pick(issues).id]
      const uid = rnd() < 0.5 ? pick(studentIds) : null
      q('INSERT INTO view_events (id, entity_type, entity_id, publication_id, viewer_hash, user_id, day, created_at) VALUES (?,?,?,?,?,?,?,?)',
        newId(), type, entity, pubIds[pi], uid ? 'u' + uid.slice(-10) : 'a' + ri(1, 900), uid, dayOf(ts), iso(ts))
      views++
    }
    if (queue.length > 2000) await flush()
  }
  await flush()
  log(`views: ${views}`)

  // ───────── communication: announcements, deadlines, recruitment, shelves ─────────
  q('INSERT INTO announcements (id, author_id, audience, title, body, pinned, created_at) VALUES (?,?,?,?,?,?,?)', newId(), officerId, 'all', 'جشنوارهٔ نشریات دانشجویی', 'مهلت ارسال آثار برای جشنوارهٔ امسال تا پایان آذر است. شماره‌های منتشرشده در سامانه به‌طور خودکار در فهرست داوری قرار می‌گیرند.', 1, iso(NOW - 6 * DAY))
  q('INSERT INTO announcements (id, author_id, audience, title, body, pinned, created_at) VALUES (?,?,?,?,?,?,?)', newId(), officerId, 'all', 'یادآوری تمدید مجوز', 'نشریاتی که مجوزشان تا سه ماه آینده منقضی می‌شود، مدارک تمدید را بارگذاری کنند.', 0, iso(NOW - 20 * DAY))
  q('INSERT INTO deadlines (id, title, due_at, description, created_at) VALUES (?,?,?,?,?)', newId(), 'پایان مهلت جشنواره', iso(NOW + 30 * DAY), 'ارسال آخرین شماره‌ها برای داوری', iso(NOW - 6 * DAY))
  q('INSERT INTO deadlines (id, title, due_at, description, created_at) VALUES (?,?,?,?,?)', newId(), 'گزارش نیم‌سال', iso(NOW + 12 * DAY), 'گزارش فعالیت هر نشریه در نیم‌سال جاری', iso(NOW - 3 * DAY))
  q('INSERT INTO recruitment_calls (id, publication_id, title, roles_needed, body, contact, open_until, created_at) VALUES (?,?,?,?,?,?,?,?)', newId(), pubIds[0], 'فراخوان جذب نویسنده و ویراستار', 'نویسنده،ویراستار', 'اگر به ادبیات علاقه دارید به تیم فرامتن بپیوندید.', '@faramatn_mag', iso(NOW + 25 * DAY), iso(NOW - 4 * DAY))
  q('INSERT INTO recruitment_calls (id, publication_id, title, roles_needed, body, contact, open_until, created_at) VALUES (?,?,?,?,?,?,?,?)', newId(), pubIds[8], 'به گرافیست نیازمندیم', 'گرافیست،تصویرگر', 'برای صفحه‌آرایی شماره‌های آینده الگوریتم.', '@algorithm_mag', iso(NOW + 15 * DAY), iso(NOW - 2 * DAY))
  const latest = [...issueCards].sort((a, b) => b.publishedAt! - a.publishedAt!)
  q('INSERT INTO featured_shelves (id, title, issue_ids_json, sort_order, is_active, created_at) VALUES (?,?,?,?,1,?)', newId(), 'پیشنهاد مسئول نشریات', JSON.stringify(latest.slice(0, 8).map((x) => x.id)), 0, iso(NOW - 5 * DAY))
  q('INSERT INTO featured_shelves (id, title, issue_ids_json, sort_order, is_active, created_at) VALUES (?,?,?,?,1,?)', newId(), 'رایگان بخوانید', JSON.stringify(latest.filter((x) => x.pricing === 'free').slice(0, 8).map((x) => x.id)), 1, iso(NOW - 5 * DAY))
  // ───────── audit log samples (so «گزارش رویدادها» is never empty on a fresh demo) ─────────
  const AUDIT: [string, string, string | null, number, unknown, unknown][] = [
    ['settings.update', 'settings', null, 60, { registration_open: false }, { registration_open: true }],
    ['category.create', 'category', null, 55, null, { name: 'محیط زیست' }],
    ['shelf.save', 'shelf', null, 5, null, { title: 'پیشنهاد مسئول نشریات' }],
    ['announcement.create', 'announcement', null, 6, null, { title: 'جشنوارهٔ نشریات دانشجویی' }],
    ['announcement.create', 'announcement', null, 20, null, { title: 'یادآوری تمدید مجوز' }],
    ['user.create', 'user', null, 90, null, { username: 'analyst', system_role: 'analyst' }],
    ['user.password_reset', 'user', null, 14, null, null]
  ]
  pubIds.slice(0, 12).forEach((pid, i) => {
    AUDIT.push(['publication.create', 'publication', pid, 300 - i * 9, null, { title: PUBS[i][1] }])
    if (i % 3 === 0) AUDIT.push(['publication.update', 'publication', pid, 40 - i, { license_number: null }, { license_number: `۱۴۰۴/${120 + i}` }])
    if (i % 4 === 1) AUDIT.push(['publication.role_change', 'publication', pid, 30 - i, { role: 'editor_in_chief' }, { role: 'editor_in_chief', holder: 'سردبیر جدید' }])
  })
  for (const [action, type, entity, daysAgo, before, after] of AUDIT)
    q('INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, before_json, after_json, created_at) VALUES (?,?,?,?,?,?,?,?)',
      newId(), action.startsWith('settings') || action.startsWith('user.create') ? adminId : officerId, action, type, entity,
      before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, iso(NOW - daysAgo * DAY - ri(1, 20) * 3600_000))
  log(`audit samples: ${AUDIT.length}`)

  await flush()
  log(`done: ${PUBS.length} publications, ${issueCards.length} published issues`)
}
