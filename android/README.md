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
- انتشار: APK را مثلاً در `public/nashriyar.apk` یا بازار/مایکت قرار دهید و پیوند را در کنسول
  («پیوند دریافت اپ اندروید») ثبت کنید.
