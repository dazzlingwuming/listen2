package com.dazzlingwuming.listen2;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public final class NavigationPolicyTest {
    @Test
    public void onlyPackagedAppAssetsStayInsideWebView() {
        assertTrue(NavigationPolicy.isPackagedAssetUrl(
                "https://appassets.androidplatform.net/assets/listen1/listen1.html"));
        assertFalse(NavigationPolicy.isPackagedAssetUrl(
                "file:///android_asset/listen1/listen1.html"));
        assertFalse(NavigationPolicy.isPackagedAssetUrl(
                "https://appassets.androidplatform.net/assets/other/index.html"));
    }

    @Test
    public void fileUrlEscapesAndUntrustedSchemesAreNeverApproved() {
        assertFalse(NavigationPolicy.ALLOW_FILE_ACCESS_FROM_FILE_URLS);
        assertFalse(NavigationPolicy.ALLOW_UNIVERSAL_ACCESS_FROM_FILE_URLS);
        assertFalse(NavigationPolicy.isApprovedExternalUrl("file:///sdcard/private.html"));
        assertFalse(NavigationPolicy.isApprovedExternalUrl("content://com.example.provider/item"));
        assertFalse(NavigationPolicy.isApprovedExternalUrl("intent://untrusted"));
        assertTrue(NavigationPolicy.isApprovedExternalUrl("https://example.com/help"));
    }
}
