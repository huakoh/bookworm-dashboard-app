package com.bookworm.dashboard;

import android.app.Activity;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * 全屏 WebView 加载 Dashboard
 * 优先加载 GitHub Pages 远程版本，失败时回退到本地静态快照
 */
public class MainActivity extends Activity {

    private static final String REMOTE_URL = "https://huakoh.github.io/bookworm-dashboard-app/";
    private static final String LOCAL_URL = "file:///android_asset/index.html";

    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 全屏无标题栏
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_FULLSCREEN,
            WindowManager.LayoutParams.FLAG_FULLSCREEN
        );

        webView = new WebView(this);
        setContentView(webView);

        // WebView 配置
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        // 远程加载失败时回退到本地
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedError(WebView view, int errorCode,
                    String description, String failingUrl) {
                if (failingUrl.equals(REMOTE_URL)) {
                    view.loadUrl(LOCAL_URL);
                }
            }
        });

        // 优先加载远程 Dashboard
        webView.loadUrl(REMOTE_URL);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
