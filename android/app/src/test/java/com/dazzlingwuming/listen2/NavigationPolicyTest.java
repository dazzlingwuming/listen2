package com.dazzlingwuming.listen2;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public final class NavigationPolicyTest {
    @Test
    public void onlyPackagedAppAssetsStayInsideWebView() {
        assertTrue(NavigationPolicy.isPackagedAssetUrl(
                "https://appassets.androidplatform.net/assets/listen1/listen1.html"));
        assertTrue(NavigationPolicy.isPackagedAssetUrl(
                "https://appassets.androidplatform.net/assets/listen1/listen1.html#player"));
        assertFalse(NavigationPolicy.isPackagedAssetUrl(
                "file:///android_asset/listen1/listen1.html"));
        assertFalse(NavigationPolicy.isPackagedAssetUrl(
                "https://appassets.androidplatform.net/assets/other/index.html"));
        assertFalse(NavigationPolicy.isPackagedAssetUrl(
                "https://appassets.androidplatform.net/assets/listen10/listen1.html"));
        assertFalse(NavigationPolicy.isPackagedAssetUrl(
                "https://appassets.androidplatform.net/assets/listen1/../private.html"));
        assertFalse(NavigationPolicy.isPackagedAssetUrl(
                "https://appassets.androidplatform.net/assets/listen1/%2e%2e/private.html"));
        assertFalse(NavigationPolicy.isPackagedAssetUrl(
                "https://appassets.androidplatform.net/assets/listen1/listen1.html?unexpected=1"));
        assertFalse(NavigationPolicy.isPackagedAssetUrl(
                "https://appassets.androidplatform.net:8443/assets/listen1/listen1.html"));
        assertFalse(NavigationPolicy.isPackagedAssetUrl(
                "https://attacker@appassets.androidplatform.net/assets/listen1/listen1.html"));
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

    @Test
    public void navigationDecisionKeepsOnlyPackagedUrlsInWebView() {
        NavigationPolicy.ExternalNavigationDecision packaged = NavigationPolicy.decideNavigation(
                "https://appassets.androidplatform.net/assets/listen1/listen1.html#lyrics");
        assertTrue(packaged.isPackaged());
        assertFalse(packaged.isExternal());
        assertNull(packaged.getExternalUri());

        NavigationPolicy.ExternalNavigationDecision external = NavigationPolicy.decideNavigation(
                "https://example.com/help?topic=android#ignored");
        assertTrue(external.isExternal());
        assertEquals("https://example.com/help?topic=android",
                external.getExternalUri().toASCIIString());

        assertTrue(NavigationPolicy.decideNavigation(
                "https://example.com/help?access_token=secret").isBlocked());
        assertTrue(NavigationPolicy.decideNavigation(
                "https://example.com/help#cookie=secret").isBlocked());
        assertTrue(NavigationPolicy.decideNavigation(
                "https://user@example.com/help").isBlocked());
        assertTrue(NavigationPolicy.decideNavigation(
                "https://example.com:8443/help").isBlocked());
        assertTrue(NavigationPolicy.decideNavigation("javascript:alert(1)").isBlocked());
    }
}
