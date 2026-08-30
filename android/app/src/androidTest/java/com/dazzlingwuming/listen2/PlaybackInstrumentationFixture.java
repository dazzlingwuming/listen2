package com.dazzlingwuming.listen2;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.IBinder;
import android.os.Looper;

import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.SilenceMediaSource;
import androidx.media3.session.MediaController;
import androidx.media3.session.MediaSession;
import androidx.media3.session.SessionToken;
import androidx.test.platform.app.InstrumentationRegistry;

import java.lang.reflect.Field;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.Map;

/**
 * Installed-process fixture for the private, sole Media3 owner. It injects a
 * deterministic in-memory SilenceMediaSource into the already-created
 * production ExoPlayer; no network, test page command, descriptor, or
 * transport field enters this seam.
 */
final class PlaybackInstrumentationFixture implements AutoCloseable {
    private static final long TIMEOUT_MS = 10_000L;

    interface Condition {
        boolean matches() throws Exception;
    }

    interface MainCall<T> {
        T call() throws Exception;
    }

    private final Context context;
    private final CountDownLatch connected = new CountDownLatch(1);
    private PlaybackService service;
    private boolean bound;

    private final ServiceConnection connection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName name, IBinder binder) {
            if (binder instanceof PlaybackService.PageBinder) {
                PlaybackBridgeController.ServicePort port =
                        ((PlaybackService.PageBinder) binder).getPort();
                if (port instanceof PlaybackService) service = (PlaybackService) port;
            }
            connected.countDown();
        }

        @Override
        public void onServiceDisconnected(ComponentName name) {
            service = null;
        }
    };

    private PlaybackInstrumentationFixture(Context context) {
        this.context = context;
    }

    static PlaybackInstrumentationFixture connect() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        PlaybackInstrumentationFixture fixture = new PlaybackInstrumentationFixture(context);
        Intent intent = new Intent(context, PlaybackService.class);
        intent.setAction(PlaybackService.ACTION_PAGE_PORT);
        fixture.bound = context.bindService(intent, fixture.connection, Context.BIND_AUTO_CREATE);
        if (!fixture.bound || !fixture.connected.await(TIMEOUT_MS, TimeUnit.MILLISECONDS)) {
            fixture.close();
            throw new AssertionError("PlaybackService page port did not connect");
        }
        if (fixture.service == null) {
            fixture.close();
            throw new AssertionError("PlaybackService page port does not reference its sole owner");
        }
        return fixture;
    }

    MediaController controller() throws Exception {
        SessionToken token = new SessionToken(context, new ComponentName(context, PlaybackService.class));
        return new MediaController.Builder(context, token)
                .setApplicationLooper(Looper.getMainLooper())
                .buildAsync().get(TIMEOUT_MS, TimeUnit.MILLISECONDS);
    }

    PlaybackService service() {
        if (service == null) throw new AssertionError("PlaybackService disconnected");
        return service;
    }

    ExoPlayer player() throws Exception {
        return privateField(service(), "player", ExoPlayer.class);
    }

    MediaSession session() throws Exception {
        return privateField(service(), "mediaSession", MediaSession.class);
    }

    void installSilenceMedia() throws Exception {
        onMain(() -> {
            ExoPlayer player = player();
            SilenceMediaSource source = new SilenceMediaSource.Factory()
                    .setDurationUs(60_000_000L)
                    .createMediaSource();
            player.setMediaSource(source);
            player.prepare();
            return null;
        });
        await(() -> playbackState() == Player.STATE_READY);
    }

    boolean isPlaying() throws Exception { return onMain(() -> player().isPlaying()); }

    long positionMs() throws Exception { return onMain(() -> player().getCurrentPosition()); }

    float volume() throws Exception { return onMain(() -> player().getVolume()); }

    void play(MediaController controller) throws Exception { onMain(() -> { controller.play(); return null; }); }

    void pause(MediaController controller) throws Exception { onMain(() -> { controller.pause(); return null; }); }

    void seekTo(MediaController controller, long positionMs) throws Exception {
        onMain(() -> { controller.seekTo(positionMs); return null; });
    }

    void setVolume(MediaController controller, float volume) throws Exception {
        onMain(() -> { controller.setVolume(volume); return null; });
    }

    boolean playPauseAvailable(MediaController controller) throws Exception {
        return onMain(() -> controller.isCommandAvailable(Player.COMMAND_PLAY_PAUSE));
    }

    Object connectedToken(MediaController controller) throws Exception {
        return onMain(controller::getConnectedToken);
    }

    Map<String, Object> snapshot() {
        return service().latestSnapshot().toMap();
    }

    void release(MediaController controller) throws Exception { onMain(() -> { controller.release(); return null; }); }

    void await(Condition condition) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(TIMEOUT_MS);
        Throwable lastFailure = null;
        while (System.nanoTime() < deadline) {
            try {
                if (condition.matches()) return;
            } catch (Throwable failure) {
                lastFailure = failure;
            }
            Thread.sleep(50L);
        }
        AssertionError error = new AssertionError("timed out waiting for playback state");
        if (lastFailure != null) error.initCause(lastFailure);
        throw error;
    }

    @Override
    public void close() {
        if (bound) {
            context.unbindService(connection);
            bound = false;
        }
    }

    private static <T> T privateField(Object target, String name, Class<T> type) throws Exception {
        Field field = target.getClass().getDeclaredField(name);
        field.setAccessible(true);
        Object value = field.get(target);
        if (!type.isInstance(value)) throw new AssertionError(name + " unavailable");
        return type.cast(value);
    }

    private int playbackState() throws Exception { return onMain(() -> player().getPlaybackState()); }

    private <T> T onMain(MainCall<T> call) throws Exception {
        AtomicReference<T> result = new AtomicReference<>();
        AtomicReference<Exception> failure = new AtomicReference<>();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            try {
                result.set(call.call());
            } catch (Exception exception) {
                failure.set(exception);
            }
        });
        if (failure.get() != null) throw failure.get();
        return result.get();
    }
}
