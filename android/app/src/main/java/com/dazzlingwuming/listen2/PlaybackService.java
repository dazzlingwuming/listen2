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
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.ArrayList;
import java.util.List;

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
        settings = new PlaybackSettingsStore(getApplicationContext());
        applyVolume();
        mediaSession = new MediaSession.Builder(this, player).build();
        database = Room.databaseBuilder(getApplicationContext(), Listen2Database.class, "listen2-playback.db")
                .fallbackToDestructiveMigrationOnDowngrade(false)
                .build();
        checkpointRepository = new PlaybackCheckpointRepository(database);
        transitionExecutor = Executors.newSingleThreadExecutor();
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
        return 0L;
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
