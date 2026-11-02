package ir.nashriyar.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.ProgressBar;

import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * Nashriyar Android shell (ROADMAP phase 19).
 * - FLAG_SECURE on the whole window: the system refuses screenshots and screen recording, and the recents
 *   thumbnail is blank — the protection the web reader can only discourage.
 * - The web app runs in the platform WebView; the User-Agent carries {@code NashriyarApp/<version>} and, when the
 *   build has a key, {@code nsk/<daily token>} (server: src/server/lib/app-client.ts). The app is only an installable
 *   copy of the site: nothing is app-only, the website has every feature on its own.
 * - Only the configured site opens in-app (HTTPS); every other link goes to the system browser.
 * - The site address comes from the build (-PnashriyarUrl) and can be changed in the app (first run without an
 *   address, or "change server address" on the offline screen) — useful while the site has no permanent domain.
 */
public class MainActivity extends Activity {
    private static final int FILE_CHOOSER = 41;

    private WebView web;
    private ProgressBar progress;
    private ValueCallback<Uri[]> fileCallback;
    private static final String PREFS = "nashriyar";
    private static final String KEY_URL = "site_url";

    private String siteUrl;
    private String siteHost;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // must be set before any content is shown
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
        setContentView(R.layout.activity_main);

        setSite(savedSiteUrl());
        web = findViewById(R.id.web);
        progress = findViewById(R.id.progress);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSaveFormData(false);
        s.setSupportMultipleWindows(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        applyUserAgent();

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);

        web.setWebViewClient(new ShellClient());
        web.setWebChromeClient(new ShellChrome());
        // downloads (EPUB of free issues, exports) are handed to the system browser
        web.setDownloadListener((url, ua, cd, mime, len) -> openExternal(Uri.parse(url)));

        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else if (siteUrl == null) askSiteUrl(true);
        else web.loadUrl(startUrl(getIntent()));
    }

    /** The saved address (set in the app) or the one baked in at build time; null if neither is usable. */
    private String savedSiteUrl() {
        String u = getSharedPreferences(PREFS, MODE_PRIVATE).getString(KEY_URL, null);
        if (u == null || u.isEmpty()) u = BuildConfig.SITE_URL;
        return normalizeUrl(u);
    }

    /** Accepts "host" or "https://host/..." and returns "https://host[:port]" (HTTPS only); null when invalid. */
    static String normalizeUrl(String raw) {
        if (raw == null) return null;
        String u = raw.trim();
        if (u.isEmpty() || u.contains("example.ac.ir")) return null;
        if (!u.contains("://")) u = "https://" + u;
        Uri p = Uri.parse(u);
        if (!"https".equalsIgnoreCase(p.getScheme()) || p.getHost() == null || p.getHost().isEmpty()) return null;
        return "https://" + p.getHost() + (p.getPort() > 0 ? ":" + p.getPort() : "");
    }

    private void setSite(String url) {
        siteUrl = url;
        siteHost = url == null ? null : Uri.parse(url).getHost();
    }

    /** Dialog to enter/change the site address (saved on the device). */
    private void askSiteUrl(boolean firstRun) {
        final EditText input = new EditText(this);
        input.setSingleLine(true);
        input.setHint("https://nashriyar.example.com");
        input.setTextDirection(View.TEXT_DIRECTION_LTR);
        if (siteUrl != null) input.setText(siteUrl);
        AlertDialog.Builder b = new AlertDialog.Builder(this)
                .setTitle(R.string.server_title)
                .setMessage(R.string.server_message)
                .setView(input)
                .setCancelable(!firstRun)
                .setPositiveButton(R.string.server_save, null);
        if (!firstRun) b.setNegativeButton(android.R.string.cancel, null);
        final AlertDialog d = b.create();
        d.setOnShowListener(di -> d.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            String url = normalizeUrl(input.getText().toString());
            if (url == null) {
                input.setError(getString(R.string.server_invalid));
                return;
            }
            SharedPreferences.Editor e = getSharedPreferences(PREFS, MODE_PRIVATE).edit();
            e.putString(KEY_URL, url).apply();
            setSite(url);
            d.dismiss();
            web.loadUrl(url + "/");
        }));
        d.show();
    }

    /** Appends the app marker (and today's token) to the WebView's own User-Agent. */
    private void applyUserAgent() {
        WebSettings s = web.getSettings();
        String base = WebSettings.getDefaultUserAgent(this);
        StringBuilder ua = new StringBuilder(base).append(" NashriyarApp/").append(BuildConfig.VERSION_NAME);
        String token = dailyToken(BuildConfig.APP_KEY);
        if (token != null) ua.append(" nsk/").append(token);
        s.setUserAgentString(ua.toString());
    }

    /** First 16 hex chars of HMAC-SHA256(key, "app|YYYY-MM-DD") for today's UTC date; null without a key. */
    static String dailyToken(String key) {
        if (key == null || key.isEmpty()) return null;
        try {
            SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
            f.setTimeZone(TimeZone.getTimeZone("UTC"));
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            byte[] h = mac.doFinal(("app|" + f.format(new Date())).getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < 8; i++) sb.append(String.format(Locale.US, "%02x", h[i] & 0xff));
            return sb.toString();
        } catch (Exception e) {
            return null;
        }
    }

    private String startUrl(Intent intent) {
        Uri data = intent != null ? intent.getData() : null;
        if (data != null && isSite(data)) return data.toString();
        return siteUrl + "/";
    }

    private boolean isSite(Uri u) {
        return u != null && "https".equals(u.getScheme()) && siteHost != null && siteHost.equalsIgnoreCase(u.getHost());
    }

    private void openExternal(Uri u) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, u));
        } catch (ActivityNotFoundException ignored) {
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        Uri data = intent.getData();
        if (data != null && isSite(data)) web.loadUrl(data.toString());
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        applyUserAgent(); // the token changes daily
    }

    @Override
    protected void onPause() {
        web.onPause();
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            fileCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    private class ShellClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            if (isSite(u)) return false;
            if ("nashriyar-app".equals(u.getScheme())) {
                askSiteUrl(false);
                return true;
            }
            openExternal(u);
            return true;
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            progress.setVisibility(View.VISIBLE);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            progress.setVisibility(View.GONE);
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
            if (req.isForMainFrame()) {
                String retry = req.getUrl().toString().replace("'", "%27");
                view.loadDataWithBaseURL(null, getString(R.string.offline_html).replace("{URL}", retry), "text/html", "utf-8", null);
            }
        }
    }

    private class ShellChrome extends WebChromeClient {
        @Override
        public void onProgressChanged(WebView view, int p) {
            progress.setProgress(p);
        }

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = cb;
            try {
                startActivityForResult(params.createIntent(), FILE_CHOOSER);
            } catch (ActivityNotFoundException e) {
                fileCallback = null;
                return false;
            }
            return true;
        }
    }
}
