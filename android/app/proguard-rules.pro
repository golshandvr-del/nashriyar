# Keep the JavaScript bridge methods exposed to the WebView (@JavascriptInterface)
-keepclassmembers class ir.nashriyar.app.** {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface
