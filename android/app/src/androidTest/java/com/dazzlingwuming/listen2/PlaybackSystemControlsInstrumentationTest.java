package com.dazzlingwuming.listen2;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.app.UiAutomation;
import android.media.AudioManager;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.os.ParcelFileDescriptor;

import androidx.media3.session.MediaController;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Test;

import java.io.BufferedReader;
import java.io.FileInputStream;
import java.io.InputStreamReader;
import java.util.Map;

/** API-35 checks for MediaSession system surfaces; unavailable hardware is not a pass. */
public final class PlaybackSystemControlsInstrumentationTest {
    @Test
    public void notificationNoisyScreenOffAndMediaNextRemainOneTruthfulOwner() throws Exception {
        try (PlaybackInstrumentationFixture fixture = PlaybackInstrumentationFixture.connect()) {
            MediaController controller = fixture.controller();
            try {
                fixture.installSilencePlaylist(2);
                fixture.play(controller);
                fixture.await(fixture::isPlaying);
                fixture.await(() -> "playing".equals(fixture.snapshot().get("state")));
                assertTrue("playing MediaSession must publish a system notification",
                        shellOutput("dumpsys notification --noredact").contains("com.dazzlingwuming.listen2.debug"));

                fixture.next(controller);
                fixture.await(() -> fixture.currentMediaItemIndex() == 1);
                fixture.next(controller);
                assertEquals("unavailable terminal next is idempotent", 1, fixture.currentMediaItemIndex());

                shellOutput("input keyevent 26");
                if (!fixture.isPlaying()) {
                    fixture.await(() -> "paused".equals(fixture.snapshot().get("state")));
                    fixture.play(controller);
                    fixture.await(fixture::isPlaying);
                }
                long screenOffPosition = fixture.positionMs();
                fixture.await(() -> fixture.positionMs() > screenOffPosition);
                shellOutput("input keyevent 26");

                AudioManager audioManager = (AudioManager) InstrumentationRegistry.getInstrumentation()
                        .getTargetContext().getSystemService(android.content.Context.AUDIO_SERVICE);
                AudioFocusRequest focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                        .setAudioAttributes(new AudioAttributes.Builder()
                                .setUsage(AudioAttributes.USAGE_MEDIA)
                                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                                .build())
                        .setOnAudioFocusChangeListener(change -> { })
                        .build();
                assertEquals(AudioManager.AUDIOFOCUS_REQUEST_GRANTED,
                        audioManager.requestAudioFocus(focusRequest));
                try {
                    fixture.await(() -> !fixture.isPlaying());
                    fixture.await(() -> "paused".equals(fixture.snapshot().get("state")));
                } finally {
                    audioManager.abandonAudioFocusRequest(focusRequest);
                }
            } finally {
                fixture.release(controller);
            }
        }
    }

    @Test
    public void clearingMeaningfulContextRemovesPlayerCostAndLeavesNoForegroundNotification() throws Exception {
        try (PlaybackInstrumentationFixture fixture = PlaybackInstrumentationFixture.connect()) {
            MediaController controller = fixture.controller();
            try {
                fixture.installSilenceMedia();
                fixture.play(controller);
                fixture.await(fixture::isPlaying);
                fixture.dispatchClear();
                fixture.await(() -> fixture.mediaItemCount() == 0);
                fixture.await(() -> "idle".equals(fixture.snapshot().get("state")));
                assertFalse("cleared context must remove playback notification",
                        shellOutput("dumpsys notification --noredact").contains("com.dazzlingwuming.listen2.debug"));
            } finally {
                fixture.release(controller);
            }
        }
    }

    private static String shellOutput(String command) throws Exception {
        UiAutomation automation = InstrumentationRegistry.getInstrumentation().getUiAutomation();
        ParcelFileDescriptor descriptor = automation.executeShellCommand(command);
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(
                new FileInputStream(descriptor.getFileDescriptor())))) {
            StringBuilder result = new StringBuilder();
            char[] buffer = new char[2_048];
            int count;
            while ((count = reader.read(buffer)) >= 0 && result.length() < 32_768) result.append(buffer, 0, count);
            return result.toString();
        } finally {
            descriptor.close();
        }
    }
}
