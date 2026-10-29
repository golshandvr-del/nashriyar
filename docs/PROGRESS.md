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
