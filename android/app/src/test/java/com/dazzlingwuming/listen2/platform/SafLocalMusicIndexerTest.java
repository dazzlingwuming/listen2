package com.dazzlingwuming.listen2.platform;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.nio.charset.StandardCharsets;

import org.junit.Test;

/** Pure extension/MIME gate coverage; URI enumeration remains Android instrumentation work. */
public final class SafLocalMusicIndexerTest {
    @Test
    public void acceptsKnownAudioMimeOrExtensionAndRejectsOtherDocuments() {
        assertTrue(SafLocalMusicIndexer.isSupportedAudio("recording.bin", "audio/flac"));
        assertTrue(SafLocalMusicIndexer.isSupportedAudio("recording.OPUS", "application/octet-stream"));
        assertTrue(SafLocalMusicIndexer.isSupportedAudio("concert.mp4", "video/mp4"));
        assertTrue(SafLocalMusicIndexer.isSupportedAudio("concert.WEBM", "video/webm"));
        assertFalse(SafLocalMusicIndexer.isSupportedAudio("lyrics.lrc", "text/plain"));
        assertFalse(SafLocalMusicIndexer.isSupportedAudio("photo.jpg", "image/jpeg"));
    }

    @Test
    public void localLrcDecoderRejectsMalformedOrNulContentWithoutLeakingReferences() {
        assertEquals("[00:01.00]safe", SafMediaReferencePort.decodeUtf8Lrc(
                "[00:01.00]safe".getBytes(StandardCharsets.UTF_8)));
        assertEquals("[00:01.00]bom", SafMediaReferencePort.decodeUtf8Lrc(
                "\uFEFF[00:01.00]bom".getBytes(StandardCharsets.UTF_8)));
        assertNull(SafMediaReferencePort.decodeUtf8Lrc(new byte[] {(byte) 0xc3, (byte) 0x28}));
        assertNull(SafMediaReferencePort.decodeUtf8Lrc(
                "[00:01.00]\u0000unsafe".getBytes(StandardCharsets.UTF_8)));
    }
}
