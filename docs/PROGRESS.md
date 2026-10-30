# PROGRESS — حافظهٔ کاری توسعه (برای ادامه پس از ریست محیط)

> این فایل پس از هر گام مهم به‌روزرسانی می‌شود تا هر توسعه‌دهنده/دستیار بتواند دقیقاً از همان نقطه ادامه دهد.

## بازیابی محیط پس از ریست
1. `git clone https://github.com/golshandvr-del/nashriyar.git /home/user/webapp` (اعتبارنامه در credential store سندباکس)
2. `cd /home/user/webapp && npm install`
3. تابع چک‌پوینت: `ck(){ cd /home/user/webapp && git add -A && git commit -qm "$1" && git push -q origin main; git status -sb|head -1; }`
4. ساخت و اجرا: `npm run build && npm run db:reset && pm2 start ecosystem.config.cjs` (پورت 3000)

## تصمیم‌های پیاده‌سازی (خلاصه؛ جزئیات در docs/DECISIONS.md)
- تک‌پکیج (نه monorepo): `src/server` (Hono API)، `src/web` (React SPA)، `src/shared` (کد مشترک)، `src/entry` (cloudflare/node).
- پایگاه داده: SQL خام پشت interface سادهٔ `Db` (D1 در Cloudflare، `node:sqlite` در هاست شخصی). مهاجرت‌ها در `migrations/`.
- ذخیرهٔ فایل: interface `Storage` (R2 / دیسک محلی).
- Build: Vite برای SPA ← `dist/`؛ esbuild برای `dist/_worker.js` و `server/node.mjs`.

## وضعیت فازها
- فاز ۰: در حال انجام

## نقشهٔ فایل‌های کد (هدف) — علامت [x] یعنی نوشته و push شده
- [x] migrations/0001_init.sql (۴۶ جدول)
- [x] src/shared/fa.ts (نرمال‌سازی فارسی، اعداد، تقویم شمسی، بازه‌های پیش‌فرض)
- [x] src/server/adapters/db.ts (D1 + node:sqlite)
- [x] src/server/adapters/storage.ts (R2 + disk + memory)
- [x] src/server/lib/crypto.ts (PBKDF2، HMAC، کد خرید NSH-XXXX-XXXX)
- [x] src/server/context.ts (انواع و نقش‌ها)
- [x] src/server/lib/util.ts
- [x] src/server/migrate.ts
- [x] src/server/auth.ts (نشست کوکی، CSRF، requireRole، requirePubAccess، محدودیت نرخ)
- [x] src/server/app.ts (createApp؛ mount همهٔ routeها)
- [x] src/server/routes/auth.ts, public.ts (trackView اینجاست), me.ts, reader.ts, team.ts
- [x] src/server/routes/admin.ts
- [x] src/server/routes/analytics.ts, media.ts (آپلود با magic bytes، صفحات با resume، سرو کنترل‌شده /api/media/k/<key>)
- [x] src/server/insights.ts (موتور بینش قاعده‌محور)
- [x] src/server/ai.ts (AIProvider اختیاری؛ Null پیش‌فرض)
- [x] src/server/seed.ts (۶ دانشکده، ۱۵ انجمن، ۲۰ نشریه، ۵۰ شمارهٔ منتشرشده، ۶۸ پست، ~۹۵۰۰ بازدید؛ کد نمایشی NSH-DEMO-2026)
- [x] src/server/secret.ts ؛ src/entry/cloudflare.ts ؛ src/entry/node.ts ؛ scripts/build-server.mjs
- [x] tests/smoke.mjs — همهٔ GET ها با ۶ نقش؛ **همه پاس** (۱۴۰۵/۰۸/۰۷)
- [ ] src/web/* (React SPA) — نقشهٔ فایل‌ها (به ترتیب نوشتن):
  - [x] index.html (ریشه، اسکریپت ضدچشمک تم) ؛ src/web/styles.css (Tailwind 4 + توکن‌ها + وزیرمتن FD محلی)
  - [x] src/web/lib/api.ts (api.get/post/put/del، qs، upload با XHR، mediaUrl) ؛ lib/auth.tsx (AuthProvider/useAuth، ROLE_LABEL، isAdmin/isMonitor) ؛ lib/theme.ts ؛ lib/format.ts (برچسب‌ها + cx + fileSize)
  - [x] src/web/components/ui.tsx (useAsync، Async، Button، Card، Field، Input/Textarea/Select، Badge، Modal، ToastProvider/useToast(toast, confirm)، useAction، Tabs، PageHeader، Stat، Progress، Avatar، Empty، ErrorBox) ؛ components/cards.tsx (Cover، IssueCard، IssueGrid، Shelf، PubCard، PostTile، PostGrid، PostCard)
  - مسیرهای SPA: / ، /explore ، /post/:id ، /categories ، /c/:slug ، /faculty/:id ، /search ، /p/:slug ، /issue/:id ، /read/:id ، /library ، /redeem ، /following ، /notifications ، /login ، /register ، /settings ، /verify/:code ، /recruitment ، /team/* ، /admin/*
  - [x] src/web/main.tsx (Router + lazy؛ /read/:id خارج از Layout؛ /team/* و /admin/* وصل شده‌اند)
  - [x] src/web/public/*: Layout Home Explore Post Categories Category(+faculty) Search Publication Issue Reader Library Redeem Following Notifications Login Register Settings Verify Recruitment Static(NotFound, Terms)
  - [x] src/web/team/*: Layout(+TeamSelect) Dashboard Members Issues IssueNew IssueRoom(+room/TocTab ProgressTab MediaTab PublishTab) Posts(+highlights) Comments Sales(codes+print) Stats(+RangePicker/defaultRange صادرشده) Profile Recruit — مسیرها در main.tsx وصل شد (commit 124)
  - [x] src/web/lib/pdf.ts (pdf.js→WebP) ؛ lib/image.ts (برش/فشرده‌سازی/حذف EXIF) ؛ components/Chart.tsx (ECharts tree-shaken، تم، CSV؛ downloadCsv صادرشده)
  - [x] src/web/admin/*: Layout(+RequireAccess, useAdminRole, canAccess) Overview(+DeltaBadge, SEVERITY_*) Live Approvals Publications PublicationNew(+CredentialsSheet صادرشده) PublicationDetail IssueDetail People(+AdminPerson) Structure Categories Analytics Insights(+AI) Moderation Storefront Announcements(+مهلت‌ها) Users Audit Settings — مسیرهای /admin/* با Guard در main.tsx وصل شد (commit ~149)؛ tsc و vite build سبز
- [ ] ecosystem.config.cjs ؛ Dockerfile ؛ deploy/ ؛ .github/workflows/ci.yml ؛ tests/

## نکات کشف‌شده (برای جلوگیری از تکرار)
- pdfjs-dist v6: `destroy()` روی loadingTask است نه PDFDocumentProxy.
- انجام‌شده (گفتگوی ۱۰): theme-init.js خارجی، sw.js، offline.html، ثبت SW، public/_headers (CSP)، pdf.js isEvalSupported=false، CSP در app.ts (export const CSP).
- انجام‌شده (گفتگوی ۱۱، commits 162–176): /api/health با پروب DB (503)، Dockerfile چندمرحله‌ای (runtime بدون node_modules)، .dockerignore، deploy/nginx.conf، docker-compose.yml (app+nginx+certbot)، .env.example، فلگ `--backup` (VACUUM INTO + حذف قدیمی‌تر از BACKUP_KEEP_DAYS) و `npm run backup`، scripts/test-e2e.mjs و `npm test` (seed موقت روی پورت 3999 + هر دو suite) — **پاس**، .github/workflows/ci.yml (typecheck/build/e2e/gitleaks/docker)، قالب‌های Issue و PR.
- pdfjs v6 گزینهٔ `isEvalSupported` را ندارد (حذف شد؛ v6 اصلاً eval ندارد).
- CI روی GitHub سبز است (typecheck/build/e2e + gitleaks + docker). docs/OPERATIONS.md نوشته شد. فلگ `--create-admin [username]` (رمز یک‌بارمصرف تصادفی) اضافه و تست شد.
- **ممیزی شکاف ROADMAP (گفتگوی ۱۱):** در کد وجود ندارد ⇒ باید به‌ترتیب پیاده شود (هر مورد جدا checkpoint):
  1. [x] publication_role_history ← لازم نیست: جدول publication_roles خودش با started_at/ended_at تاریخچه را نگه می‌دارد
  2. [x] فیلتر کامنت: src/server/lib/moderation.ts (flagComment) در me.ts — تست شد
  3. [x] SEO: /api/public/sitemap.xml و /robots.txt پویا + src/web/lib/meta.ts (useMeta: title/description/OG/canonical/JSON-LD) در Publication (Periodical) و Issue (PublicationIssue)
  4. [x] پیش‌بینی خطی: GET /api/analytics/forecast (termBounds + linearFit در shared/fa.ts) + تب «پیش‌بینی ترم» در admin/Analytics — تست شد
  5. [x] کارنامه: GET /api/analytics/scorecard/:id + admin/Scorecard.tsx (/admin/publications/:id/scorecard)؛ گزارش دوره‌ای: admin/Report.tsx (/admin/report، منوی پایش)؛ استایل چاپ A4 در styles.css
  6. [x] feature flags: src/server/lib/features.ts (getFeatures/sanitizeFeatures/requireFeature) + POST /api/admin/settings {feature_flags} فقط سوپرادمین + features در /api/public/settings + gate روی explore/posts/recruitment/certificates/comments/redeem/physical-sales + src/web/lib/features.ts (useFeature/usePublicSettings) و پنهان‌سازی UI — تست شد (403 هنگام خاموش)
  7. [x] حالت‌های ثبت‌نام ← طبق تصمیم کارفرما #۱ (ROADMAP) برای نسخهٔ اولیه توسعه داده نمی‌شود و به فاز ۱۲ منتقل شد؛ ثبت‌نام آزاد + سوییچ registration_open کافی است
  8. [x] TOTP: migrations/0002_totp.sql + src/server/lib/totp.ts (RFC 6238، تست‌برداری RFC پاس) + login با کد totp_required/totp_invalid و ضد replay + /api/auth/totp{,/setup,/enable,/disable} + کارت در /settings (فقط کارکنان) + POST /api/admin/users/:id/reset-totp + `--create-admin` 2FA را هم پاک می‌کند — تست شد
  9. [x] پالت فرمان Ctrl+K: src/web/components/CommandPalette.tsx (CommandPalette + PaletteButton، رویداد window `nashriyar:palette`) در admin/Layout (صفحه‌ها بر اساس نقش + جست‌وجوی زندهٔ نشریات) و team/Layout (صفحه‌ها + شمارهٔ جدید + تعویض نشریه) — tsc پاس
  10. [x] AI: GuardedProvider در src/server/ai.ts — سقف ماهانه `ai_monthly_call_limit` (۰=نامحدود)، ثبت مصرف `ai_usage` (calls/tokens/failures ماه جاری)، قطع‌کنندهٔ مدار `ai_breaker` (۳ خطا ← ۱۰ دقیقه توقف)؛ همه در جدول settings بدون مایگریشن؛ ai_status در GET /api/admin/settings و نمایش در admin/Settings — با سرور mock تست شد
  11. [x] (تصمیم) FTS5 ← ADR-012 در docs/DECISIONS.md ثبت شد (LIKE روی search_text نرمال‌شده؛ مسیر ارتقا: FTS5 trigram)
- بعد از شکاف‌ها: README/CHANGELOG ← تیک‌زدن ROADMAP ← بستن Milestoneها و Release v1.0.0.
- **گفتگوی ۱۵ (ادامه):** انجام‌شده: ai_timeout_sec در تنظیمات سوپرادمین + فیلد UI؛ .editorconfig؛ POST /api/team/:pubId/keywords/suggest + دکمهٔ «پیشنهاد کلیدواژه» در IssueNew؛ public/maintenance.html + error_page 502/503/504 در deploy/nginx.conf + mount در docker-compose + OPERATIONS؛ مسیر /privacy (همان Terms).
  - [x] آستانه‌ها/وزن‌ها: insights.ts (DEFAULT_THRESHOLDS/DEFAULT_WEIGHTS، getThresholds/getWeights، امتیاز نرمال ۰–۱۰۰) + GET/POST /api/admin/settings (insight_thresholds, health_weights؛ مسئول و سوپرادمین) + کارت در admin/Settings — تست شد (آستانهٔ پایین ۳۹ بینش، پیش‌فرض ۱۷، بالا ۵؛ دانشجو 403). پاسخ /api/analytics/insights کلید `items` دارد.
  - [x] حالت دوصفحه‌ای کتاب‌خوان (Reader.tsx: دکمهٔ Columns2، فقط ≥1024px، localStorage `nsh-reader-spread`، گام ۲ صفحه، صفحهٔ اول در راست)
  - [x] پایش نرخ صفحات کتاب‌خوان (reader.ts: checkPageRate روی login_attempts با کلید pages:<viewer>، ۹۰/دقیقه ← ۵ دقیقه 429 page_rate + activity reader.signal kind=rate) + throttle رفرش manifest در Reader.tsx
- **گفتگوی ۱۶ — یافته‌های ممیزی:** publication_roles (started_at/ended_at) = همان role_history ✔؛ QR هیچ‌جا پیاده نشده ✘؛ صفحهٔ مستقل انجمن، DnD دسته‌ها، نوار پایین موبایل: نیازمند بررسی؛ Milestoneهای ۱..۱۳ و برچسب‌های phase:* در GitHub موجود و همه open.
  - شکاف‌های کشف‌شده (grep): QR، حالت شب کتاب‌خوان، واترمارک نامرئی، Masonry اکسپلور، راهنمای کاربری درون‌سایت، صفحهٔ انجمن/کانون، Notifier (ایمیل Null)، .env.example، آزمون بار، قیف و سال‌به‌سال. نامعلوم: محدودیت نشست هم‌زمان، ثبت جلسهٔ خواندن، لینک کوتاه‌مدت رسانهٔ پولی، کد بازیابی/فهرست مجاز.
  - [x] حالت شب کتاب‌خوان (Reader.tsx: دکمهٔ Moon، localStorage `nsh-reader-night`، فیلتر invert روی canvas)
  - [x] .env.example (از قبل بود؛ بازنویسی + PORT/HOST/DATA_DIR/STATIC_DIR فعال) ؛ [x] src/server/lib/notifier.ts (Notifier/NullNotifier/setNotifier/deliverOutbound) + فراخوانی در notify() در lib/util.ts
  - [x] Masonry اکسپلور (cards.tsx: PostMasonry با CSS columns؛ Explore.tsx از آن استفاده می‌کند؛ PostGrid برای صفحهٔ نشریه باقی است)
  - [x] src/web/lib/qr.ts (qrEncode/qrSvg/qrDataUrl، بدون وابستگی) — با OpenCV رمزگشایی و تأیید شد (فارسی و نسخه‌های ۱..۲۹). تست: esbuild به /tmp/qr.mjs + cv2.QRCodeDetector.
  - [x] QR: Sales.tsx (QR هر کد تازه → /redeem#code=…)، Redeem.tsx (پیش‌پرکردن از fragment)، PublishTab.tsx (کارت PrintQr → /issue/:id + دانلود SVG)
  - [x] صفحهٔ انجمن/کانون: GET /api/public/associations/:id + مسیر /association/:id (Category kind=association) + لینک از صفحهٔ نشریه (association_id در payload)
  - [x] واترمارک نامرئی (گفتگوی ۱۷): reader.ts traceCode=HMAC(mark|user|issue)[:8] در manifest.mark؛ Reader.tsx embedMark (هدر 0xA5 + ۳۲ بیت در LSB کانال آبی، تکرار سراسری + متن شفاف ۲.۵٪)؛ POST /api/team/:pubId/issues/:issueId/trace؛ کارت TraceCard در PublishTab
  - [x] سقف نشست هم‌زمان: auth.ts createSession نشست‌های قدیمی‌تر از N تای آخر را revoke می‌کند؛ تنظیم max_sessions (۱..۲۰، پیش‌فرض ۵) در OFFICER_SETTINGS + فیلد در admin/Settings.tsx ؛ رمزگشای LSB مستند در SECURITY.md با پایتون تأیید شد
  - [x] قیف و سال‌به‌سال: /api/analytics/explore → funnel (post→issue→issue_read→purchase، viewer_hash یکتا) + کارت در ExploreStats؛ /api/analytics/trends → yoy {published, views} (کلید ماه +۱ سال) + نمودار در Trends
  - [x] راهنمای کاربری: Guide در public/Static.tsx (سه نقش: دانشجو، تیم، مسئول) + مسیر /guide + فوتر دسکتاپ در public/Layout.tsx (راهنما، قوانین، حریم خصوصی، استعلام گواهی)
  - [x] tests/load.mjs (+ npm run test:load؛ VUS/READERS/DURATION/P95_MS) ؛ build پاس، smoke پاس؛ تست زندهٔ قابلیت‌های جدید پاس (/tmp/new2.mjs: trace→40012345، کد غلط match=null، کد بد 400، دانشجو 403؛ max_sessions=2 قدیمی‌ترین نشست را 401 کرد؛ funnel 387/376/263/50؛ assoc 200/404)
  - [x] آزمون بار اجرا شد (Node، سندباکس، ۲۰ ثانیه): ۵۰۰ بازدیدکننده + ۵۰ خواننده → ۱۰۳۲۵ درخواست، ۰٪ خطا، p95=472ms، ~۴۶۰ req/s — PASS
  - **گفتگوی ۱۸ — شواهد تیک ROADMAP (grep):** تک‌پکیج/SQL خام (تصمیم مستند، نه monorepo/Drizzle)؛ strict=true، .editorconfig هست، ESLint/Prettier نیست؛ کشیدن‌ورها نیست (دکمهٔ بالا/پایین در TocTab و Categories)؛ Excel = CSV با BOM؛ نقشهٔ حرارتی و rollup روزانه نیست؛ ورود اعضای عادی نیست؛ جلسات خواندن = activity_events reader.signal؛ رسانهٔ پولی با بررسی entitlement در /api/media/k (نه لینک امضاشده)؛ بازیابی رمز = reset-password مسئول؛ پیش‌نمایش پیش از انتشار = دکمهٔ /read/:id در IssueRoom؛ pdftoppm/Cron/اسکریپت انتقال/Playwright/Lighthouse نیست؛ ۱۳ Milestone باز با ۰ issue؛ هیچ tag/release نیست.
  - [x] (گفتگوی ۱۸) Reader.tsx: تار شدن با visibilitychange + سیگنال DevTools (اختلاف outer/inner)
  - [x] (گفتگوی ۱۸) اکسپلور: درهم‌سازی تنوع در /api/public/explore (دو پست پیاپی از یک نشریه نه) + کلید next؛ Explore.tsx مکان‌نما = قدیمی‌ترین پست بارگذاری‌شده
  - [x] (گفتگوی ۱۸) /production → median_days + bottlenecks (نشریه×مرحله) + نمودار میانه و heatmap گلوگاه؛ /explore → hourly (روز×ساعت تهران +210min) + calendar + دو heatmap در ExploreStats
  - [x] (گفتگوی ۱۸) /trends → newPerYear + نمودار «نشریات جدید در هر سال»؛ /gaps → gap_window + factors (تغییر مدیرمسئول، ترک عضو، مرحلهٔ >۳۰ روز) در طولانی‌ترین فاصلهٔ غیرعادی (>۱.۵×دوره) + نمایش در جدول Gaps
  - [x] (گفتگوی ۱۸) tsc/build/smoke/admin-writes پاس؛ تست زنده (/tmp/s18.mjs): اکسپلور ۳۰ پست/۱۷ نشریه/۰ تکرار پیاپی، صفحهٔ ۲ بدون هم‌پوشانی؛ میانهٔ مراحل؛ ۱۶۸ خانهٔ heatmap؛ newPerYear؛ gaps با factors؛ ناظر محدود به ۲ نشریه
  - [x] (گفتگوی ۱۸) مقایسهٔ دو بازه: /api/analytics/trends?from2&to2 → compare{a,b,growth} + کارت UI در Trends (کد push شد؛ تست زنده در گفتگوی ۱۹)
  - نکتهٔ محیط: fuser نصب نیست؛ برای ری‌استارت سرور از `pkill -f "node server-dist/node.mjs"` استفاده کن
  - صف بعدی: تیک ROADMAP فاز به فاز (هر فاز یک commit) ← README/CHANGELOG ← لینک موقت ← tag v1.0.0 + Release + بستن Milestoneها
  - صف باقی‌مانده: تیک‌زدن صادقانهٔ ROADMAP (فاز به فاز) ← README/CHANGELOG 1.1 ← build/test نهایی ← لینک موقت عمومی (GetServiceUrl) برای کاربر ← tag v1.0.0 + GitHub Release + بستن Milestoneها
- **گفتگوی ۱۶:** شروع از commit 274 (f30ff6f). صف: تیک‌زدن صادقانهٔ ROADMAP (موارد زیرساختی فاز ۱۱ = «نیازمند کارفرما») ← build + npm test ← تگ v1.0.0 و GitHub Release.
- تست نوشتنی پنل مدیریت: `node tests/admin-writes.mjs` (پس از seed تازه) — **همه پاس** (commit ~152). پاسخ login فقط `{ok, home}` است؛ `must_change_password` در `/api/auth/me` → `user` است.
- `downloadCsv(name, csv)` فقط دو آرگومان می‌گیرد و خودش `.csv` اضافه می‌کند؛ `csvOf` در Analytics محلی است (صادر نشده).
- مسیر شمارهٔ admin: `issues/:id` (IssueDetail از `useParams().id` می‌خواند).
- Button فقط variant های primary | ghost | danger دارد.
- Tailwind 4: نمی‌توان کلاس سفارشی (مثل btn) را @apply کرد؛ یوتیلیتی‌ها را مستقیم بنویس.
- `npx vite build` (~۱ ثانیه) و `npx tsc --noEmit` هر دو پاس (۱۴۰۵/۰۸/۰۸، commit 103).
- برای db.first روی `c: any` آرگومان نوع (<any>) نگذار (TS2347).
- تست سریع بک‌اند: `node scripts/build-server.mjs && node server-dist/node.mjs --seed && setsid -f node server-dist/node.mjs > /tmp/srv.log 2>&1 < /dev/null; node tests/smoke.mjs`
- مسیر بازخرید کد: `POST /api/me/codes/redeem` ؛ هش کد = sha256(normalizePurchaseCode(code)).
- CSRF: درخواست‌های غیر GET باید هدر Origin هم‌دامنه داشته باشند.
- @hono/node-server v2: فایل‌های تایپ `.d.mts` هستند.
- داده‌ها در `data/` (gitignore) — `nashriyar.db` + `files/`.
- مسیر ذخیرهٔ تنظیمات ادمین **POST** `/api/admin/settings` است (نه PUT).
- در سندباکس `fuser` وجود ندارد؛ برای کشتن پورت از `ss -ltnp` استفاده کن (توابع killport/startsrv در ~/ck.sh).
- `npm test` نیاز به `npm run build` کامل قبلی دارد (dist/ و server-dist/).
- مایگریشن جدید: فایل در migrations/ + افزودن به آرایهٔ MIGRATIONS در src/server/migrate.ts.
- اجرای تست/بیلد طولانی در Bash: timeout ابزار را 300000+ بگذار (پیش‌فرض ۲ دقیقه است و حلقه‌های انتظار را می‌کشد).

## حساب‌های نمایشی (پس از seed)
- سوپرادمین: `admin` / `admin1234` — مسئول نشریات: `officer` / `officer1234`
- تیم نمونه: `pub1-director` / `team1234` (و `pub1-editor`، `pub1-holder`)
- دانشجو: `40012345` / `student1234`
- ناظر دانشکدهٔ فنی: `supervisor` / `super1234` — تحلیلگر: `analyst` / `analyst1234`
