package com.dazzlingwuming.listen2;

import static org.junit.Assert.assertTrue;

import android.os.Bundle;
import android.util.Log;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.runner.AndroidJUnit4;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.InputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import javax.net.ssl.HttpsURLConnection;

/** Opt-in device smoke check. Pass biliBvid and biliCid; never logs signed URLs or cookies. */
@RunWith(AndroidJUnit4.class)
public final class BilibiliNetworkSmokeTest {
    @Test public void publicAudioIsReachableFromThisDevice() throws Exception {
        Bundle args = InstrumentationRegistry.getArguments();
        String bvid = args.getString("biliBvid", "");
        String cid = args.getString("biliCid", "");
        Assume.assumeTrue(bvid.matches("BV[A-Za-z0-9]{10}") && cid.matches("[1-9][0-9]{0,17}"));
        String uri = "https://api.bilibili.com/x/player/playurl?fnval=16&fnver=0&fourk=1&bvid="
                + bvid + "&cid=" + cid;
        HttpsURLConnection api = open(uri);
        JSONObject manifest;
        try (InputStream stream = api.getInputStream()) {
            manifest = new JSONObject(new String(stream.readAllBytes(), StandardCharsets.UTF_8));
        } finally { api.disconnect(); }
        assertTrue("Provider response must succeed", manifest.optInt("code", -1) == 0);
        JSONObject audio = manifest.getJSONObject("data").getJSONObject("dash")
                .getJSONArray("audio").getJSONObject(0);
        JSONArray candidates = new JSONArray().put(audio.getString("baseUrl"));
        JSONArray backups = audio.optJSONArray("backupUrl");
        if (backups != null) for (int i = 0; i < backups.length() && i < 3; i++) candidates.put(backups.get(i));
        boolean reached = false;
        for (int i = 0; i < candidates.length(); i++) {
            URI candidate = URI.create(candidates.getString(i));
            boolean allowed = BilibiliMediaPolicy.permits(candidate);
            Log.i("Listen2Smoke", "candidate host=" + candidate.getHost() + " port="
                    + candidate.getPort() + " allowed=" + allowed);
            if (!allowed) continue;
            HttpsURLConnection media = open(candidate.toString());
            for (Map.Entry<String, String> header : MediaRequestHeaders.forUri(candidate).entrySet())
                media.setRequestProperty(header.getKey(), header.getValue());
            media.setRequestProperty("Range", "bytes=0-1023");
            try {
                int status = media.getResponseCode();
                Log.i("Listen2Smoke", "candidate status=" + status);
                if (status == 200 || status == 206) {
                    try (InputStream stream = media.getInputStream()) {
                        reached = stream.read(new byte[1024]) > 0;
                    }
                }
            } catch (Exception error) {
                Log.i("Listen2Smoke", "candidate error=" + error.getClass().getSimpleName());
            } finally { media.disconnect(); }
            if (reached) break;
        }
        assertTrue("At least one provider-issued CDN must return audio bytes", reached);
    }

    private static HttpsURLConnection open(String uri) throws Exception {
        HttpsURLConnection connection = (HttpsURLConnection) URI.create(uri).toURL().openConnection();
        connection.setConnectTimeout(10_000);
        connection.setReadTimeout(12_000);
        connection.setInstanceFollowRedirects(false);
        connection.setRequestProperty("Referer", "https://www.bilibili.com/");
        connection.setRequestProperty("Accept", "application/json, text/plain, */*");
        connection.setRequestProperty("Accept-Encoding", "identity");
        connection.setRequestProperty("User-Agent", MediaRequestHeaders.USER_AGENT);
        return connection;
    }
}
