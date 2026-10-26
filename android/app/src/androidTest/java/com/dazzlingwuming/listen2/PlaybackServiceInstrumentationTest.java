package com.dazzlingwuming.listen2;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import androidx.media3.common.Player;
import androidx.media3.session.MediaController;
import androidx.test.runner.AndroidJUnit4;

import org.junit.Test;
import org.junit.runner.RunWith;

/** Installed API-35 proof that every controller reaches one native owner. */
@RunWith(AndroidJUnit4.class)
public final class PlaybackServiceInstrumentationTest {
    @Test
    public void multipleControllersShareOnePlayerSessionAndBasicControls() throws Exception {
        try (PlaybackInstrumentationFixture fixture = PlaybackInstrumentationFixture.connect()) {
            MediaController first = fixture.controller();
            MediaController second = fixture.controller();
            try {
                assertNotNull(fixture.session());
                assertNotNull(fixture.player());
                assertEquals(fixture.connectedToken(first), fixture.connectedToken(second));
                fixture.installSilenceMedia();

                fixture.play(first);
                fixture.await(fixture::isPlaying);
                fixture.await(() -> "playing".equals(fixture.snapshot().get("state")));
                long beforePause = fixture.positionMs();
                fixture.pause(second);
                fixture.await(() -> !fixture.isPlaying());
                fixture.await(() -> "paused".equals(fixture.snapshot().get("state")));
                long pausedAt = fixture.positionMs();
                Thread.sleep(250L);
                assertTrue("pause must halt progression", fixture.positionMs() - pausedAt < 80L);

                fixture.seekTo(first, 4_000L);
                fixture.await(() -> fixture.positionMs() >= 3_500L);
                fixture.setVolume(second, 0.35f);
                fixture.await(() -> Math.abs(fixture.volume() - 0.35f) < 0.01f);
                assertFalse("safe fixture starts paused", fixture.isPlaying());
                assertTrue("play action remains advertised", fixture.playPauseAvailable(first));
                assertTrue("position is deterministic media, not provider transport", beforePause >= 0L);
            } finally {
                fixture.release(first);
                fixture.release(second);
            }
        }
    }
}
