package com.dazzlingwuming.listen2;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.BeforeClass;
import org.junit.Test;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URL;
import java.net.URLConnection;
import java.net.URLStreamHandler;
import java.net.URLStreamHandlerFactory;
import java.nio.charset.StandardCharsets;
import java.security.Principal;
import java.security.cert.Certificate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import javax.net.ssl.HttpsURLConnection;

/** JVM coverage for native Bilibili account-cookie handling and fallback. */
public final class BilibiliPlaybackResolverCookieTest {
    private static final String BVID = "BV1xx411c7mD";
    private static final String ANONYMOUS_BUVID = "0123456789abcdef";
    private static final Object NETWORK_LOCK = new Object();
    private static FakeNetwork activeNetwork;

    @BeforeClass
    public static void installFakeHttpsHandler() {
        try {
            URL.setURLStreamHandlerFactory(new URLStreamHandlerFactory() {
                @Override
                public URLStreamHandler createURLStreamHandler(String protocol) {
                    if (!"https".equals(protocol)) return null;
                    return new URLStreamHandler() {
                        @Override
                        protected URLConnection openConnection(URL url) throws IOException {
                            synchronized (NETWORK_LOCK) {
                                if (activeNetwork == null) {
                                    throw new IOException("No fake HTTPS network is active");
                                }
                                return activeNetwork.open(url);
                            }
                        }
                    };
                }
            });
        } catch (Error error) {
            throw new AssertionError("Bilibili cookie tests require the JVM URL handler", error);
        }
    }

    @Test
    public void validAccountCookieIsAppliedToFixedManifestRequest() throws Exception {
        String accountCookie = "SESSDATA=account-cookie; bili_jct=csrf";
        FakeNetwork network = new FakeNetwork(detail(), manifest());
        List<String> candidates = resolve(network, () -> accountCookie);

        assertEquals(2, candidates.size());
        assertEquals(2, network.requests.size());
        assertEquals(AndroidRpcContract.BILIBILI_VIDEO_DETAIL_PATH,
                network.requests.get(0).path);
        assertEquals(AndroidRpcContract.BILIBILI_AUDIO_MANIFEST_PATH,
                network.requests.get(1).path);
        assertEquals(accountCookie, network.requests.get(0).cookie);
        assertEquals(accountCookie, network.requests.get(1).cookie);
        assertFalse(candidates.toString().contains("SESSDATA"));
        assertFalse(candidates.toString().contains("account-cookie"));
    }

    @Test
    public void malformedOrUnusableAccountCookiesFallBackToAnonymousFingerprint() throws Exception {
        List<String> invalidCookies = Arrays.asList(
                "SESSDATA=secret\r\nInjected: true",
                "SESSDATA=" + repeat('x', 8 * 1024),
                "DedeUserID=123; bili_jct=csrf");

        for (String invalidCookie : invalidCookies) {
            FakeNetwork network = new FakeNetwork(detail(), manifest());
            List<String> candidates = resolve(network, () -> invalidCookie);

            assertEquals(2, candidates.size());
            assertEquals(3, network.requests.size());
            assertEquals(HttpBridgePolicy.BILIBILI_FINGERPRINT_PATH,
                    network.requests.get(0).path);
            assertNull(network.requests.get(0).cookie);
            assertEquals("buvid3=" + ANONYMOUS_BUVID,
                    network.requests.get(1).cookie);
            assertEquals("buvid3=" + ANONYMOUS_BUVID,
                    network.requests.get(2).cookie);
            assertFalse(network.requests.toString().contains(invalidCookie));
            assertFalse(candidates.toString().contains("SESSDATA"));
        }
    }

    @Test
    public void accountCookieSourceFailureFallsBackWithoutLeakingCookieMaterial() throws Exception {
        String secretCookie = "SESSDATA=exception-secret";
        FakeNetwork network = new FakeNetwork(detail(), manifest());
        List<String> candidates = resolve(network, () -> {
            throw new IllegalStateException(secretCookie);
        });

        assertEquals(2, candidates.size());
        assertFalse(candidates.toString().contains(secretCookie));
        assertFalse(network.requests.toString().contains(secretCookie));
    }

    private static List<String> resolve(FakeNetwork network,
            BilibiliPlaybackResolver.AccountCookieSource source) {
        synchronized (NETWORK_LOCK) {
            activeNetwork = network;
            try {
                return new BilibiliPlaybackResolver(source).resolve(descriptor());
            } finally {
                activeNetwork = null;
            }
        }
    }

    private static PlaybackMediaResolver.Descriptor descriptor() {
        return new PlaybackMediaResolver.Descriptor("bilibili", BVID, 22L,
                "title", "artist", 120_000L, "audio");
    }

    private static String detail() throws Exception {
        return new JSONObject().put("code", 0).put("data", new JSONObject().put("bvid", BVID)
                .put("title", "fixture").put("duration", 120).put("pages", new JSONArray()
                        .put(new JSONObject().put("cid", 22L).put("page", 1).put("part", "P1")
                                .put("duration", 120)))).toString();
    }

    private static String manifest() throws Exception {
        JSONObject audio = new JSONObject().put("id", 30280)
                .put("baseUrl", "https://upos.bilivideo.com/audio.m4s?deadline=4102444800")
                .put("backupUrl", new JSONArray().put(
                        "https://upos-backup.bilivideo.com/audio.m4s?deadline=4102444800"))
                .put("mimeType", "audio/mp4").put("codecs", "mp4a.40.2").put("bandwidth", 128000);
        return new JSONObject().put("code", 0).put("data", new JSONObject().put("bvid", BVID)
                .put("cid", 22L).put("timelength", 120000).put("dash",
                        new JSONObject().put("audio", new JSONArray().put(audio)))).toString();
    }

    private static String repeat(char value, int count) {
        StringBuilder result = new StringBuilder(count);
        for (int index = 0; index < count; index += 1) result.append(value);
        return result.toString();
    }

    private static final class FakeNetwork {
        final String detail;
        final String manifest;
        final List<Request> requests = new ArrayList<>();

        FakeNetwork(String detail, String manifest) {
            this.detail = detail;
            this.manifest = manifest;
        }

        FakeHttpsURLConnection open(URL url) {
            String path = url.getPath();
            if (HttpBridgePolicy.BILIBILI_FINGERPRINT_PATH.equals(path)) {
                return new FakeHttpsURLConnection(url, this, 200,
                        "{\"code\":0,\"data\":{\"b_3\":\"" + ANONYMOUS_BUVID + "\"}}");
            }
            if (AndroidRpcContract.BILIBILI_VIDEO_DETAIL_PATH.equals(path)) {
                return new FakeHttpsURLConnection(url, this, 200, detail);
            }
            if (AndroidRpcContract.BILIBILI_AUDIO_MANIFEST_PATH.equals(path)) {
                return new FakeHttpsURLConnection(url, this, 200, manifest);
            }
            return new FakeHttpsURLConnection(url, this, 404, "");
        }

        void record(FakeHttpsURLConnection connection) {
            requests.add(new Request(connection.requestPath(),
                    connection.requestProperties.get("Cookie")));
        }
    }

    private static final class Request {
        final String path;
        final String cookie;

        Request(String path, String cookie) {
            this.path = path;
            this.cookie = cookie;
        }

        @Override
        public String toString() {
            return path + " cookie=" + cookie;
        }
    }

    private static final class FakeHttpsURLConnection extends HttpsURLConnection {
        final FakeNetwork network;
        final byte[] body;
        final int status;
        final java.util.Map<String, String> requestProperties = new java.util.LinkedHashMap<>();

        FakeHttpsURLConnection(URL url, FakeNetwork network, int status, String body) {
            super(url);
            this.network = network;
            this.status = status;
            this.body = body.getBytes(StandardCharsets.UTF_8);
        }

        String requestPath() {
            return url.getPath();
        }

        @Override
        public void disconnect() { }

        @Override
        public boolean usingProxy() {
            return false;
        }

        @Override
        public void connect() { }

        @Override
        public int getResponseCode() {
            network.record(this);
            return status;
        }

        @Override
        public long getContentLengthLong() {
            return body.length;
        }

        @Override
        public InputStream getInputStream() {
            return new ByteArrayInputStream(body);
        }

        @Override
        public void setRequestProperty(String key, String value) {
            requestProperties.put(key, value);
        }

        @Override
        public String getCipherSuite() {
            return "TLS_FAKE";
        }

        @Override
        public Certificate[] getLocalCertificates() {
            return null;
        }

        @Override
        public Certificate[] getServerCertificates() {
            return null;
        }

        @Override
        public Principal getPeerPrincipal() {
            return null;
        }

        @Override
        public Principal getLocalPrincipal() {
            return null;
        }
    }
}
