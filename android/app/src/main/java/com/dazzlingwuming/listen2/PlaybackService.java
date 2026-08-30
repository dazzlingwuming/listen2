package com.dazzlingwuming.listen2;

import android.content.Intent;
import android.os.Binder;
import android.os.IBinder;

import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;
import androidx.room.Room;

import com.dazzlingwuming.listen2.data.Listen2Database;

import java.util.Arrays;
import java.util.Collections;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Sole Android playback owner. Activities and WebViews connect as controllers;
 * they never allocate a player. Transport candidates are transient and are not
 * included in MediaSession extras, Room records, or published snapshots.
 */
public final class PlaybackService extends MediaSessionService
        implements PlaybackBridgeController.ServicePort {
    static final String ACTION_PAGE_PORT = "com.dazzlingwuming.listen2.action.PLAYBACK_PAGE_PORT";
    private ExoPlayer player;
    private MediaSession mediaSession;
    private ExecutorService transitionExecutor;
    private Listen2Database database;
    private PlaybackCheckpointRepository checkpointRepository;
    private PlaybackSettingsStore settings;
    private PlaybackCoordinator coordinator;
    private PlaybackMediaResolver resolver;
    private boolean released;
    private long snapshotRevision;
    private volatile PlaybackSnapshot latestPageSnapshot = initialSnapshot();
    private final PageBinder pageBinder = new PageBinder();

    @Override
    public void onCreate() {
        super.onCreate();
        AudioAttributes attributes = new AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                .build();
        player = new ExoPlayer.Builder(this).build();
        player.setAudioAttributes(attributes, true);
        player.setHandleAudioBecomingNoisy(true);
        settings = new PlaybackSettingsStore(getApplicationContext());
        applyVolume();
        mediaSession = new MediaSession.Builder(this, player).build();
        database = Room.databaseBuilder(getApplicationContext(), Listen2Database.class, "listen2-playback.db")
                .fallbackToDestructiveMigrationOnDowngrade(false)
                .build();
        checkpointRepository = new PlaybackCheckpointRepository(database);
        transitionExecutor = Executors.newSingleThreadExecutor();
        transitionExecutor.execute(() -> {
            PlaybackSnapshot restored = restoredSnapshot(checkpointRepository.restore());
            synchronized (PlaybackService.this) {
                if (!released) {
                    latestPageSnapshot = restored;
                    snapshotRevision = restored.getRevision();
                }
            }
        });
        PlaybackQueueEngine.Clock clock = System::currentTimeMillis;
        PlaybackQueueEngine engine = new PlaybackQueueEngine(Arrays.asList(
                new PlaybackQueueEngine.Track("bootstrap-track", true)), 0,
                PlaybackQueueEngine.Mode.SEQUENTIAL,
                new PlaybackQueueEngine.IncrementingIdSource("service"), clock,
                new PlaybackQueueEngine.SequenceRandom(1L));
        resolver = new PlaybackMediaResolver(descriptor -> java.util.Collections.<String>emptyList(),
                new PlaybackMediaResolver.IncrementingHandleSource("service"),
                () -> System.currentTimeMillis() / 1000L);
        coordinator = new PlaybackCoordinator(engine, new RoomPersistencePort(checkpointRepository), new ServicePlayerPort(),
                snapshot -> { }, transitionExecutor, clock);
        player.addListener(new Player.Listener() {
            @Override
            public void onPlaybackStateChanged(int playbackState) {
                if (playbackState == Player.STATE_ENDED && coordinator != null) {
                    coordinator.onNaturalEnd(coordinatorRevision(), "player-ended-" + System.nanoTime());
                }
                publishPlayerSnapshot(playbackState == Player.STATE_ENDED ? "ended" : "ready");
            }

            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                publishPlayerSnapshot(isPlaying ? "playing" : "interrupted");
            }

            @Override
            public void onPositionDiscontinuity(Player.PositionInfo oldPosition,
                    Player.PositionInfo newPosition, int reason) {
                publishPlayerSnapshot("ready");
            }
        });
    }

    @Override
    public MediaSession onGetSession(MediaSession.ControllerInfo controllerInfo) {
        return mediaSession;
    }

    @Override
    public IBinder onBind(Intent intent) {
        if (intent != null && ACTION_PAGE_PORT.equals(intent.getAction())) return pageBinder;
        return super.onBind(intent);
    }

    /** Local-only binder: explicit same-app binding never exposes the player or session. */
    public final class PageBinder extends Binder {
        PlaybackBridgeController.ServicePort getPort() {
            return PlaybackService.this;
        }
    }

    @Override
    public void dispatch(PlaybackCommand command, PlaybackSnapshot snapshot) {
        if (command == null || snapshot == null || released || transitionExecutor == null) {
            throw new IllegalStateException("playback service unavailable");
        }
        // The page sends logical commands only. This owner retains the sanitized
        // authoritative projection and mutates the player on its one transition lane.
        transitionExecutor.execute(() -> {
            if (released) return;
            latestPageSnapshot = snapshot;
            if (player == null) return;
            switch (command.getType()) {
                case PLAY:
                    player.play();
                    break;
                case PAUSE:
                    player.pause();
                    break;
                case SEEK:
                    player.seekTo(number(command.getPayload().get("positionMs")));
                    break;
                case VOLUME:
                    int percent = (int) number(command.getPayload().get("volumePercent"));
                    settings.setVolumePercent(percent);
                    if (!settings.isMuted()) player.setVolume(percent / 100f);
                    break;
                case MUTE:
                    settings.setMuted(Boolean.TRUE.equals(command.getPayload().get("muted")));
                    applyVolume();
                    break;
                case CLEAR:
                    player.stop();
                    player.clearMediaItems();
                    publishPlayerSnapshot("idle");
                    stopForeground(STOP_FOREGROUND_REMOVE);
                    stopSelf();
                    break;
                case SELECT_PREPARED:
                    player.setPlayWhenReady("playing".equals(snapshot.toMap().get("state")));
                    break;
                default:
                    // Other semantic commands are recorded as a native snapshot;
                    // coordinator/media projection performs their transport work.
                    break;
            }
        });
    }

    @Override
    public void rendererDetached() {
        // Renderer lifecycle intentionally has no audio-side effect.
    }

    @Override
    public PlaybackSnapshot latestSnapshot() {
        return latestPageSnapshot;
    }

    /** Safe repeated teardown for process death, idle release, and service destruction. */
    @Override
    public void onDestroy() {
        releasePlaybackState();
        super.onDestroy();
    }

    void releasePlaybackState() {
        if (released) return;
        released = true;
        if (player != null) {
            player.clearMediaItems();
            player.release();
            player = null;
        }
        if (mediaSession != null) {
            mediaSession.release();
            mediaSession = null;
        }
        if (transitionExecutor != null) {
            transitionExecutor.shutdownNow();
            transitionExecutor = null;
        }
        if (database != null) {
            database.close();
            database = null;
        }
    }

    private void applyVolume() {
        if (player == null || settings == null) return;
        player.setVolume(settings.isMuted() ? 0f : settings.getVolumePercent() / 100f);
    }

    private long coordinatorRevision() {
        return latestPageSnapshot.getRevision();
    }

    /** Player callbacks are the only authority for operational state after a command is accepted. */
    private synchronized void publishPlayerSnapshot(String recoveryCode) {
        if (released || player == null) return;
        PlaybackSnapshot previous = latestPageSnapshot;
        Map<String, Object> prior = previous.toMap();
        long revision = Math.max(snapshotRevision, previous.getRevision()) + 1L;
        snapshotRevision = revision;
        long position = Math.max(0L, player.getCurrentPosition());
        long duration = player.getDuration() == C.TIME_UNSET ? 0L : Math.max(0L, player.getDuration());
        PlaybackSnapshot.State state;
        if (player.isPlaying()) state = PlaybackSnapshot.State.PLAYING;
        else if (player.getPlaybackState() == Player.STATE_IDLE) state = PlaybackSnapshot.State.IDLE;
        else if (player.getPlaybackState() == Player.STATE_BUFFERING) state = PlaybackSnapshot.State.RESOLVING;
        else state = PlaybackSnapshot.State.PAUSED;
        latestPageSnapshot = new PlaybackSnapshot(1, number(prior.get("pageEpoch")), revision, state,
                metadata(prior, duration), position, duration, settings.getVolumePercent(), settings.isMuted(),
                mode(prior.get("mode")), actions(duration), previous.getQueue(), previous.getPreparedSelection(),
                new PlaybackSnapshot.RecoveryStatus(recoveryCode, "interrupted".equals(recoveryCode)));
    }

    /** Rebuilds a paused/actionable semantic projection after process death; transport never survives it. */
    private PlaybackSnapshot restoredSnapshot(PlaybackCheckpointRepository.RestoredState restored) {
        if (restored.getRevision() <= 0L || restored.getCurrentOccurrenceId().isEmpty()) return initialSnapshot();
        List<PlaybackSnapshot.QueueOccurrence> queue = new ArrayList<>();
        for (String occurrenceId : restored.getQueueOccurrenceIds()) {
            queue.add(new PlaybackSnapshot.QueueOccurrence(occurrenceId, occurrenceId,
                    "Recovered queue item", "Listen2", 0L));
        }
        return new PlaybackSnapshot(1, 0L, restored.getRevision(), PlaybackSnapshot.State.PAUSED,
                new PlaybackSnapshot.Metadata("Recovered playback", "Listen2", 0L, "bundled-placeholder"),
                restored.getPositionMs(), 0L, settings.getVolumePercent(), settings.isMuted(),
                snapshotMode(restored.getMode()),
                new PlaybackSnapshot.ActionAvailability(true, false, restored.getHistoryCursor() > 0,
                        !queue.isEmpty(), false, true), queue, null,
                new PlaybackSnapshot.RecoveryStatus("restored", true));
    }

    private PlaybackSnapshot.Metadata metadata(Map<String, Object> prior, long duration) {
        Object value = prior.get("metadata");
        if (value instanceof Map) {
            Map<?, ?> metadata = (Map<?, ?>) value;
            Object title = metadata.get("title");
            Object artist = metadata.get("artist");
            Object artwork = metadata.get("artworkState");
            if (title instanceof String && artist instanceof String && artwork instanceof String) {
                return new PlaybackSnapshot.Metadata((String) title, (String) artist, duration, (String) artwork);
            }
        }
        return new PlaybackSnapshot.Metadata("Listen2", "Listen2", duration, "bundled-placeholder");
    }

    private PlaybackSnapshot.ActionAvailability actions(long duration) {
        boolean hasMedia = player.getMediaItemCount() > 0;
        return new PlaybackSnapshot.ActionAvailability(hasMedia && !player.isPlaying(), hasMedia && player.isPlaying(),
                player.hasPreviousMediaItem(), player.hasNextMediaItem(), duration > 0L, hasMedia);
    }

    private static PlaybackSnapshot.Mode mode(Object value) {
        if ("shuffle".equals(value)) return PlaybackSnapshot.Mode.SHUFFLE;
        if ("repeat-one".equals(value)) return PlaybackSnapshot.Mode.REPEAT_ONE;
        if ("repeat-all".equals(value)) return PlaybackSnapshot.Mode.REPEAT_ALL;
        return PlaybackSnapshot.Mode.SEQUENTIAL;
    }

    private static PlaybackSnapshot.Mode snapshotMode(PlaybackQueueEngine.Mode value) {
        if (value == PlaybackQueueEngine.Mode.SHUFFLE) return PlaybackSnapshot.Mode.SHUFFLE;
        if (value == PlaybackQueueEngine.Mode.REPEAT_ONE) return PlaybackSnapshot.Mode.REPEAT_ONE;
        if (value == PlaybackQueueEngine.Mode.REPEAT_ALL) return PlaybackSnapshot.Mode.REPEAT_ALL;
        return PlaybackSnapshot.Mode.SEQUENTIAL;
    }

    private static long number(Object value) {
        return value instanceof Number ? ((Number) value).longValue() : 0L;
    }

    private static PlaybackSnapshot initialSnapshot() {
        return new PlaybackSnapshot(1, 0L, 0L, PlaybackSnapshot.State.IDLE,
                new PlaybackSnapshot.Metadata("", "", 0L, "bundled-placeholder"),
                0L, 0L, 100, false, PlaybackSnapshot.Mode.SEQUENTIAL,
                new PlaybackSnapshot.ActionAvailability(true, false, false, false, false, false),
                java.util.Collections.<PlaybackSnapshot.QueueOccurrence>emptyList(), null,
                new PlaybackSnapshot.RecoveryStatus("ready", false));
    }

    private final class ServicePlayerPort implements PlaybackCoordinator.PlayerPort {
        @Override
        public void project(PlaybackCoordinator.Projection projection) {
            if (player == null) throw new IllegalStateException("player released");
            MediaMetadata metadata = new MediaMetadata.Builder()
                    .setTitle("Listen2")
                    .setArtist("Bilibili")
                    .build();
            player.setMediaItem(new MediaItem.Builder().setMediaId(projection.getOccurrenceId())
                    .setMediaMetadata(metadata).build());
            player.prepare();
            player.setPlayWhenReady(projection.isPlayWhenReady());
        }
    }

    /** Maps queue-engine semantics into one atomic Room checkpoint before projection. */
    private static final class RoomPersistencePort implements PlaybackCoordinator.PersistencePort {
        private final PlaybackCheckpointRepository repository;

        RoomPersistencePort(PlaybackCheckpointRepository repository) {
            this.repository = repository;
        }

        @Override
        public PlaybackCoordinator.PersistenceResult persist(long expectedRevision,
                PlaybackQueueEngine.State state, String transitionToken, long positionMs) {
            List<PlaybackCheckpointRepository.OccurrenceState> occurrences = new ArrayList<>();
            int baseOrdinal = 0;
            for (PlaybackQueueEngine.Occurrence occurrence : state.getBasePlaylist()) {
                occurrences.add(occurrenceState(occurrence, "base", baseOrdinal++));
            }
            int queueOrdinal = 0;
            for (PlaybackQueueEngine.Occurrence occurrence : state.getQueue()) {
                occurrences.add(occurrenceState(occurrence, "queue", queueOrdinal++));
            }
            List<PlaybackCheckpointRepository.HistoryState> history = new ArrayList<>();
            for (int index = 0; index < state.getHistory().size(); index += 1) {
                PlaybackQueueEngine.HistoryEntry entry = state.getHistory().get(index);
                history.add(new PlaybackCheckpointRepository.HistoryState(index,
                        entry.getOccurrence().getOccurrenceId(), entry.getAcceptedAtMs()));
            }
            PlaybackCheckpointRepository.DurableState durable = new PlaybackCheckpointRepository.DurableState(
                    state.getRevision(), transitionToken, "android-context", state.getCurrent().getOccurrenceId(),
                    state.getCurrent().getOccurrenceId(), state.getMode(), state.getMode(),
                    state.isQueueContextActive(), state.getHistoryCursor(), positionMs, occurrences, history);
            PlaybackCheckpointRepository.Result result = repository.applyTransition(expectedRevision, durable);
            if (result.getStatus() == PlaybackCheckpointRepository.Status.ACCEPTED) {
                return PlaybackCoordinator.PersistenceResult.accepted(result.getRevision());
            }
            if (result.getStatus() == PlaybackCheckpointRepository.Status.IDEMPOTENT) {
                return PlaybackCoordinator.PersistenceResult.idempotent(result.getRevision());
            }
            return PlaybackCoordinator.PersistenceResult.rejected(result.getRevision());
        }

        private static PlaybackCheckpointRepository.OccurrenceState occurrenceState(
                PlaybackQueueEngine.Occurrence occurrence, String role, int ordinal) {
            return new PlaybackCheckpointRepository.OccurrenceState(occurrence.getOccurrenceId(),
                    occurrence.getTrackHandle(), "bilibili", occurrence.getTrackHandle(), 1L, role, ordinal,
                    occurrence.isPlayable());
        }
    }
}
