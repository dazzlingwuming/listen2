package com.dazzlingwuming.listen2.platform;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

/** Pure key-to-filename checks keep renderer input from becoming a file path. */
public final class AndroidMediaFilePortTest {
    @Test
    public void mapsOnlySafeOpaqueKeysToFixedDigestFileNames() {
        assertEquals("0e2b2281598cfdab4eee3f995a8769ba840043d5409179f46934cf8078ab6599.media",
                AndroidMediaFilePort.fileNameForKey("media_1"));
        assertNull(AndroidMediaFilePort.fileNameForKey("../media"));
        assertNull(AndroidMediaFilePort.fileNameForKey("media/file"));
        assertNull(AndroidMediaFilePort.fileNameForKey(""));
    }
}
