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
- [ ] src/server/routes/admin.ts, analytics.ts, media.ts
- [ ] src/server/insights.ts (موتور بینش قاعده‌محور)
- [ ] src/server/ai.ts (AIProvider اختیاری؛ Null پیش‌فرض)
- [ ] src/server/seed.ts (دادهٔ نمونه: ۶ دانشکده، ۱۵ انجمن، ۲۰ نشریه، ~۸۰ شماره، صفحات SVG)
- [ ] src/server/app.ts ؛ src/entry/cloudflare.ts ؛ src/entry/node.ts ؛ scripts/build-server.mjs
- [ ] src/web/* (React SPA: public / team / admin)
- [ ] ecosystem.config.cjs ؛ Dockerfile ؛ deploy/ ؛ .github/workflows/ci.yml ؛ tests/

## حساب‌های نمایشی (پس از seed)
- سوپرادمین: `admin` / `admin1234` — مسئول نشریات: `officer` / `officer1234`
- تیم نمونه: `pub1-director` / `team1234` (و `pub1-editor`، `pub1-holder`)
- دانشجو: `40012345` / `student1234`
