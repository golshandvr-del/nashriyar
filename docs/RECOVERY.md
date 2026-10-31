# یادداشت بازیابی محیط (برای ادامهٔ کار پس از ریست سندباکس)

> این فایل برای ادامهٔ سریع توسعه پس از ریست شدن محیط نگه داشته می‌شود. پس از هر گام مهم به‌روز می‌شود.

## راه‌اندازی دوباره
```bash
git clone https://github.com/golshandvr-del/nashriyar.git /home/user/webapp
cd /home/user/webapp && npm install
npm run build && node server-dist/node.mjs --seed   # دادهٔ نمونه در data/
# اجرا: pm2 با فایل /tmp/ecosystem.config.cjs (نام فایل باید ecosystem.config.cjs باشد وگرنه pm2 آن را اسکریپت فرض می‌کند)
# module.exports={apps:[{name:'nashriyar',script:'server-dist/node.mjs',cwd:'/home/user/webapp',env:{PORT:3000,HOST:'0.0.0.0'}}]}
```
- آزمون مرورگر: `playwright` در `/tmp/pw` (اسکریپت‌های crawl/shot در عرض ۳۹۰px).
- حساب‌های نمایشی: `admin/admin1234` (مدیر کل)، `officer/officer1234` (مسئول نشریات)، `pub1-director/team1234` (مدیرمسئول نشریهٔ ۱).
- چرخهٔ چک‌پوینت: هر تغییر ← `git add` ← `commit` ← `push` (نگاه کنید به `AGENTS.md`).

## وضعیت فعلی رودمپ
- فاز ۰ تا ۱۰ کامل؛ فاز ۱۱ (انتقال دامنه) **معلق به درخواست کارفرما**.
- فازهای فعال: ۱۲ تا ۱۸ (از بازخورد کارفرما — ریشه‌یابی در `docs/AUDIT-1405-08.md`). فاز ۱۸ (Excel/چاپ) عمداً آخر است.

## نکات فنی کشف‌شده
- `defaultRange` در `src/web/team/Stats.tsx` است؛ پیش‌تنظیم‌ها در `src/shared/fa.ts` (`jalaliPresets`).
- کلیدهای سمت نشریه: `managing_director` / `editor_in_chief` / `license_holder` — منبع واحد: `src/shared/roles.ts`.
- `useAuth()` مقدار `publications` (سمت‌های کاربر) را می‌دهد؛ `isMonitor(user)` = دسترسی پنل مدیریت.
- ErrorBoundary (`src/web/public/Static.tsx`) با حالت `inline` دور `<Outlet/>` هر سه پوسته.
