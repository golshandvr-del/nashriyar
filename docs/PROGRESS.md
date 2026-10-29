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
  - [ ] src/web/main.tsx (Router + lazy برای team/admin)
  - [ ] src/web/public/*: Layout(BottomNav) Home Explore Post Categories Category Faculty Search Publication Issue Reader Library Redeem Following Notifications Login Register Settings Verify Recruitment
  - [ ] src/web/team/*: Layout Select Dashboard Members Issues IssueNew IssueRoom(تب‌ها: کلی/فهرست/پیشرفت/رسانه و انتشار/تأیید) Posts Comments Sales Stats Profile Recruit
  - [ ] src/web/admin/*: Layout Overview Live Approvals Publications PublicationNew PublicationDetail People Structure Categories Analytics(Charts با echarts) Insights Moderation Storefront Announcements Users Audit Settings
- [ ] ecosystem.config.cjs ؛ Dockerfile ؛ deploy/ ؛ .github/workflows/ci.yml ؛ tests/

## نکات کشف‌شده (برای جلوگیری از تکرار)
- تست سریع بک‌اند: `node scripts/build-server.mjs && node server-dist/node.mjs --seed && setsid -f node server-dist/node.mjs > /tmp/srv.log 2>&1 < /dev/null; node tests/smoke.mjs`
- مسیر بازخرید کد: `POST /api/me/codes/redeem` ؛ هش کد = sha256(normalizePurchaseCode(code)).
- CSRF: درخواست‌های غیر GET باید هدر Origin هم‌دامنه داشته باشند.
- @hono/node-server v2: فایل‌های تایپ `.d.mts` هستند.
- داده‌ها در `data/` (gitignore) — `nashriyar.db` + `files/`.

## حساب‌های نمایشی (پس از seed)
- سوپرادمین: `admin` / `admin1234` — مسئول نشریات: `officer` / `officer1234`
- تیم نمونه: `pub1-director` / `team1234` (و `pub1-editor`، `pub1-holder`)
- دانشجو: `40012345` / `student1234`
- ناظر دانشکدهٔ فنی: `supervisor` / `super1234` — تحلیلگر: `analyst` / `analyst1234`
