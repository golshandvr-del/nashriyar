# API عمومی فقط‌خواندنی نشریار (فاز ۱۹)

برای سامانه‌های دیگر دانشگاه (آموزش، کتابخانه، پرتال، معاونت فرهنگی) که می‌خواهند فهرست نشریات و شماره‌های منتشرشده را نمایش دهند یا نمایه کنند.

## اصول

- **فقط خواندنی:** فقط `GET` (و `HEAD`/`OPTIONS`)؛ هر روش دیگر → `405`.
- **کلید API:** در کنسول طراح (`/system/api-keys`) ساخته می‌شود (نیازمند sudo). کلید (`nsk_…`) **فقط یک بار** نمایش داده می‌شود؛ سرور فقط هش SHA-256 آن را نگه می‌دارد. ابطال فوری است.
- **ارسال کلید:** سرآیند `X-API-Key: nsk_…` (یا در صورت ناچاری `?api_key=`).
- **سقف نرخ هر کلید:** «درخواست در دقیقه» که هنگام ساخت تعیین می‌شود. سرآیندهای `X-RateLimit-Limit` و `X-RateLimit-Remaining`؛ عبور از سقف → `429` با `Retry-After`.
- **CORS باز (`*`)**: چون احراز با کلید است و هیچ کوکی‌ای پذیرفته نمی‌شود.
- **حریم خصوصی:** فقط داده‌ای که در ویترین عمومی هم دیده می‌شود. هرگز تعداد دنبال‌کننده/بازدید (قاعدهٔ ۲ در `docs/ROLES.md`)، دادهٔ شخصی، یا محتوای پولی (تصویر صفحه، PDF، کلید فایل).
- **صفحه‌بندی keyset:** `?limit` (حداکثر ۲۰۰) و `?cursor` (مقدار `next_cursor` پاسخ قبلی). پایان فهرست: `next_cursor: null`.
- **نسخه:** `/api/open/*` و نام مستعار پایدار `/api/v1/open/*`.

## مسیرها

| مسیر | توضیح | پارامترها |
| --- | --- | --- |
| `GET /api/open/` | معرفی و فهرست مسیرها | — |
| `GET /api/open/publications` | نشریات فعال (مرتب بر پایهٔ slug) | `faculty`، `limit`، `cursor` |
| `GET /api/open/publications/{slug}` | یک نشریه + دسته‌ها + شماره‌های منتشرشده | — |
| `GET /api/open/issues` | شماره‌های منتشرشده، جدیدترین اول | `publication` (slug)، `since` (تاریخ ISO)، `q` (جست‌وجوی فارسی نرمال‌شده)، `limit`، `cursor` |
| `GET /api/open/issues/{id}` | یک شماره + فهرست مطالب با نویسندگان و نقش‌ها + نشانی صفحهٔ عمومی | — |
| `GET /api/open/faculties` | دانشکده‌های فعال | — |
| `GET /api/open/categories` | دسته‌بندی‌های فعال | — |
| `GET /api/open/openapi.json` | قرارداد ماشینی OpenAPI 3 (بدون کلید) | — |

## نمونه

```bash
curl -H "X-API-Key: nsk_..." "https://nashriyar.example.ac.ir/api/open/issues?limit=20&since=2026-09-01"
```

```json
{
  "issues": [
    {
      "id": "…", "number": 12, "title": "…", "summary": "…", "keywords": ["…"],
      "pricing": "free", "page_count": 32, "published_at": "2026-10-20T08:00:00.000Z", "archival": false,
      "publication": { "id": "…", "slug": "…", "title": "…" }
    }
  ],
  "next_cursor": "eyJ…"
}
```

## خطاها

| کد | معنی |
| --- | --- |
| `401` (`api_key`) | کلید ارسال نشده، ناشناخته یا باطل‌شده |
| `404` | نشریه/شماره یافت نشد یا هنوز منتشر نشده |
| `405` (`method_not_allowed`) | روش غیر از GET |
| `429` (`rate_limited`) | عبور از سقف دقیقه‌ای کلید |

بدنهٔ خطا همان قالب کل سامانه است: `{ "error": "پیام فارسی", "code": "…" }`.

## پیگیری و ممیزی

- ساخت و ابطال کلید در «گزارش فنی» کنسول طراح (`system.api_key_create` / `system.api_key_revoke`) ثبت می‌شود.
- برای هر کلید «تعداد درخواست» و «آخرین استفاده» نگه داشته می‌شود.
- آزمون خودکار: بخش ۱ از `tests/future-e2e.mjs`.

---

# نمایهٔ مقالات و شناسه‌های پایدار (فاز ۱۹)

هر بخشِ فهرست مطالبِ یک شمارهٔ **منتشرشده** (به‌جز جلد، آگهی و فهرست) یک شناسهٔ پایدار می‌گیرد:

- قالب: `NSH-<سال شمسی انتشار>-<۸ نویسهٔ Crockford base32>`، مثل `NSH-1405-HHP37B4N`
- شناسه **یک بار** ساخته می‌شود و هرگز تغییر نمی‌کند و دوباره به کار نمی‌رود، حتی اگر عنوان اصلاح شود. نشانی `/a/<pid>` همیشه معتبر می‌ماند.
- زمان ساخت:
  - هنگام تأیید انتشار
  - در نگهداری دوره‌ای (backfill برای شماره‌های قدیمی)
  - در پایان seed
- جدول: `article_index` (migration 0016)

## نقاط دسترسی (عمومی، بدون ورود و بدون کلید)

| مسیر | خروجی |
|---|---|
| `GET /a/<pid>` | صفحهٔ HTML سمت سرور با متای `citation_*` (Google Scholar / Highwire)، `canonical`، BibTeX/RIS |
| `GET /api/articles/<pid>` | JSON: عنوان، پدیدآورندگان، نشریه، شماره، صفحه‌ها، چکیده، کلیدواژه، DOI، استناد APA |
| `GET /api/articles/<pid>/cite.bib` | BibTeX |
| `GET /api/articles/<pid>/cite.ris` | RIS (EndNote / Zotero / Mendeley) |
| `GET /api/articles/oai?verb=…` | OAI-PMH 2.0 با `oai_dc` |

**OAI-PMH:**
- فعل‌های پشتیبانی‌شده: `Identify`، `ListMetadataFormats`، `ListSets` (هر نشریه یک set به شکل `pub:<slug>`)، `ListIdentifiers`، `ListRecords` (۱۰۰ رکورد در هر صفحه با `resumptionToken`)، `GetRecord`
- فیلترهای `from`/`until` با دانه‌بندی روز یا ثانیه پشتیبانی می‌شوند.
- خطاهای استاندارد: `badVerb`، `badArgument`، `cannotDisseminateFormat`، `badResumptionToken`، `noRecordsMatch`، `idDoesNotExist`
- شناسهٔ OAI: `oai:<host>:<pid>`

## حریم و محدودیت

- فقط **فراداده** منتشر می‌شود. تصویر صفحه‌ها، PDF و کلیدهای ذخیره‌سازی هرگز در این مسیرها نیست.
- `dc:rights` نوع دسترسی را مشخص می‌کند: برای شماره‌های رایگان `openAccess` و برای پولی‌ها `restrictedAccess`.
- مقاله فقط وقتی دیده می‌شود که شماره منتشرشده (یا بایگانی) و نشریه فعال باشد.
- `robots.txt` مسیر `/api/articles/` را مجاز می‌کند و `sitemap.xml` صفحه‌های `/a/<pid>` را فهرست می‌کند.

## تکمیل فراداده توسط تیم

- در اتاق شماره، تب «نمایهٔ مقالات» (`GET/PUT /api/team/<pubId>/issues/<issueId>/articles[/<pid>]`) برای این فیلدها: چکیده، کلیدواژه‌ها، زبان (`fa`/`en`/`ar`) و DOI اختیاری.
- قالب DOI این است: `10.xxxx/…`. پیشوند `https://doi.org/` خودکار حذف می‌شود و DOI باید یکتا باشد.
- PID قابل ویرایش نیست.
- هر تغییر با کنش `article.update` در گزارش ممیزی ثبت می‌شود.
- آزمون خودکار: بخش ۲ از `tests/future-e2e.mjs`.
