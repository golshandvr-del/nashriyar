# راهنمای عملیات — نشریار

این سند برای مسئول فنی/مدیر سرور نوشته شده و همهٔ کارهای نصب، به‌روزرسانی، پشتیبان‌گیری، بازیابی و عیب‌یابی را پوشش می‌دهد.
نشریار با **یک کد** روی دو بستر اجرا می‌شود:

| بستر | ورودی | پایگاه داده | فایل‌ها |
|---|---|---|---|
| Cloudflare Pages (پیش‌نمایش/مرحلهٔ اول) | `dist/_worker.js` | D1 | R2 |
| هاست شخصی / سرور دانشگاه | `server-dist/node.mjs` | SQLite (`node:sqlite`، حالت WAL) | دیسک (`DATA_DIR/files`) |

---

## ۱. پیش‌نیازها

- **هاست شخصی:** لینوکس (Ubuntu 22.04+ یا Debian 12)، Docker و Docker Compose v2؛ حداقل ۲ هستهٔ CPU، ۴ گیگابایت RAM، ۸۰ گیگابایت SSD + فضای فایل‌ها.
- بدون Docker: **Node.js ≥ 22.13** (به‌خاطر `node:sqlite`).
- یک دامنه (مثلاً `nashriyat.<university>.ac.ir`) که رکورد A آن به IP سرور اشاره کند.
- درگاه‌های ۸۰ و ۴۴۳ باز.

---

## ۲. نصب روی سرور با Docker (روش پیشنهادی)

```bash
git clone https://github.com/golshandvr-del/nashriyar.git /opt/nashriyar
cd /opt/nashriyar

# ۱) متغیرهای محیطی
cp .env.example .env.production
# APP_SECRET را مقداردهی کنید:
sed -i "s|^APP_SECRET=.*|APP_SECRET=$(openssl rand -base64 48 | tr -d '\n')|" .env.production

# ۲) دامنه را در پیکربندی Nginx جایگزین کنید
sed -i 's/nashriyar.example.ac.ir/nashriyat.YOUR-UNI.ac.ir/g' deploy/nginx.conf
```

### ۲-۱. صدور اولین گواهی TLS

Nginx بدون گواهی بالا نمی‌آید؛ بنابراین اولین گواهی را با حالت standalone صادر کنید (پیش از روشن کردن Nginx):

```bash
docker compose run --rm -p 80:80 --entrypoint certbot certbot \
  certonly --standalone -d nashriyat.YOUR-UNI.ac.ir --email it@YOUR-UNI.ac.ir --agree-tos --no-eff-email
```

تمدید بعدی خودکار است (سرویس `certbot` هر ۱۲ ساعت `certbot renew` اجرا می‌کند). پس از هر تمدید، Nginx را بازخوانی کنید (در cron میزبان):

```cron
0 4 * * * cd /opt/nashriyar && docker compose exec -T nginx nginx -s reload
```

### ۲-۲. راه‌اندازی

```bash
docker compose up -d --build
docker compose ps                 # app باید healthy باشد
curl -fsS https://nashriyat.YOUR-UNI.ac.ir/api/health
```

پایگاه داده در اولین اجرا خودکار ساخته و مهاجرت‌ها اعمال می‌شوند.

### ۲-۳. ساخت سوپرادمین اولیه

سامانه حساب پیش‌فرض تولیدی ندارد. سوپرادمین فقط از **خط فرمان** ساخته می‌شود (نه از رابط کاربری):

```bash
docker compose exec app node server-dist/node.mjs --create-admin admin
# خروجی: نام کاربری + رمز یک‌بارمصرف تصادفی؛ در اولین ورود تغییر رمز اجباری است
```

همین فرمان برای سوپرادمینی که رمزش را فراموش کرده، رمز را بازنشانی و همهٔ نشست‌هایش را باطل می‌کند.
سپس از «پنل مدیریت ← کاربران» حساب «مسئول نشریات» را بسازید و از «پنل مدیریت ← ساختار» دانشکده‌ها و انجمن‌ها را تعریف کنید.

**فقط برای محیط آزمایشی/نمایشی** می‌توانید دادهٔ نمونه بارگذاری کنید (همهٔ داده‌ها پاک می‌شوند!):

```bash
docker compose run --rm app node server-dist/node.mjs --seed
```

حساب‌های نمایشی پس از seed: `admin / admin1234` (سوپرادمین)، `officer / officer1234` (مسئول نشریات) و … — فهرست کامل در `docs/PROGRESS.md`.

---

## ۳. نصب بدون Docker

```bash
npm ci
npm run build                     # dist/ (SPA + worker) و server-dist/node.mjs
cp .env.example .env.production   # و مقداردهی
set -a; . ./.env.production; set +a
node server-dist/node.mjs --migrate
node server-dist/node.mjs         # پیش‌فرض: 0.0.0.0:3000، داده در ./data
```

برای اجرای دائمی از systemd استفاده کنید:

```ini
# /etc/systemd/system/nashriyar.service
[Unit]
Description=Nashriyar
After=network.target

[Service]
WorkingDirectory=/opt/nashriyar
EnvironmentFile=/opt/nashriyar/.env.production
ExecStart=/usr/bin/node server-dist/node.mjs
Restart=always
User=nashriyar

[Install]
WantedBy=multi-user.target
```

سپس Nginx را با همان `deploy/nginx.conf` (با `server 127.0.0.1:3000` به‌جای `app:3000`) جلوی آن قرار دهید.

---

## ۴. استقرار روی Cloudflare Pages

```bash
npx wrangler d1 create nashriyar-production       # database_id را در wrangler.jsonc بگذارید
npx wrangler r2 bucket create nashriyar-media
npm run db:migrate:prod
npx wrangler pages secret put APP_SECRET --project-name nashriyar
npm run deploy:cf
```

- فایل `public/_headers` سرآیندهای امنیتی (CSP سخت‌گیرانه، HSTS) و کش فایل‌های استاتیک را تنظیم می‌کند.
- `dist/_routes.json` فقط `/api/*` را به Worker می‌فرستد؛ بقیه را Pages سرو می‌کند.
- Cron لازم نیست: تجمیع آمار به‌صورت تنبل (lazy rollup) هنگام درخواست‌ها انجام می‌شود.

---

## ۵. متغیرهای محیطی

| متغیر | پیش‌فرض | توضیح |
|---|---|---|
| `APP_SECRET` | تولید خودکار و ذخیره در DB | کلید HMAC نشست‌ها، URLهای امضاشدهٔ رسانه و توکن کتاب‌خوان (≥ ۱۶ نویسه). **تغییر آن همهٔ نشست‌ها را باطل می‌کند.** |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | درگاه شنود |
| `DATA_DIR` | `data` | محل `nashriyar.db`، `files/` و `backups/` |
| `STATIC_DIR` | `dist` | خروجی SPA |
| `BACKUP_KEEP_DAYS` | `30` | مدت نگهداری پشتیبان‌ها |
| `BACKUP_OFFSITE_DIR` | خالی | مسیر دوم (مثلاً دیسک جدا، NFS یا mount شده با rclone) که هر پشتیبان DB و فایل‌ها بلافاصله در آن هم کپی می‌شود |
| `PDF_RENDERER` | خالی | خالی ⇒ اگر `pdftoppm` (بستهٔ `poppler-utils`، در ایمیج Docker موجود) نصب باشد، تبدیل PDF به تصویر صفحات **روی سرور** انجام می‌شود؛ `browser` ⇒ همیشه در مرورگر بارگذارکننده (pdf.js). بدون Docker: `apt install poppler-utils` |
| `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` | خالی | لایهٔ اختیاری هوش مصنوعی (سازگار با OpenAI). خالی ⇒ بخش‌های AI پنهان |

---

## ۶. پشتیبان‌گیری

### زمان‌بند داخلی (پیش‌فرض)
نسخهٔ Node یک **زمان‌بند درون‌فرایندی** دارد که جایگزین کارهای «تنبل» نسخهٔ Cloudflare می‌شود:
- هر ۱۵ دقیقه `runMaintenance` (`src/server/lib/maintenance.ts`): تجمیع روزانهٔ آمار بازدید، یادآور مهلت‌ها و مجوزها (روزی یک‌بار)، حذف نشست‌های منقضی، کش تحلیل و پنجره‌های محدودیت ورود. گزارش آخرین اجرا در تنظیم `maintenance_last` ذخیره می‌شود.
- روزی یک‌بار در ساعت `BACKUP_HOUR` (پیش‌فرض ۳ بامداد به وقت سرور) پشتیبان پایگاه داده در `DATA_DIR/backups`.
- `CRON=off` زمان‌بند را خاموش می‌کند؛ در آن صورت از crontab میزبان استفاده کنید: `--maintenance` (هر ساعت) و `--backup` (هر شب).

### پایگاه داده (روزانه)
فرمان `--backup` با `VACUUM INTO` یک نسخهٔ **سازگار و فشرده** از پایگاه داده می‌سازد، حتی وقتی سرور در حال کار است، و نسخه‌های قدیمی‌تر از `BACKUP_KEEP_DAYS` را حذف می‌کند:

```cron
# crontab میزبان — هر شب ساعت ۳
0 3 * * * cd /opt/nashriyar && docker compose exec -T app node server-dist/node.mjs --backup >> /var/log/nashriyar-backup.log 2>&1
```

بدون Docker: `npm run backup`.

### فایل‌ها (هفتگی) و نسخهٔ خارج از سرور
زمان‌بند داخلی در روزهای جمعه علاوه بر پشتیبان DB، فرمان `backupFiles` (`--backup-files` / `npm run backup:files`) را هم اجرا می‌کند که پوشهٔ `DATA_DIR/files` را در `DATA_DIR/backups/nashriyar-files-*.tar.gz` فشرده می‌سازد و نسخه‌های قدیمی‌تر از `BACKUP_KEEP_DAYS` را پاک می‌کند. اگر `BACKUP_OFFSITE_DIR` تنظیم شده باشد، هر دو فایل (`.db` و `.tar.gz`) بلافاصله به مقصد خارج از سرور نیز کپی می‌شوند.

برای اجرای دستی یا با crontab میزبان:
```bash
node server-dist/node.mjs --backup-files   # یا: npm run backup:files
```

### آزمون خودکار و دستی بازیابی
فرمان `--restore-test` (`npm run backup:test` — همچنین پس از هر پشتیبان روزانهٔ زمان‌بند داخلی اجرا می‌شود) آخرین پشتیبان DB را به‌صورت فقط‌خواندنی باز می‌کند، `PRAGMA integrity_check` را اجرا می‌کند، شمارش ردیف‌های ۸ جدول اصلی را با پایگاه دادهٔ زنده مقایسه می‌کند، وجود همهٔ فایل‌های ارجاع‌شده روی دیسک را می‌سنجد و نتیجه را در `DATA_DIR/backups/restore-test.json` می‌نویسد (در صورت هر خطا با کد ۱ خارج می‌شود). علاوه بر این آزمون خودکار، ماهانه یک پشتیبان را روی ماشین دیگری بازیابی کامل کنید (بخش ۷).

---

## ۷. بازیابی

```bash
docker compose stop app
# فهرست پشتیبان‌ها
docker compose run --rm --entrypoint ls app /data/backups
# جایگزینی پایگاه داده (فایل‌های WAL قدیمی را حذف کنید)
docker compose run --rm --entrypoint sh app -c \
  'cp /data/backups/nashriyar-YYYY-MM-DDTHH-MM-SS.db /data/nashriyar.db && rm -f /data/nashriyar.db-wal /data/nashriyar.db-shm'
# فایل‌ها (در صورت نیاز)
docker run --rm -v nashriyar_nashriyar-data:/data -v /srv/backup:/in alpine \
  sh -c 'cd /data && tar -xzf /in/nashriyar-files-YYYY-MM-DD.tar.gz'
docker compose start app
```

---

## ۸. به‌روزرسانی و بازگشت

```bash
cd /opt/nashriyar
docker compose exec -T app node server-dist/node.mjs --backup   # همیشه پیش از به‌روزرسانی
git fetch --tags && git checkout v1.x.y                         # یا: git pull
docker compose up -d --build
curl -fsS https://nashriyat.YOUR-UNI.ac.ir/api/health
```

- مهاجرت‌های پایگاه داده هنگام راه‌اندازی خودکار و فقط‌افزایشی‌اند.
- **بازگشت (rollback):** `git checkout <نسخهٔ قبلی> && docker compose up -d --build`؛ اگر نسخهٔ جدید مهاجرت ناسازگار داشته، پایگاه داده را هم از پشتیبان پیش از به‌روزرسانی بازیابی کنید.
- Service Worker نسخهٔ جدید را در بازدید بعدی کاربران فعال می‌کند (`sw.js` و `index.html` کش نمی‌شوند).

### بازهٔ تعمیر برنامه‌ریزی‌شده
۱. از «پنل مدیریت ← اطلاعیه‌ها» یک اطلاعیهٔ سنجاق‌شده برای همه منتشر کنید. ۲. پشتیبان بگیرید. ۳. به‌روزرسانی/مهاجرت. ۴. بررسی `/api/health` و ورود با یک حساب آزمایشی.

در مدتی که کانتینر `app` متوقف است یا دوباره راه‌اندازی می‌شود، Nginx به‌جای خطای ۵۰۲ صفحهٔ «سامانه در حال به‌روزرسانی است» (`public/maintenance.html`، با `Retry-After` و بازخوانی خودکار هر ۶۰ ثانیه) را نشان می‌دهد. برای بازهٔ طولانی‌تر: `docker compose stop app`.

---

## ۹. پایش

| مورد | روش |
|---|---|
| سلامت | `GET /api/health` ⇒ `{ ok, db, latency_ms }`؛ در صورت خرابی DB کد **503**. Docker HEALTHCHECK و کار CI همین را بررسی می‌کنند. |
| لاگ‌ها | `docker compose logs --since 1h app` (خطاهای کنترل‌نشده با پیشوند `[nashriyar] unhandled error`) |
| دیسک | `df -h` و `du -sh /var/lib/docker/volumes/nashriyar_nashriyar-data` — هشدار در ۸۰٪ |
| زمان پاسخ | یک پایشگر بیرونی (مثلاً Uptime Kuma) روی `/api/health` با هشدار تلگرام/بله/ایمیل |
| ممیزی | «پنل مدیریت ← ممیزی» همهٔ تغییرات حساس (نقش‌ها، رمزها، تنظیمات، پنهان‌سازی) را با کاربر و زمان نشان می‌دهد |

---

## ۱۰. امنیت عملیاتی

- `.env.production` و پوشهٔ `data/` هرگز وارد git نمی‌شوند (`.gitignore` و `.dockerignore`).
- کانتینر برنامه با کاربر غیر root (`node`) اجرا می‌شود و فقط درگاه داخلی ۳۰۰۰ را در شبکهٔ Compose باز می‌کند.
- Nginx هدرهای IP کلاینت را **بازنویسی** می‌کند (نه الحاق) تا محدودیت نرخ ورود با جعل هدر دور زده نشود.
- CSP بدون اسکریپت درون‌خطی و بدون منبع خارجی؛ فونت‌ها self-host هستند.
- محتوای پولی هرگز در Service Worker یا کش مرورگر ذخیره نمی‌شود (`/api/*` با `Cache-Control: no-store`).
- CI در هر push اسکن اسرار (gitleaks) اجرا می‌کند.

---

## ۱۱. عیب‌یابی

| نشانه | علت محتمل و راه‌حل |
|---|---|
| `app` در وضعیت `unhealthy` | `docker compose logs app`؛ معمولاً دسترسی نوشتن روی ولوم `/data` یا پر بودن دیسک |
| Nginx بالا نمی‌آید: `cannot load certificate` | گواهی هنوز صادر نشده — بخش ۲-۱ |
| `413 Request Entity Too Large` | `client_max_body_size` در `deploy/nginx.conf` (پیش‌فرض ۱۰۰m؛ سقف برنامه ۹۵ مگابایت) |
| ورود ناموفق با «درخواست نامعتبر» | محافظت CSRF: درخواست‌های غیر GET باید Origin هم‌دامنه داشته باشند؛ نشانی سایت و پروکسی را بررسی کنید (`Host` باید حفظ شود) |
| همهٔ کاربران ناگهان خارج شدند | `APP_SECRET` تغییر کرده است |
| `database is locked` | فرایند دیگری فایل DB را باز کرده (مثلاً ابزار SQLite دستی)؛ فقط از `--backup` استفاده کنید |
| تغییرات پس از به‌روزرسانی دیده نمی‌شود | یک‌بار صفحه را تازه کنید (Service Worker جدید فعال می‌شود) |
| `ExperimentalWarning: SQLite` در لاگ | عادی است و اثری ندارد |

---

## ۱۲. انتقال داده از Cloudflare به هاست شخصی

```bash
# ۱) خروجی D1
npx wrangler d1 export nashriyar-production --remote --output=d1.sql
# ۲) فایل‌های R2 (با rclone و پیکربندی S3 سازگار R2)
rclone copy r2:nashriyar-media ./r2-files
# ۳) ورود به سرور جدید (برنامه متوقف و DATA_DIR خالی باشد)
node scripts/import-cf.mjs --sql d1.sql --files ./r2-files --data /data
# با Docker:
#   docker compose run --rm -v $PWD:/in app node /in/scripts/import-cf.mjs --sql /in/d1.sql --files /in/r2-files --data /data
```

اسکریپت `scripts/import-cf.mjs` (`npm run import:cf`):
- پایگاه داده را از خروجی D1 می‌سازد (حالت WAL) و جدول‌های داخلی Cloudflare را حذف می‌کند؛
- هر شیء را با فایل همراه `.meta` (نوع محتوا) در `DATA_DIR/files` کپی می‌کند؛
- **تطبیق:** شمارش ردیف جداول اصلی، وجود همهٔ کلیدهای ارجاع‌شده در پایگاه داده (لوگو، جلد، PDF، صفحات، رسانه‌ها) و **چک‌سام SHA-256** هر فایل؛
- گزارش را در `DATA_DIR/import-report.json` می‌نویسد و در هر ناسازگاری با کد غیرصفر خارج می‌شود. اگر پایگاه داده از قبل وجود داشته باشد، بدون `--force` بازنویسی نمی‌کند.

پس از ورود، برنامه را روشن کنید؛ مهاجرت‌های جدیدتر هنگام راه‌اندازی خودکار اعمال می‌شوند.

سپس DNS را به سرور جدید تغییر دهید و نشانی پیش‌نمایش Cloudflare را با یک Redirect Rule به دامنهٔ جدید هدایت کنید.
