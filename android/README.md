# اپ اندروید نشریار (فاز ۱۹)

پوستهٔ سبک WebView (بدون کتابخانهٔ جانبی، حدود ۲۰ کیلوبایت) که همان وب‌اپ نشریار را باز می‌کند و روی کل پنجره
`FLAG_SECURE` می‌گذارد: سیستم‌عامل **اسکرین‌شات و ضبط صفحه** را مسدود می‌کند و پیش‌نمایش برنامه در «اخیر» سیاه است.

## ساخت

پیش‌نیاز: JDK 17 (دارای `jlink`)، Android SDK (platform 34)، Gradle 8.7.

```bash
cd android
echo "sdk.dir=$ANDROID_HOME" > local.properties
gradle assembleRelease \
  -PnashriyarUrl=https://nashriyar.example.ac.ir \
  -PnashriyarAppKey=<همان مقدار app_client_key در کنسول توسعه‌دهنده>
# خروجی: app/build/outputs/apk/release/app-release.apk
```

- `nashriyarUrl`: نشانی سایت (فقط HTTPS). فقط پیوندهای همین دامنه داخل اپ باز می‌شوند؛ بقیه در مرورگر.
- `nashriyarAppKey` (اختیاری): اگر در کنسول «کلید کلاینت اپ» تعیین شده باشد، باید همین مقدار باشد. کلید را در git
  نگذارید (با `-P` یا `~/.gradle/gradle.properties`).
- امضای نسخهٔ انتشار: فایل `android/keystore.properties` (در git نیست):
  ```
  storeFile=nashriyar.jks
  storePassword=...
  keyAlias=nashriyar
  keyPassword=...
  ```
  ساخت کلید: `keytool -genkeypair -v -keystore android/nashriyar.jks -alias nashriyar -keyalg RSA -keysize 2048 -validity 10000`

## سازوکار

- User-Agent اپ: `… NashriyarApp/<نسخه> nsk/<توکن روزانه>`؛ توکن = ۱۶ کاراکتر اول
  `HMAC-SHA256(app_client_key, "app|YYYY-MM-DD")` (تاریخ UTC؛ سرور امروز و دیروز را می‌پذیرد) — پیاده‌سازی سرور:
  `src/server/lib/app-client.ts`.
- اپ فقط **نسخهٔ نصبی همین سایت** است: هیچ امکانی به اپ محدود نیست و سایت بدون اپ هم همهٔ امکانات را دارد.
  مزیت اپ: `FLAG_SECURE` (مسدودشدن اسکرین‌شات و ضبط صفحه) و آیکن روی صفحهٔ اصلی گوشی؛ واترمارک کتاب‌خوان مثل وب فعال است.
- **نشانی سایت داخل اپ:** اگر هنگام ساخت `nashriyarUrl` داده نشود (یا مقدار نمونهٔ `example.ac.ir` باشد)، اپ در اولین
  اجرا نشانی را می‌پرسد و روی گوشی ذخیره می‌کند. در صفحهٔ «اتصال برقرار نشد» هم دکمهٔ «تغییر نشانی سرور» هست.

## انتشار خودکار در GitHub Release

Workflow `.github/workflows/android-release.yml` یک APK امضاشده می‌سازد و در بخش Releases منتشر می‌کند:

- با تگ: `git tag v1.0.1 && git push --tags`، یا
- دستی: Actions → **android release** → Run workflow (ورودی‌ها: `version`، `site_url` اختیاری، `prerelease`).
- نشانی سایت: ورودی `site_url` یا متغیر ریپو `NASHRIYAR_URL`؛ اگر هیچ‌کدام نباشد اپ در اولین اجرا می‌پرسد.
- کد نسخه از روی شماره ساخته می‌شود (`X.Y.Z` → `X*10000 + Y*100 + Z`).
- امضا با secrets ریپو: `ANDROID_KEYSTORE_BASE64`، `ANDROID_KEYSTORE_PASSWORD`، `ANDROID_KEY_ALIAS`، `ANDROID_KEY_PASSWORD`
  (اختیاری: `NASHRIYAR_APP_KEY`). همهٔ نسخه‌ها با یک کلید امضا می‌شوند تا نسخهٔ جدید روی قبلی نصب شود؛ اگر کلید عوض
  شود، کاربران باید اپ را حذف و دوباره نصب کنند.
- پیوند Release را در کنسول («پیوند دریافت اپ اندروید») ثبت کنید تا در پانویس سایت نمایش داده شود.
