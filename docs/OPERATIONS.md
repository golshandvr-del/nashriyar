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
| `DISK_WARN_PCT` | `85` | آستانهٔ هشدار پر شدن دیسک (درصد) در `/healthz` و پنل مدیریت |
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

## ۸. به‌روزرسانی، استقرار خودکار و بازگشت

### اسکریپت اتمی `deploy/deploy.sh`
```bash
cd /opt/nashriyar
./deploy/deploy.sh v1.2.0       # یا بدون آرگومان برای origin/main
./deploy/deploy.sh --rollback   # بازگشت فوری به آخرین نسخهٔ سالم (.last-good-rev)
```
این اسکریپت به‌طور خودکار: ۱) از پایگاه داده پشتیبان می‌گیرد (`--backup`)؛ ۲) کامیت فعلی را نگه می‌دارد؛ ۳) به نسخهٔ جدید می‌رود و کانتینر را می‌سازد (`DEPLOY_MODE=systemd` برای نصب بدون Docker)؛ ۴) تا ۳۰ ثانیه `/healthz` را بررسی می‌کند و اگر سالم نبود، **خودکار به کامیت قبلی بازمی‌گردد**؛ ۵) در صورت سلامت، کامیت قبلی را در `.last-good-rev` می‌نویسد.

### استقرار خودکار از GitHub Actions (`.github/workflows/deploy.yml`)
با ثبت تگ نسخه (`git tag v1.2.0 && git push --tags`) یا اجرای دستی (`workflow_dispatch` با گزینهٔ `ref` یا `rollback=true`)، ابتدا تایپ‌چک، تست‌ها و بیلد اجرا می‌شوند و سپس از طریق SSH فرمان `./deploy/deploy.sh` روی سرور فراخوانی می‌گردد. سکرت‌های ریپو: `DEPLOY_HOST`، `DEPLOY_USER`، `DEPLOY_SSH_KEY` (و اختیاری: `DEPLOY_PORT`، `DEPLOY_PATH`).

- مهاجرت‌های پایگاه داده هنگام راه‌اندازی خودکار و فقط‌افزایشی‌اند.
- Service Worker نسخهٔ جدید را در بازدید بعدی کاربران فعال می‌کند (`sw.js` و `index.html` کش نمی‌شوند).

### بازهٔ تعمیر برنامه‌ریزی‌شده
۱. از «پنل مدیریت ← اطلاعیه‌ها» یک اطلاعیهٔ سنجاق‌شده برای همه منتشر کنید. ۲. پشتیبان بگیرید. ۳. به‌روزرسانی/مهاجرت. ۴. بررسی `/api/health` و ورود با یک حساب آزمایشی.

در مدتی که کانتینر `app` متوقف است یا دوباره راه‌اندازی می‌شود، Nginx به‌جای خطای ۵۰۲ صفحهٔ «سامانه در حال به‌روزرسانی است» (`public/maintenance.html`، با `Retry-After` و بازخوانی خودکار هر ۶۰ ثانیه) را نشان می‌دهد. برای بازهٔ طولانی‌تر: `docker compose stop app`.

---

## ۹. پایش

| مورد | روش |
|---|---|
| سلامت | `GET /healthz` و `GET /api/health` ⇒ `{ ok, db, latency_ms, disk: { used_pct, free_bytes, warn }, requests: { total, errors_5xx, avg_ms, p95_ms } }`؛ در صورت خرابی DB کد **503**. Docker HEALTHCHECK و کار CI همین را بررسی می‌کنند. |
| خطاها و زمان پاسخ | `GET /api/admin/monitoring` (کارت «پایش سلامت سرور، دیسک و زمان پاسخ» در «پنل مدیریت ← تنظیمات»): میانگین، صدک ۹۵ (`p95`) و بیشینهٔ زمان پاسخ ۵۰۰ درخواست اخیر، شمارندهٔ خطاهای ۴xx/۵xx و فهرست ۲۵ خطای ۵xx اخیر (بدون دادهٔ شخصی). |
| دیسک | در نسخهٔ Node فضای دیسک `DATA_DIR` با `statfs` سنجیده می‌شود و در صورت عبور از `DISK_WARN_PCT` (پیش‌فرض ۸۵٪) در `/healthz` (`disk.warn = true`) و در پنل مدیریت بنر هشدار نشان داده می‌شود. |
| پایشگر بیرونی | یک پایشگر بیرونی (مثلاً Uptime Kuma) را روی `/healthz` تنظیم کنید تا در کد غیر ۲۰۰ یا `disk.warn == true` هشدار بفرستد. |
| ممیزی | «پنل مدیریت ← ممیزی» همهٔ تغییرات حساس (نقش‌ها، رمزها، تنظیمات، پنهان‌سازی) را با کاربر و زمان نشان می‌دهد |

### آزمون بار با دادهٔ ۱۰ ساله (ROADMAP فاز ۱۷)

```bash
npm run build
DATA_DIR=data-10y node server-dist/node.mjs --seed          # پایگاه جدا (data-*/ در git نادیده گرفته می‌شود)
node scripts/gen-10y.mjs data-10y                            # +۱۰۰ نشریه، ۵۰۰۰ شماره، ۱٬۰۰۰٬۰۰۰ بازدید در ۱۰ سال (~۳۰ ثانیه)
DATA_DIR=data-10y PORT=3000 node server-dist/node.mjs &
BASE=http://localhost:3000 VUS=200 READERS=20 ANALYSTS=5 DURATION=25 P95_MS=300 npm run test:load
```

- سناریوها: بازدیدکنندهٔ عمومی (خانه، اکسپلور، استوری، دسته‌ها، نشریات)، خوانندهٔ کتاب‌خوان (صفحه‌به‌صفحه با محدودیت ۹۰ صفحه در دقیقه) و مسئول نشریات روی ۱۰ گزارش تحلیلی (`ANALYSTS`، با کش گرم).
- نتیجهٔ مرجع (۲ هستهٔ CPU، ۱ گیگ RAM، آبان ۱۴۰۵): ۵۲۳۸ درخواست در ۲۸٫۷ ثانیه (۱۸۲ درخواست بر ثانیه)، **خطا ۰٪، p95 = ۸۵ میلی‌ثانیه** (هدف < ۳۰۰).
- کلید کارایی روی دادهٔ چندساله: گزارش‌ها روزهای تمام‌شده را از `view_daily` می‌خوانند و فقط دنبالهٔ تجمیع‌نشده را از `view_events` (`viewSeries` و `pubViewsSql` در `routes/analytics.ts`)؛ محاسبهٔ سرد «خلاصه» از ۱٫۳ ثانیه به ۰٫۱ ثانیه و «رتبه‌بندی» از ۰٫۵ به ۰٫۰۵ ثانیه رسید. اعداد با شمارش خام یکسان بررسی شد.

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

## ۱۳. دیجیتال‌سازی و آرشیو شماره‌های چاپی قدیمی (فاز ۱۹)

شماره‌هایی که پیش از سامانه چاپ شده‌اند، مستقیم توسط **مسئول نشریات** ثبت می‌شوند. این شماره‌ها از گردش‌کار تولید و تأیید تیم عبور نمی‌کنند.

1. **ثبت:** در پنل مدیریت، «آرشیو شماره‌های چاپی» (`/admin/print-archive`) و سپس «ثبت شمارهٔ قدیمی». این فیلدها وارد می‌شود:
   - نشریه، شمارهٔ ترتیبی و عنوان
   - تاریخ چاپ اصلی: سال الزامی است، ماه و روز اختیاری. برچسب آزاد هم ممکن است، مثل «پاییز ۱۳۷۸».
   - خلاصه، کلیدواژه‌ها و فهرست مطالب (هر خط یک مطلب، با `عنوان | ۲-۵`)
   - API: `POST /api/admin/print-archive`
2. **اسکن:** با دکمهٔ «بارگذاری اسکن» به تب «رسانه» در اتاق شماره بروید و PDF اسکن‌شده را بارگذاری کنید. در هاست شخصی، اگر poppler نصب باشد، تبدیل سمت سرور انجام می‌شود (`pdftoppm` + `pdftotext`)؛ در غیر این صورت در مرورگر با pdf.js. لایهٔ متنی هر صفحه در `issue_pages.text_content` ذخیره می‌شود و در جست‌وجوی تمام‌متن شرکت می‌کند. برای اسکن‌های بدون لایهٔ متنی، پیش از بارگذاری با ابزار OCR (مثل `ocrmypdf -l fas`) لایهٔ متن بسازید.
3. **انتشار:** «انتشار در آرشیو» (`POST /api/admin/print-archive/:id/publish`). نتیجهٔ آن:
   - `published_at` برابر تاریخ چاپ اصلی می‌شود.
   - اگر جلد تعیین نشده باشد، صفحهٔ اول جلد می‌شود.
   - مطالب فهرست شناسهٔ پایدار (`NSH-…`) می‌گیرند.
   - اعلان «شمارهٔ تازه» فرستاده **نمی‌شود** و شماره در قفسه‌های صفحهٔ اول نمی‌آید.

**صفحهٔ عمومی:** `/archive` با فیلتر نشریه، بازهٔ سال چاپ و جست‌وجوی متنی (`GET /api/public/print-archive?publication=&from=&to=&q=`). صفحهٔ شماره برچسب «آرشیو چاپی · تاریخ اصلی» دارد.

**جدول:** ستون‌های `issues.archival`، `original_date` و `original_label` (migration 0017). آزمون: بخش ۳ از `tests/future-e2e.mjs`.

## ۱۴. حالت متنی بازچینی‌پذیر و EPUB (فاز ۱۹)

- **حالت متنی کتاب‌خوان:** دکمهٔ «حالت متنی» (آیکون T) در نوار کتاب‌خوان، یا نشانی `/read/<id>?mode=text`. لایهٔ متنی صفحه‌ها (`issue_pages.text_content`) برای موبایل بازچینی می‌شود و اندازهٔ قلم قابل تنظیم است. عنوان مطالب فهرست سر صفحهٔ خودشان می‌آید. انتخاب حالت برای هر دستگاه به خاطر سپرده می‌شود.
- **API:** `GET /api/reader/<id>/text`
  - دقیقاً همان صفحه‌هایی را برمی‌گرداند که کتاب‌خوان تصویری اجازه می‌دهد. برای شمارهٔ پولی بدون خرید، فقط صفحه‌های پیش‌نمایش.
  - محدودیت نرخ صفحه‌ها روی آن هم اعمال می‌شود.
  - پاسخ با `Cache-Control: no-store` فرستاده می‌شود.
- **EPUB 3:** `GET /api/reader/<id>/epub`، **فقط برای شماره‌های رایگانی که لایهٔ متنی دارند**. نسخهٔ پولی هرگز به فایل قابل دانلود تبدیل نمی‌شود.
  - فایل هنگام درخواست با `src/shared/epub.ts` ساخته می‌شود: بدون وابستگی، روی `zip.ts`.
  - `mimetype` نخستین ورودی و بدون فشرده‌سازی است.
  - ستون فقرات راست‌به‌چپ است، `nav.xhtml` فهرست و page-list دارد، و برای هر صفحه یک XHTML ساخته می‌شود.
- اسکن‌های بدون لایهٔ متنی حالت متنی ندارند. پیش از بارگذاری با OCR (مثل `ocrmypdf -l fas`) لایهٔ متن بسازید.
- آزمون: بخش ۴ از `tests/future-e2e.mjs`، شامل اعتبارسنجی ساختار با `unzip -t`.

## ۱۵. نسخهٔ صوتی خودکار (TTS) — افزونهٔ هوش مصنوعی (فاز ۱۹)

- **کاربر:** در حالت متنی کتاب‌خوان، دکمهٔ «شنیدن» صفحه‌ها را از صفحهٔ جاری به بعد پشت سر هم می‌خواند و خودکار جلو می‌رود؛ «توقف» آن را قطع می‌کند.
- **سمت سرور (اختیاری):** در کنسول توسعه‌دهنده ← تنظیمات ← هوش مصنوعی: لایهٔ AI روشن + آدرس پایه و کلید، و «مدل TTS» (`ai_tts_model`، پیش‌فرض `tts-1`؛ `off` = خاموش) و «صدای TTS» (`ai_tts_voice`، پیش‌فرض `alloy`). هر سرویس سازگار با `POST {base}/audio/speech` (OpenAI و سازگارها) کار می‌کند.
- **API:** `GET /api/reader/<id>/speech/<n>` → `audio/mpeg`.
  - همان قاعدهٔ دسترسی تصویر صفحه: برای شمارهٔ پولی بدون خرید، فقط صفحه‌های پیش‌نمایش (`403 locked`). سقف نرخ صفحه‌ها هم اعمال می‌شود.
  - هر صفحه **یک بار** ساخته و در storage با کلید `tts/<issue>/<page>-<hash(model|voice|text)>.mp3` نگه داشته می‌شود؛ شنوندگان بعدی هزینه‌ای ندارند (هدر `X-TTS-Cache: hit|miss`). تغییر متن، مدل یا صدا فایل تازه می‌سازد.
  - مصرف در همان سقف ماهانه و «قطع‌کن مدار» لایهٔ AI حساب می‌شود. متن پیش از ارسال از الگوهای شخصی (شمارهٔ تلفن/دانشجویی، ایمیل) پاک می‌شود.
  - `503 tts_off` وقتی افزونه پیکربندی نشده؛ `502 tts_failed` وقتی سرویس‌دهنده خطا داد.
- **بدون افزونه:** مرورگر با Web Speech API (صدای فارسی دستگاه، در صورت وجود) می‌خواند؛ هیچ درخواستی به سرور زده نمی‌شود. فیلد `tts_server` در `GET /api/reader/<id>/text` تعیین می‌کند کدام مسیر استفاده شود.
- **پاک‌سازی کش:** پوشهٔ `tts/` در storage را می‌توان هر زمان حذف کرد؛ در درخواست بعدی دوباره ساخته می‌شود.
- آزمون: بخش ۵ از `tests/future-e2e.mjs` (با سرویس‌دهندهٔ ساختگی).

## ۱۶. اعلان از طریق ایمیل، بله و ایتا (فاز ۱۹)
- **اعلان درون‌برنامه‌ای همیشه برقرار است**؛ این کانال‌ها مسیر تحویل اضافه‌اند. هر `notify()` برای هر کانالِ تأییدشده و بی‌صدا‌نشدهٔ گیرنده یک ردیف در `outbound_queue` (migration 0018) می‌گذارد. صف **بعد از پاسخ** فرستاده می‌شود (`waitUntil` در Cloudflare، promise پس‌زمینه در Node) و نگهداری دوره‌ای (`--maintenance` / CRON) باقی‌مانده را با عقب‌نشینی نمایی (۲، ۴، ۸، … دقیقه؛ حداکثر ۵ تلاش) می‌فرستد. ردیف‌های فرستاده/ناموفق بعد از ۳۰ روز پاک می‌شوند.
- **پیکربندی (کنسول توسعه‌دهنده ← تنظیمات ← «اعلان در ایمیل، بله و ایتا»):**
  - `site_url`: نشانی عمومی سایت برای پیوندهای مطلق پیام‌ها (خالی = نشانی درخواست).
  - **ایمیل:** `notify_email_url` (پیش‌فرض `https://api.resend.com/emails`)، `notify_email_key`، `notify_email_from`. هر API ایمیل HTTP با شکل Resend (`POST` JSON `{from,to,subject,text,html}` + `Authorization: Bearer`) کار می‌کند؛ SMTP مستقیم پشتیبانی نمی‌شود (Workers سوکت SMTP ندارد).
  - **بله:** `notify_bale_token` (از @botfather بله)، `notify_bale_bot` (نام کاربری ربات برای پیوند `https://ble.ir/<bot>?start=<code>`)، `notify_bale_api` (پیش‌فرض `https://tapi.bale.ai`).
  - **ایتا:** `notify_eitaa_token` (ایتایار)، `notify_eitaa_api` (پیش‌فرض `https://eitaayar.ir/api`).
  - کلیدها و توکن‌ها فقط با چهار نویسهٔ آخر نمایش داده می‌شوند (`••••abcd`)؛ ذخیرهٔ مقدار پوشیده آن را تغییر نمی‌دهد. خالی گذاشتن کلید = کانال خاموش.
- **کاربر (تنظیمات حساب ← کارت «اعلان در ایمیل و پیام‌رسان‌ها»):**
  - ایمیل/ایتا: نشانی یا شناسه را وارد می‌کند، کد ۸ نویسه‌ای به همان‌جا فرستاده می‌شود و با واردکردن آن تأیید می‌شود (کد ۱۵ دقیقه اعتبار دارد، حساس به حروف نیست، به‌صورت هش ذخیره می‌شود).
  - بله: پیوند ربات (یا کد) نمایش داده می‌شود؛ کاربر `/start <code>` را در بله می‌فرستد. اتصال با **وب‌هوک** (`POST /api/channels/bale/webhook/<secret>`؛ نشانی کامل در وضعیت کنسول نمایش داده می‌شود و با `setWebhook` ثبت می‌شود) یا **بدون وب‌هوک** در نگهداری دوره‌ای با `getUpdates` انجام می‌شود.
  - بی‌صدا کردن موضوع‌ها برای هر کانال جدا (شماره‌ها، پست‌ها، نظرها، عضویت، گردش‌کار، جشنواره‌ها، وضعیت نشریه، اطلاعیه‌ها، یادآوری‌ها، سایر)، پیام آزمایشی، و قطع اتصال (پیام‌های ارسال‌نشدهٔ آن کانال هم حذف می‌شوند).
  - سقف ارسال کد: ۸ ارسال در ۱۵ دقیقه برای هر کاربر.
- **API:** `GET /api/channels`، `POST /api/channels/<email|bale|eitaa>/connect|verify|mute|test`، `DELETE /api/channels/<ch>`، `GET /api/channels/status` (فقط توسعه‌دهنده: فعال بودن کانال‌ها، تعداد کاربران متصل، شمارندهٔ صف، مسیر وب‌هوک).
- **عیب‌یابی:** شمارندهٔ «ناموفق» در وضعیت کنسول و ستون `error` در `outbound_queue` (مثلاً `http_401`، `channel_off`). گزارش `--maintenance` کلید `outbound` (`sent/failed/retry/purged/bale_linked`) دارد.
- آزمون: بخش ۶ از `tests/future-e2e.mjs` (سرویس‌دهنده‌های ساختگی ایمیل/بله/ایتا).

## ۱۷. ورود پیامکی (OTP) و ورود با حساب دانشگاه (SSO / OpenID Connect) (فاز ۱۹)

- **ورود با رمز عبور همیشه برقرار است**؛ این دو روش اختیاری‌اند و تا پیکربندی نشوند در صفحهٔ ورود دیده نمی‌شوند (`GET /api/signin/methods`).
- **پیکربندی (کنسول توسعه‌دهنده ← تنظیمات ← «ورود پیامکی و ورود با حساب دانشگاه»):**
  - **پیامک:** `sms_provider` = `off` | `http` | `kavenegar`.
    - `http`: درگاه عمومی — `POST {sms_api_url}` با JSON `{to, text, sender}` و `Authorization: Bearer {sms_api_key}`.
    - `kavenegar`: `sms_api_key` = کلید API کاوه‌نگار؛ اگر `sms_template` (نام قالب تأیید) پر باشد از `verify/lookup` و وگرنه از `sms/send` با `sms_sender` استفاده می‌شود. `sms_api_url` اختیاری است (پیش‌فرض `https://api.kavenegar.com`).
  - **SSO:** `sso_issuer` (نشانی صادرکنندهٔ OIDC؛ باید `/.well-known/openid-configuration` داشته باشد و `issuer` سند دقیقاً همین باشد)، `sso_client_id`، `sso_client_secret` (اختیاری؛ کلاینت محرمانه با `client_secret_basic`، کلاینت عمومی فقط با PKCE)، `sso_label` (متن دکمه)، `sso_scopes` (پیش‌فرض `openid profile email`)، `sso_student_claim` (claim حاوی شمارهٔ دانشجویی؛ پیش‌فرض `student_number`)، `sso_auto_create`.
  - **نشانی بازگشت** برای ثبت در سرور SSO: `{site_url}/api/signin/sso/callback` (در همان کارت کنسول نمایش داده می‌شود؛ `site_url` را تنظیم کنید تا پشت پراکسی درست ساخته شود).
  - `sms_api_key` و `sso_client_secret` فقط با چهار نویسهٔ آخر نمایش داده می‌شوند.
- **ورود پیامکی:**
  - کاربر ابتدا در «تنظیمات حساب ← روش‌های ورود» شمارهٔ همراهش را با کد پیامکی **تأیید** می‌کند (`users.phone_verified_at`؛ هر شمارهٔ تأییدشده فقط به یک حساب تعلق دارد). فقط شمارهٔ تأییدشده می‌تواند وارد شود.
  - کد ۶ رقمی، ۵ دقیقه اعتبار، حداکثر ۵ حدس، فقط هش آن ذخیره می‌شود (`sms_otps`)، یک‌بارمصرف. هر شماره حداکثر یک کد در دقیقه و ۵ کد در ساعت؛ هر IP حداکثر ۸ درخواست در ۱۵ دقیقه. ارقام فارسی و قالب‌های `+98`/`0098`/`98` پذیرفته می‌شوند.
  - پاسخ ارسال کد برای شمارهٔ ناشناخته همان پاسخ موفق است (افشای وجود حساب ممکن نیست).
  - حساب‌هایی که **ورود دومرحله‌ای (TOTP)** دارند با پیامک تنها وارد نمی‌شوند (`totp_account`)؛ باید با رمز و کد برنامه وارد شوند.
- **SSO:**
  - جریان authorization code + **PKCE (S256)** + `state` یک‌بارمصرف (هش‌شده در `sso_states`، ۱۰ دقیقه) + `nonce`. امضای `id_token` (RS256/ES256) با JWKS سرور بررسی می‌شود و `iss`، `aud`/`azp`، `exp`، `iat` و `nonce` کنترل می‌شوند؛ `none` و HMAC رد می‌شوند. چرخش کلید با بارگیری دوبارهٔ JWKS پشتیبانی می‌شود.
  - اولین ورود: اگر شناسه (`issuer`+`sub`) قبلاً متصل نشده باشد، با شمارهٔ دانشجویی claim تطبیق داده می‌شود — حساب **دانشجو** با همان شماره خودکار متصل می‌شود؛ حساب‌های کارکنان هرگز خودکار تصاحب نمی‌شوند (`link_from_settings`)؛ اگر حسابی نباشد و `sso_auto_create` روشن باشد حساب دانشجو با رمز تصادفی غیرقابل‌استفاده ساخته می‌شود، وگرنه `no_account`.
  - اتصال دستی از تنظیمات حساب (`/api/signin/sso/start?link=1`)؛ شناسهٔ متصل به حساب دیگر قابل تصاحب نیست (`/settings?sso=taken`). قطع اتصال: `DELETE /api/signin/sso/identities`.
  - خطاها با `/login?sso_error=<code>` به صفحهٔ ورود برمی‌گردند (`sso_off`، `provider_unreachable`، `provider_denied`، `bad_request`، `state_invalid`، `token_invalid`، `no_account`، `link_from_settings`، `account_inactive`، `login_required`). علت دقیق `token_invalid` در لاگ سرور با پیام `sso_failed` ثبت می‌شود.
- **نگهداری دوره‌ای:** کدهای پیامکی قدیمی‌تر از یک روز و stateهای رهاشدهٔ SSO پاک می‌شوند (کلید `otps_purged` در گزارش `--maintenance`).
- **ممیزی:** `auth.login_otp`، `auth.login_sso`، `user.phone_verified`، `user.sso_linked`، `user.sso_unlinked`، `user.created_sso`.
- آزمون: بخش ۷ از `tests/future-e2e.mjs` (درگاه پیامک و سرور OIDC ساختگی با کلید RSA واقعی).

## ۱۸. ویدیوی کوتاه در اکسپلور (فاز ۱۹)

- **قابلیت:** پرچم `explore_video` (پیش‌فرض روشن؛ مدیر سامانه می‌تواند خاموش کند). تیم در «پست جدید» یک فایل MP4/WebM/MOV بارگذاری می‌کند؛ مرورگر یک قاب (حدود ثانیهٔ ۱) را به‌عنوان تصویر بندانگشتی برمی‌دارد و جداگانه بارگذاری می‌کند (`images[0]`). استوری ویدیویی پشتیبانی نمی‌شود.
- **سقف مدت:** تنظیم `video_max_seconds` در کنسول توسعه‌دهنده (۵ تا ۱۸۰، پیش‌فرض ۶۰). مدت هنگام بارگذاری مستقیم از کانتینر خوانده می‌شود (`moov/mvhd` در MP4، `Info/Duration` در WebM — بدون ffmpeg، پس روی Cloudflare هم کار می‌کند). فایل طولانی‌تر (`video_too_long`) یا بدون مدت خوانا (`video_unreadable`) رد می‌شود. حداکثر حجم ۹۵ مگابایت (مثل بقیهٔ ویدیوها).
- **تبدیل روی سرور (فقط نصب مستقل با ffmpeg):** پس از پاسخ، در صفی تک‌کاره (`lib/video-jobs.ts`):
  1. نرمال‌سازی به H.264/AAC MP4 با `faststart`، حداکثر ۷۲۰p (ضلع بلند ≤ ۱۲۸۰)، برش به سقف مدت؛
  2. HLS با کپی جریان (قطعه‌های ۴ ثانیه‌ای `seg-NNN.ts` + `index.m3u8`)؛
  3. قاب پوستر `poster.jpg`.
  خروجی‌ها در `pub/<pub>/misc/hls-<assetId>/` ذخیره می‌شوند و `posts.video_json` به `hls_state = ready` می‌رسد (یا `failed`؛ در آن صورت همان فایل اصلی پخش می‌شود). کارهای نیمه‌تمام پس از راه‌اندازی دوباره از سر گرفته می‌شوند. غیرفعال‌سازی: `VIDEO_TRANSCODE=off`. نصب: `apt install ffmpeg`.
- **روی Cloudflare:** ffmpeg در دسترس نیست؛ `hls_state = none` و فایل بارگذاری‌شده مستقیم (با Range از R2) پخش می‌شود. توصیه: تیم‌ها MP4 (H.264) بارگذاری کنند تا روی همهٔ مرورگرها پخش شود.
- **پخش:** صفحهٔ پست اگر مرورگر HLS بومی داشته باشد (Safari/iOS و بیشتر Android) `index.m3u8` و وگرنه MP4 را پخش می‌کند؛ بدون پخش خودکار، `controlsList=nodownload`. کاشی‌های اکسپلور نشان پخش + مدت دارند.
- **Range:** `/api/media/k/*` اکنون `Accept-Ranges: bytes` و پاسخ‌های `206`/`416` دارد (`bytes=a-b`، `bytes=a-`، `bytes=-n`) — برای جابه‌جایی در ویدیو روی Safari لازم است. روی دیسک فقط بازهٔ درخواستی خوانده می‌شود.
- **دسترسی:** ویدیو و همهٔ فایل‌های HLS آن فقط وقتی عمومی‌اند که پست منتشرشده باشد؛ پیش‌نویس/پنهان فقط برای کادر همان نشریه.
- آزمون: بخش ۸ از `tests/future-e2e.mjs` (اگر ffmpeg نصب باشد تبدیل واقعی HLS هم بررسی می‌شود).

## ۱۹. اپ اندروید با جلوگیری واقعی از اسکرین‌شات (فاز ۱۹)

- **اپ:** پوشهٔ `android/`، یک پوستهٔ WebView سبک (Java، بدون کتابخانهٔ جانبی) که سایت را باز می‌کند و روی کل پنجره
  `FLAG_SECURE` می‌گذارد؛ سیستم‌عامل اسکرین‌شات و ضبط صفحه را مسدود و پیش‌نمایش «اخیر» را سیاه می‌کند. فقط HTTPS؛
  فقط پیوندهای دامنهٔ سایت داخل اپ و بقیه در مرورگر باز می‌شوند. ساخت و امضا: `android/README.md`؛ CI یک APK
  دیباگ می‌سازد (artifact `nashriyar-debug-apk`).
- **تشخیص اپ در سرور** (`src/server/lib/app-client.ts`): User-Agent شامل `NashriyarApp/<نسخه>`. اگر در کنسول
  توسعه‌دهنده «کلید کلاینت اپ» (`app_client_key`، پوشیده) تعیین شود، اپ باید `nsk/<توکن>` هم بفرستد: ۱۶ نویسهٔ اول
  `HMAC-SHA256(key, "app|YYYY-MM-DD")` برای امروز یا دیروز (UTC). همین مقدار هنگام ساخت با `-PnashriyarAppKey` در APK
  قرار می‌گیرد. این **بازدارنده** است نه DRM؛ کلید از APK قابل استخراج است. با تغییر کلید، نسخهٔ جدید اپ لازم است.
- **«خواندن کامل فقط در اپ»:** گزینهٔ تب انتشار اتاق شماره (`issues.app_only`، migration 0021؛ فقط برای شمارهٔ پولی).
  برای خریدار در وب، مانیفست و حالت متنی فقط صفحات پیش‌نمایش را می‌دهند (`app_required: true`) و کتاب‌خوان پیام «ادامه در
  اپ نشریار» با پیوند `app_download_url` نشان می‌دهد. نشانی امضاشدهٔ صفحه‌ای که در اپ گرفته شده در وب ۴۰۳ می‌گیرد.
  تیم نشریه و کادر همچنان در وب کامل می‌خوانند؛ اپ به‌تنهایی شمارهٔ پولی را باز نمی‌کند (حق دسترسی لازم است).
- **پیوند دریافت:** `app_download_url` در کنسول (فقط `http(s)://…` یا مسیر نسبی `/…`)؛ مثلاً APK امضاشده را در
  `public/nashriyar.apk` قرار دهید یا پیوند بازار/مایکت را ثبت کنید. در `/api/public/settings` منتشر می‌شود.
- آزمون: بخش ۹ از `tests/future-e2e.mjs`.
