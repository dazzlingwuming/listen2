package com.dazzlingwuming.listen2;

import com.dazzlingwuming.listen2.library.BackupSafFilePort;
import com.dazzlingwuming.listen2.library.BackupJsonCodec;
import org.json.JSONObject;
import org.junit.Test;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import static org.junit.Assert.*;

public final class BackupFileStatusProjectionTest {
    @Test public void readyFileStatusIncludesTheFileCodecsPreview() throws Exception {
        BackupJsonCodec.DecodeResult decoded = BackupJsonCodec.decode(
                "{\"version\":1,\"playlists\":[{\"playlistId\":\"myplaylist_test\",\"name\":\"课程\",\"tracks\":[]}],\"favorites\":[]}"
                        .getBytes(StandardCharsets.UTF_8));
        assertTrue(decoded.ok);
        Method method = AndroidHttpBridge.class.getDeclaredMethod("localDataJson", Object.class);
        method.setAccessible(true);
        JSONObject result = (JSONObject) method.invoke(null,
                new BackupSafFilePort.PageSafeStatus("ready", "OK", decoded.preview));
        assertEquals("ready", result.getString("state"));
        assertEquals(1, result.getJSONObject("preview").getInt("playlists"));
        assertEquals(0, result.getJSONObject("preview").getInt("tracks"));
    }
}
