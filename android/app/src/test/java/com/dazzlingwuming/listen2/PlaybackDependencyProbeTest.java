package com.dazzlingwuming.listen2;

import static org.junit.Assert.assertNotNull;

import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.session.MediaSessionService;
import androidx.room.RoomDatabase;
import androidx.room.testing.MigrationTestHelper;

import org.junit.Test;

/**
 * Compile-time dependency tracer for the native playback stack. This deliberately
 * references the public types consumed by later service and persistence work.
 */
public final class PlaybackDependencyProbeTest {
    @Test
    public void resolvesThePinnedNativePlaybackAndPersistenceApis() {
        assertNotNull(ExoPlayer.class);
        assertNotNull(MediaSessionService.class);
        assertNotNull(RoomDatabase.class);
        assertNotNull(MigrationTestHelper.class);
    }
}
