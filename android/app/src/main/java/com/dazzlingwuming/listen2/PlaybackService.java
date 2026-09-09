package com.dazzlingwuming.listen2;

import android.content.Intent;
import android.net.Uri;
import android.os.Binder;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.webkit.CookieManager;

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
import com.dazzlingwuming.listen2.data.LocalDataRepository;
import com.dazzlingwuming.listen2.platform.AndroidMediaFilePort;
import com.dazzlingwuming.listen2.platform.AndroidMediaCache;
import com.dazzlingwuming.listen2.platform.SafMediaReferencePort;
import com.dazzlingwuming.listen2.provider.AdvancedPlaybackCapabilities;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

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
    private LocalPlaybackResolver<Uri> localPlaybackResolver;
    private LocalDataRepository localDataRepository;
    private AndroidMediaCache mediaCache;
    private final ListeningHistoryAccumulator listeningHistory = new ListeningHistoryAccumulator();
    private PlaybackCheckpointRepository checkpointRepository;
    private PlaybackSettingsStore settings;
    private final Map<String, PreparedMedia> preparedMediaByPageHandle = new LinkedHashMap<>();
    private final Map<String, SelectedMedia> selectedMediaByOccurrenceId = new LinkedHashMap<>();
    private final List<String> playbackHistory = new ArrayList<>();
    private int playbackHistoryCursor = -1;
    private String currentOccurrenceId = "";
    // Room revisions are deliberately independent of volatile page snapshots.
    // A player callback can publish several UI revisions before one bounded
    // semantic checkpoint reaches disk.
    private long durableCheckpointRevision;
    private long lastCheckpointAtMs;
    private long lastCheckpointPositionMs;
    private boolean recoveryLoaded;
    private LyricClockProjection.Identity currentLyricIdentity;
    private LyricClockProjection.Projection lyricProjection;
    private AdvancedPlaybackCapabilities advancedCapabilities = AdvancedPlaybackCapabilities.unavailable();
    private volatile boolean rendererAttached;
    private boolean cadenceScheduled;
    private final Runnable foregroundCadence = new Runnable() {
        @Override public void run() {
            cadenceScheduled = false;
            if (shouldPublishForegroundCadence(rendererAttached, latestPageSnapshot)) {
                publishPlayerSnapshot("ready", LyricClockProjection.Event.CADENCE);
            }
        }
    };
    private Handler playerHandler;
    private boolean released;
    private long snapshotRevision;
    // Main-looper generation prevents a slow native manifest resolution from
    // replacing a newer user selection after the page has moved on.
    private long mediaResolutionGeneration;
    private volatile PlaybackSnapshot latestPageSnapshot = initialSnapshot();
    private volatile PlaybackBridgeController.SnapshotPublisher snapshotPublisher;
    private final PageBinder pageBinder = new PageBinder();

    @Override
    public void onCreate() {
        super.onCreate();
        playerHandler = new Handler(Looper.getMainLooper());
        AudioAttributes attributes = new AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                .build();
        player = new ExoPlayer.Builder(this).build();
        player.setAudioAttributes(attributes, true);
        player.setHandleAudioBecomingNoisy(true);
        // Media playback remains legal when the screen is off; the lock is released
        // automatically by ExoPlayer whenever playback is paused or stopped.
        player.setWakeMode(C.WAKE_MODE_LOCAL);
        settings = new PlaybackSettingsStore(getApplicationContext());
        applyVolume();
        mediaSession = new MediaSession.Builder(this, player).build();
        // Playback checkpoints and the user-visible library share one Room
        // truth. Two database files made native history invisible to the app.
        database = Room.databaseBuilder(getApplicationContext(), Listen2Database.class, "listen2.db")
                .addMigrations(Listen2Database.MIGRATION_1_2, Listen2Database.MIGRATION_2_3,
                        Listen2Database.MIGRATION_3_4, Listen2Database.MIGRATION_4_5)
                .fallbackToDestructiveMigrationOnDowngrade(false)
                .build();
        localDataRepository = new LocalDataRepository(database,
                new AndroidMediaFilePort(getApplicationContext()));
        mediaCache = new AndroidMediaCache(getApplicationContext());
        SafMediaReferencePort localMediaPort = new SafMediaReferencePort(
                getApplicationContext(), database);
        localPlaybackResolver = new LocalPlaybackResolver<>(database,
                localMediaPort::resolveAuthorizedUri);
        checkpointRepository = new PlaybackCheckpointRepository(database);
        transitionExecutor = Executors.newSingleThreadExecutor();
        transitionExecutor.execute(() -> {
            PlaybackCheckpointRepository.RestoredState restored = checkpointRepository.restore();
            if (playerHandler != null) playerHandler.post(() -> applyRestoredCheckpoint(restored));
        });
        player.addListener(new Player.Listener() {
            @Override
            public void onPlaybackStateChanged(int playbackState) {
                if (playbackState == Player.STATE_ENDED) advanceToNext(latestPageSnapshot, true);
                publishPlayerSnapshot(playbackState == Player.STATE_ENDED ? "ended" : "ready",
                        playbackState == Player.STATE_ENDED ? LyricClockProjection.Event.ERROR
                                : LyricClockProjection.Event.STATE);
            }

            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                if (isPlaying) retainStartedPlaybackService();
                publishPlayerSnapshot(isPlaying ? "playing" : "interrupted", LyricClockProjection.Event.STATE);
            }

            @Override
            public void onPositionDiscontinuity(Player.PositionInfo oldPosition,
                    Player.PositionInfo newPosition, int reason) {
                publishPlayerSnapshot("ready", LyricClockProjection.Event.SEEK);
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
            if (playerHandler != null) playerHandler.post(() -> applyPlayerCommand(command, snapshot));
        });
    }

    /** ExoPlayer and MediaSession are main-looper confined even though semantic transitions serialize elsewhere. */
    private void applyPlayerCommand(PlaybackCommand command, PlaybackSnapshot snapshot) {
        if (released || player == null) return;
        rendererAttached = true;
        switch (command.getType()) {
            case PREPARE_SELECTION:
                prepareMedia(command, snapshot);
                break;
            case PLAY:
                retainStartedPlaybackService();
                if (player.getMediaItemCount() == 0 && !currentOccurrenceId.isEmpty()) {
                    SelectedMedia restored = selectedMediaByOccurrenceId.get(currentOccurrenceId);
                    if (restored != null) {
                        activateSelection(restored, snapshot, true, false, false, snapshot.getPositionMs());
                    } else {
                        publishPlayerSnapshot("retry-unavailable", LyricClockProjection.Event.ERROR);
                    }
                } else {
                    player.play();
                }
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
            case NEXT:
                advanceToNext(snapshot, false);
                break;
            case PREVIOUS:
                moveToPrevious(snapshot);
                break;
            case MODE:
                applyMode(snapshot);
                break;
            case REORDER:
            case REMOVE:
                reconcileSelectedMedia(snapshot);
                break;
            case RETRY:
                retrySelection(command, snapshot);
                break;
            case CLEAR:
                persistListeningHistory(true);
                listeningHistory.clear();
                mediaResolutionGeneration += 1L;
                preparedMediaByPageHandle.clear();
                selectedMediaByOccurrenceId.clear();
                playbackHistory.clear();
                playbackHistoryCursor = -1;
                currentOccurrenceId = "";
                currentLyricIdentity = null;
                lyricProjection = null;
                player.stop();
                player.clearMediaItems();
                clearCheckpoint();
                publishPlayerSnapshot("idle", LyricClockProjection.Event.ERROR);
                stopForeground(STOP_FOREGROUND_REMOVE);
                stopSelf();
                break;
            case SELECT_PREPARED:
                selectPreparedMedia(command, snapshot);
                break;
            default: break;
        }
    }

    /** Logical page selections are paired with native-only resolver handles before selection. */
    private void prepareMedia(PlaybackCommand command, PlaybackSnapshot snapshot) {
        PlaybackSnapshot.PreparedSelection pagePrepared = snapshot.getPreparedSelection();
        if (pagePrepared == null) return;
        Map<String, Object> payload = command.getPayload();
        String source = string(payload.get("source"));
        String providerTrackId = string(payload.get("providerTrackId"));
        long providerPartId = number(payload.get("providerPartId"));
        PlaybackMediaResolver.Descriptor descriptor = new PlaybackMediaResolver.Descriptor(source,
                providerTrackId, providerPartId, string(payload.get("title")), string(payload.get("artist")),
                number(payload.get("durationMs")), string(payload.get("mediaKind")));
        PlaybackMediaResolver activeResolver = newResolver(source);
        PlaybackMediaResolver.Prepared nativePrepared = activeResolver.prepare(descriptor);
        if (nativePrepared == null) return;
        preparedMediaByPageHandle.put(pagePrepared.getTrackHandle(), new PreparedMedia(activeResolver,
                nativePrepared, pagePrepared.getOccurrenceId()));
    }

    /** Candidate transport is consumed here only, on the Media3 service lane, and never copied to a snapshot. */
    private void selectPreparedMedia(PlaybackCommand command, PlaybackSnapshot snapshot) {
        String pageTrackHandle = string(command.getPayload().get("trackHandle"));
        String occurrenceId = string(command.getPayload().get("occurrenceId"));
        PreparedMedia preparedMedia = preparedMediaByPageHandle.remove(pageTrackHandle);
        if (preparedMedia == null || occurrenceId == null || !occurrenceId.equals(preparedMedia.pageOccurrenceId)) {
            publishPlayerSnapshot("stale-selection", LyricClockProjection.Event.ERROR);
            return;
        }
        String selectionAction = string(command.getPayload().get("selectionAction"));
        PlaybackMediaResolver.Selection selected = preparedMedia.resolver.select(
                preparedMedia.nativePrepared.getTrackHandle(), preparedMedia.nativePrepared.getOccurrenceId(),
                command.getExpectedRevision(), selectionAction,
                "playing".equals(snapshot.toMap().get("state")));
        if (!selected.isAccepted()) {
            publishPlayerSnapshot("stale-selection", LyricClockProjection.Event.ERROR);
            return;
        }
        SelectedMedia selectedMedia = new SelectedMedia(preparedMedia.resolver,
                preparedMedia.nativePrepared, pageTrackHandle, occurrenceId, command.getExpectedRevision());
        selectedMediaByOccurrenceId.put(occurrenceId, selectedMedia);
        if ("enqueue-next".equals(selectionAction)) {
            checkpointSemanticState(snapshot, 0L, true, "enqueue");
            return;
        }
        selectedMediaByOccurrenceId.clear();
        selectedMediaByOccurrenceId.put(occurrenceId, selectedMedia);
        playbackHistory.clear();
        playbackHistoryCursor = -1;
        checkpointSemanticState(snapshot, 0L, true, "select");
        activateSelection(selectedMedia, snapshot, selected.isPlayWhenReady(), true, true, 0L);
    }

    /** Each selected occurrence owns its own resolver state; queueing cannot replace another item's manifest. */
    private PlaybackMediaResolver newResolver(String source) {
        PlaybackMediaResolver.ManifestPort manifest;
        if ("local".equals(source)) {
            manifest = new LocalManifestPort();
        } else if ("netease".equals(source)) {
            manifest = new NetEasePlaybackResolver();
        } else {
            // Account cookies remain native-only and are read only by the
            // resolver; no cookie value enters a page reply or snapshot.
            manifest = new BilibiliPlaybackResolver(() -> {
                try {
                    return CookieManager.getInstance().getCookie("https://api.bilibili.com");
                } catch (RuntimeException ignored) {
                    return null;
                }
            });
        }
        return new PlaybackMediaResolver(manifest,
                new PlaybackMediaResolver.IncrementingHandleSource("service"),
                () -> System.currentTimeMillis() / 1000L);
    }

    private void activateSelection(SelectedMedia selectedMedia, PlaybackSnapshot snapshot,
            boolean playWhenReady, boolean recordHistory, boolean restartListeningHistory, long targetPositionMs) {
        PlaybackMediaResolver.Descriptor descriptor = selectedMedia.nativePrepared.descriptor();
        if (restartListeningHistory) {
            persistListeningHistory(true);
            listeningHistory.begin("listen." + java.util.UUID.randomUUID(), descriptor.getSource(),
                    descriptor.getProviderTrackId(), descriptor.getTitle(), descriptor.getArtist(),
                    descriptor.getDurationMs(), System.currentTimeMillis());
        }
        // The page occurrence is the semantic queue identity. The resolver
        // occurrence is deliberately separate and never crosses the page
        // snapshot/RPC/Room boundary.
        currentOccurrenceId = selectedMedia.pageOccurrenceId;
        advancedCapabilities = "bilibili".equals(descriptor.getSource())
                ? AdvancedPlaybackCapabilities.bilibiliPartSelectionOnly()
                : AdvancedPlaybackCapabilities.unavailable();
        currentLyricIdentity = new LyricClockProjection.Identity(descriptor.getSource(),
                descriptor.getProviderTrackId(), descriptor.getProviderPartId(), selectedMedia.pageTrackHandle,
                currentOccurrenceId, snapshot.getRevision());
        if (recordHistory) {
            while (playbackHistory.size() > playbackHistoryCursor + 1) {
                playbackHistory.remove(playbackHistory.size() - 1);
            }
            playbackHistory.add(currentOccurrenceId);
            playbackHistoryCursor = playbackHistory.size() - 1;
        }
        final long resolutionGeneration = ++mediaResolutionGeneration;
        final PlaybackMediaResolver resolverForSelection = selectedMedia.resolver;
        final String pageOccurrenceId = selectedMedia.pageOccurrenceId;
        final String nativeOccurrenceId = selectedMedia.nativePrepared.getOccurrenceId();
        final long expectedRevision = selectedMedia.selectionRevision;
        player.stop();
        player.clearMediaItems();
        // Manifest fetching uses a bounded native network client. Keep it off
        // Media3's main looper while retaining player mutation on that looper.
        transitionExecutor.execute(() -> {
            PlaybackMediaResolver.Resolution resolution = cachedResolution(descriptor);
            if (resolution == null) {
                resolution = resolverForSelection.resolveCurrent(nativeOccurrenceId, expectedRevision);
            }
            final PlaybackMediaResolver.Resolution selectedResolution = resolution;
            if (playerHandler != null) playerHandler.post(() -> applyResolvedMedia(
                    resolutionGeneration, pageOccurrenceId, descriptor,
                    selectedResolution, playWhenReady, targetPositionMs));
        });
    }

    /** A verified app-private file wins before any provider request, enabling true offline replay. */
    private PlaybackMediaResolver.Resolution cachedResolution(
            PlaybackMediaResolver.Descriptor descriptor) {
        if (mediaCache == null || descriptor == null
                || !("bilibili".equals(descriptor.getSource())
                || "netease".equals(descriptor.getSource()))) return null;
        Uri cached = mediaCache.readyUri(NativeMediaDownloadCoordinator.contentKeyFor(descriptor));
        if (cached == null) return null;
        try {
            return PlaybackMediaResolver.Resolution.ready(Collections.<String>emptyList(),
                    Collections.singletonList(new java.net.URI(cached.toString())));
        } catch (java.net.URISyntaxException ignored) {
            return null;
        }
    }

    /** Advances only through native-owned logical selections; no page URL is ever involved. */
    private void advanceToNext(PlaybackSnapshot snapshot, boolean naturalEnd) {
        SelectedMedia current = selectedMediaByOccurrenceId.get(currentOccurrenceId);
        if (current == null) {
            publishPlayerSnapshot("no-playable-next", LyricClockProjection.Event.ERROR);
            return;
        }
        PlaybackSnapshot.Mode mode = mode(snapshot.toMap().get("mode"));
        if (mode == PlaybackSnapshot.Mode.REPEAT_ONE) {
            activateSelection(current, snapshot, true, false, true, 0L);
            publishPlayerSnapshot("repeat-one", LyricClockProjection.Event.STATE);
            return;
        }
        List<PlaybackSnapshot.QueueOccurrence> queue = snapshot.getQueue();
        int currentIndex = occurrenceIndex(queue, currentOccurrenceId);
        SelectedMedia next = findNextSelected(queue, currentIndex, currentOccurrenceId, mode);
        if (next == null) {
            publishPlayerSnapshot(naturalEnd ? "no-playable-next" : "no-playable-next",
                    LyricClockProjection.Event.ERROR);
            return;
        }
        List<PlaybackSnapshot.QueueOccurrence> projectedQueue = new ArrayList<>(queue);
        if (currentIndex >= 0) projectedQueue.remove(currentIndex);
        if (occurrenceIndex(projectedQueue, next.pageOccurrenceId) < 0) {
            projectedQueue.add(queueOccurrence(next));
        }
        replaceQueueProjection(projectedQueue);
        activateSelection(next, snapshot, true, true, true, 0L);
        publishPlayerSnapshot(naturalEnd ? "natural-end" : "next", LyricClockProjection.Event.STATE);
    }

    private void moveToPrevious(PlaybackSnapshot snapshot) {
        String previousOccurrenceId = previousSemanticOccurrenceId(playbackHistory, playbackHistoryCursor,
                selectedMediaByOccurrenceId.keySet());
        if (previousOccurrenceId == null) {
            publishPlayerSnapshot("no-previous-history", LyricClockProjection.Event.ERROR);
            return;
        }
        playbackHistoryCursor -= 1;
        SelectedMedia previous = selectedMediaByOccurrenceId.get(previousOccurrenceId);
        if (previous == null) {
            publishPlayerSnapshot("no-previous-history", LyricClockProjection.Event.ERROR);
            return;
        }
        List<PlaybackSnapshot.QueueOccurrence> projectedQueue = new ArrayList<>(snapshot.getQueue());
        for (int index = projectedQueue.size() - 1; index >= 0; index -= 1) {
            if (previous.pageOccurrenceId.equals(projectedQueue.get(index).getOccurrenceId())) {
                projectedQueue.remove(index);
            }
        }
        projectedQueue.add(0, queueOccurrence(previous));
        replaceQueueProjection(projectedQueue);
        activateSelection(previous, snapshot, true, false, true, 0L);
        publishPlayerSnapshot("previous", LyricClockProjection.Event.STATE);
    }

    private void retrySelection(PlaybackCommand command, PlaybackSnapshot snapshot) {
        SelectedMedia selectedMedia = selectedMediaByOccurrenceId.get(
                string(command.getPayload().get("occurrenceId")));
        if (selectedMedia == null) {
            publishPlayerSnapshot("retry-unavailable", LyricClockProjection.Event.ERROR);
            return;
        }
        activateSelection(selectedMedia, snapshot, true, false, false, snapshot.getPositionMs());
    }

    private void applyMode(PlaybackSnapshot snapshot) {
        PlaybackSnapshot.Mode selectedMode = mode(snapshot.toMap().get("mode"));
        player.setShuffleModeEnabled(selectedMode == PlaybackSnapshot.Mode.SHUFFLE);
        player.setRepeatMode(selectedMode == PlaybackSnapshot.Mode.REPEAT_ONE ? Player.REPEAT_MODE_ONE
                : selectedMode == PlaybackSnapshot.Mode.REPEAT_ALL ? Player.REPEAT_MODE_ALL
                : Player.REPEAT_MODE_OFF);
        checkpointSemanticState(snapshot, Math.max(0L, player.getCurrentPosition()), true, "mode");
    }

    /** Queue mutations were already schema-validated by the bridge; discard stale native descriptors. */
    private void reconcileSelectedMedia(PlaybackSnapshot snapshot) {
        List<String> retained = new ArrayList<>();
        for (PlaybackSnapshot.QueueOccurrence occurrence : snapshot.getQueue()) {
            retained.add(occurrence.getOccurrenceId());
        }
        selectedMediaByOccurrenceId.keySet().retainAll(retained);
        playbackHistory.retainAll(retained);
        playbackHistoryCursor = Math.min(playbackHistoryCursor, playbackHistory.size() - 1);
        if (!currentOccurrenceId.isEmpty() && !selectedMediaByOccurrenceId.containsKey(currentOccurrenceId)) {
            currentOccurrenceId = "";
            currentLyricIdentity = null;
            lyricProjection = null;
            mediaResolutionGeneration += 1L;
            player.stop();
            player.clearMediaItems();
            publishPlayerSnapshot("current-selection-removed", LyricClockProjection.Event.ERROR);
        }
        checkpointSemanticState(snapshot, Math.max(0L, player.getCurrentPosition()), true, "queue");
    }

    private SelectedMedia findNextSelected(List<PlaybackSnapshot.QueueOccurrence> queue, int currentIndex,
            String currentId, PlaybackSnapshot.Mode mode) {
        String occurrenceId = nextSemanticOccurrenceId(queue, currentIndex, currentId,
                selectedMediaByOccurrenceId.keySet(), mode);
        return occurrenceId == null ? null : selectedMediaByOccurrenceId.get(occurrenceId);
    }

    /** Pure queue identity projection used by the service and its JVM regression test. */
    static String nextSemanticOccurrenceId(List<PlaybackSnapshot.QueueOccurrence> queue, int currentIndex,
            String currentId, Set<String> playableIds, PlaybackSnapshot.Mode mode) {
        if (queue == null || playableIds == null || currentId == null) return null;
        if (mode == PlaybackSnapshot.Mode.SHUFFLE) {
            List<String> shuffled = new ArrayList<>();
            for (PlaybackSnapshot.QueueOccurrence occurrence : queue) {
                String occurrenceId = occurrence.getOccurrenceId();
                if (!occurrenceId.equals(currentId) && playableIds.contains(occurrenceId)) {
                    shuffled.add(occurrenceId);
                }
            }
            if (shuffled.isEmpty()) {
                for (String occurrenceId : playableIds) {
                    if (!occurrenceId.equals(currentId)) shuffled.add(occurrenceId);
                }
            }
            if (!shuffled.isEmpty()) {
                return shuffled.get(Math.floorMod(currentId.hashCode(), shuffled.size()));
            }
            return null;
        }
        int start = currentIndex < 0 ? 0 : currentIndex + 1;
        for (int index = start; index < queue.size(); index += 1) {
            String occurrenceId = queue.get(index).getOccurrenceId();
            if (!occurrenceId.equals(currentId) && playableIds.contains(occurrenceId)) return occurrenceId;
        }
        if (mode == PlaybackSnapshot.Mode.REPEAT_ALL) {
            for (String occurrenceId : playableIds) {
                if (!occurrenceId.equals(currentId)) return occurrenceId;
            }
        }
        return null;
    }

    static String previousSemanticOccurrenceId(List<String> history, int cursor, Set<String> playableIds) {
        if (history == null || playableIds == null) return null;
        for (int index = Math.min(cursor - 1, history.size() - 1); index >= 0; index -= 1) {
            String occurrenceId = history.get(index);
            if (playableIds.contains(occurrenceId)) return occurrenceId;
        }
        return null;
    }

    private static PlaybackSnapshot.QueueOccurrence queueOccurrence(SelectedMedia selectedMedia) {
        PlaybackMediaResolver.Descriptor descriptor = selectedMedia.nativePrepared.descriptor();
        return new PlaybackSnapshot.QueueOccurrence(selectedMedia.pageOccurrenceId,
                selectedMedia.pageTrackHandle, descriptor.getTitle(), descriptor.getArtist(),
                descriptor.getDurationMs());
    }

    private synchronized void replaceQueueProjection(List<PlaybackSnapshot.QueueOccurrence> queue) {
        PlaybackSnapshot previous = latestPageSnapshot;
        latestPageSnapshot = new PlaybackSnapshot(1, previous.getPageEpoch(), previous.getRevision(),
                previous.getState(), previous.getMetadata(), previous.getPositionMs(), previous.getDurationMs(),
                previous.getVolumePercent(), previous.isMuted(), previous.getMode(),
                previous.getActionAvailability(), queue, previous.getPreparedSelection(),
                previous.getRecoveryStatus(), previous.getLyricContext(), previous.getAdvancedCapabilities());
    }

    private static int occurrenceIndex(List<PlaybackSnapshot.QueueOccurrence> queue, String occurrenceId) {
        for (int index = 0; index < queue.size(); index += 1) {
            if (occurrenceId.equals(queue.get(index).getOccurrenceId())) return index;
        }
        return -1;
    }

    /** Applies a transient native-only candidate after its resolver task completes. */
    private void applyResolvedMedia(long resolutionGeneration, String pageOccurrenceId,
            PlaybackMediaResolver.Descriptor descriptor,
            PlaybackMediaResolver.Resolution resolution, boolean playWhenReady, long targetPositionMs) {
        if (released || player == null || resolutionGeneration != mediaResolutionGeneration) return;
        if (!resolution.isReady() || resolution.mediaUris().isEmpty()) {
            publishPlayerSnapshot(resolution.getStatus(), LyricClockProjection.Event.ERROR);
            return;
        }
        String mediaLocation = resolution.mediaUris().get(0).toString();
        if (mediaCache != null && descriptor != null
                && ("bilibili".equals(descriptor.getSource()) || "netease".equals(descriptor.getSource()))) {
            Uri cached = mediaCache.readyUri(NativeMediaDownloadCoordinator.contentKeyFor(descriptor));
            if (cached != null) mediaLocation = cached.toString();
        }
        MediaMetadata mediaMetadata = new MediaMetadata.Builder().setTitle(descriptor.getTitle())
                .setArtist(descriptor.getArtist()).build();
        player.setMediaItem(new MediaItem.Builder().setMediaId(pageOccurrenceId)
                .setUri(mediaLocation).setMediaMetadata(mediaMetadata).build());
        player.prepare();
        if (targetPositionMs > 0L) player.seekTo(targetPositionMs);
        player.setPlayWhenReady(playWhenReady);
    }

    /** A bound page is disposable; active audio must also retain a started service lifecycle. */
    private void retainStartedPlaybackService() {
        try {
            startService(new Intent(this, PlaybackService.class));
        } catch (IllegalStateException ignored) {
            // The existing service/session remains truthful even if a background-start policy rejects retention.
        }
    }

    @Override
    public void rendererDetached() {
        rendererAttached = false;
        if (playerHandler != null) playerHandler.removeCallbacks(foregroundCadence);
        cadenceScheduled = false;
    }

    @Override
    public void setSnapshotPublisher(PlaybackBridgeController.SnapshotPublisher publisher) {
        snapshotPublisher = publisher;
        if (publisher != null && latestPageSnapshot != null) publisher.publish(latestPageSnapshot);
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
            if (playerHandler != null) playerHandler.removeCallbacks(foregroundCadence);
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
        playerHandler = null;
        if (database != null) {
            database.close();
            database = null;
        }
        localDataRepository = null;
        localPlaybackResolver = null;
        mediaCache = null;
        localPlaybackResolver = null;
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
        publishPlayerSnapshot(recoveryCode, LyricClockProjection.Event.STATE);
    }

    private synchronized void publishPlayerSnapshot(String recoveryCode, LyricClockProjection.Event event) {
        if (released || player == null) return;
        PlaybackSnapshot previous = latestPageSnapshot;
        Map<String, Object> prior = previous.toMap();
        long revision = Math.max(snapshotRevision, previous.getRevision()) + 1L;
        snapshotRevision = revision;
        long position = Math.max(0L, player.getCurrentPosition());
        long duration = player.getDuration() == C.TIME_UNSET ? 0L : Math.max(0L, player.getDuration());
        listeningHistory.updateDuration(duration);
        listeningHistory.observe(position, player.isPlaying(), System.currentTimeMillis());
        persistListeningHistory(!player.isPlaying());
        PlaybackSnapshot.State state;
        if (player.isPlaying()) state = PlaybackSnapshot.State.PLAYING;
        else if (player.getPlaybackState() == Player.STATE_IDLE) state = PlaybackSnapshot.State.IDLE;
        else if (player.getPlaybackState() == Player.STATE_BUFFERING) state = PlaybackSnapshot.State.RESOLVING;
        else state = PlaybackSnapshot.State.PAUSED;
        PlaybackSnapshot.LyricContext lyric = currentLyricIdentity == null
                ? PlaybackSnapshot.LyricContext.unavailable() : previous.getLyricContext();
        if (currentLyricIdentity != null) {
            String lyricCapability = "local".equals(currentLyricIdentity.getSource())
                    ? "unavailable" : "available";
            lyricProjection = LyricClockProjection.project(lyricProjection, currentLyricIdentity, revision,
                    position, duration, state, lyricCapability, event);
            lyric = lyricProjection.toLyricContext();
        }
        latestPageSnapshot = new PlaybackSnapshot(1, number(prior.get("pageEpoch")), revision, state,
                currentMetadata(prior, duration), position, duration, settings.getVolumePercent(), settings.isMuted(),
                mode(prior.get("mode")), actions(duration), previous.getQueue(), previous.getPreparedSelection(),
                new PlaybackSnapshot.RecoveryStatus(recoveryCode, isRetryableRecovery(recoveryCode)), lyric,
                advancedCapabilities);
        checkpointSemanticState(latestPageSnapshot, position, false, "position");
        scheduleForegroundCadence();
        PlaybackBridgeController.SnapshotPublisher publisher = snapshotPublisher;
        if (publisher != null) publisher.publish(latestPageSnapshot);
    }

    private void scheduleForegroundCadence() {
        if (cadenceScheduled || playerHandler == null
                || !shouldPublishForegroundCadence(rendererAttached, latestPageSnapshot)) return;
        cadenceScheduled = true;
        playerHandler.postDelayed(foregroundCadence, 500L);
    }

    /** Room receives cumulative, idempotent samples off the Media3 main looper. */
    private void persistListeningHistory(boolean force) {
        ListeningHistoryAccumulator.Sample sample = listeningHistory.drainForPersistence(force);
        ExecutorService executor = transitionExecutor;
        LocalDataRepository repository = localDataRepository;
        if (sample == null || executor == null || repository == null || released) return;
        executor.execute(() -> repository.ingestHistory(new LocalDataRepository.HistoryInput(
                sample.sessionId,
                new LocalDataRepository.Track(sample.source, sample.providerTrackId,
                        sample.title, sample.artist, sample.durationMs),
                sample.cumulativePlayedMs, sample.durationMs, sample.occurredAtMs)));
    }

    static boolean shouldPublishForegroundCadence(boolean rendererAttached, PlaybackSnapshot snapshot) {
        if (!rendererAttached || snapshot == null || !snapshot.getLyricContext().isAvailable()) return false;
        Object state = snapshot.toMap().get("state");
        return "playing".equals(state) || "resolving".equals(state);
    }

    /** Installs only freshly-minted resolver state; no transport survives this boundary. */
    private void applyRestoredCheckpoint(PlaybackCheckpointRepository.RestoredState restored) {
        if (released) return;
        durableCheckpointRevision = restored.getRevision();
        lastCheckpointPositionMs = restored.getPositionMs();
        lastCheckpointAtMs = System.currentTimeMillis();
        selectedMediaByOccurrenceId.clear();
        playbackHistory.clear();
        playbackHistoryCursor = -1;
        currentOccurrenceId = "";
        if (restored.getRevision() <= 0L || restored.getCurrentOccurrenceId().isEmpty()) {
            recoveryLoaded = true;
            latestPageSnapshot = initialSnapshot();
            snapshotRevision = 0L;
            return;
        }
        for (PlaybackCheckpointRepository.OccurrenceState occurrence : restored.getOccurrenceStates()) {
            if (!occurrence.isPlayable()) continue;
            PlaybackMediaResolver.Descriptor descriptor = new PlaybackMediaResolver.Descriptor(
                    occurrence.getSource(), occurrence.getProviderTrackId(), occurrence.getProviderPartId(),
                    occurrence.getTitle(), occurrence.getArtist(), occurrence.getDurationMs(),
                    occurrence.getMediaKind());
            PlaybackMediaResolver resolver = newResolver(occurrence.getSource());
            PlaybackMediaResolver.Prepared prepared = resolver.prepare(descriptor);
            if (prepared == null || !resolver.select(prepared.getTrackHandle(), prepared.getOccurrenceId(),
                    restored.getRevision(), "replace-current", false).isAccepted()) continue;
            selectedMediaByOccurrenceId.put(occurrence.getOccurrenceId(), new SelectedMedia(resolver, prepared,
                    occurrence.getTrackHandle(), occurrence.getOccurrenceId(), restored.getRevision()));
        }
        SelectedMedia current = selectedMediaByOccurrenceId.get(restored.getCurrentOccurrenceId());
        if (current == null) {
            // v4 checkpoints did not have sufficient descriptor metadata. They
            // fail closed rather than inventing a provider identity or URL.
            recoveryLoaded = true;
            latestPageSnapshot = initialSnapshot();
            snapshotRevision = 0L;
            return;
        }
        currentOccurrenceId = restored.getCurrentOccurrenceId();
        for (String occurrenceId : restored.getHistoryOccurrenceIds()) {
            if (selectedMediaByOccurrenceId.containsKey(occurrenceId)) playbackHistory.add(occurrenceId);
        }
        playbackHistoryCursor = playbackHistory.isEmpty() ? -1
                : Math.min(restored.getHistoryCursor(), playbackHistory.size() - 1);
        PlaybackMediaResolver.Descriptor descriptor = current.nativePrepared.descriptor();
        currentLyricIdentity = new LyricClockProjection.Identity(descriptor.getSource(),
                descriptor.getProviderTrackId(), descriptor.getProviderPartId(), current.pageTrackHandle,
                currentOccurrenceId, restored.getRevision());
        advancedCapabilities = "bilibili".equals(descriptor.getSource())
                ? AdvancedPlaybackCapabilities.bilibiliPartSelectionOnly()
                : AdvancedPlaybackCapabilities.unavailable();
        latestPageSnapshot = restoredSnapshot(restored);
        snapshotRevision = restored.getRevision();
        recoveryLoaded = true;
        PlaybackBridgeController.SnapshotPublisher publisher = snapshotPublisher;
        if (publisher != null) publisher.publish(latestPageSnapshot);
    }

    /** Rebuilds a paused/actionable semantic projection after process death; transport never survives it. */
    private PlaybackSnapshot restoredSnapshot(PlaybackCheckpointRepository.RestoredState restored) {
        if (restored.getRevision() <= 0L || restored.getCurrentOccurrenceId().isEmpty()) return initialSnapshot();
        List<PlaybackSnapshot.QueueOccurrence> queue = new ArrayList<>();
        for (String occurrenceId : restored.getQueueOccurrenceIds()) {
            PlaybackCheckpointRepository.OccurrenceState occurrence = restored.getOccurrenceState(occurrenceId);
            if (occurrence != null && selectedMediaByOccurrenceId.containsKey(occurrenceId)) {
                queue.add(new PlaybackSnapshot.QueueOccurrence(occurrence.getOccurrenceId(),
                        occurrence.getTrackHandle(), occurrence.getTitle(), occurrence.getArtist(),
                        occurrence.getDurationMs()));
            }
        }
        PlaybackCheckpointRepository.OccurrenceState current = restored.getOccurrenceState(
                restored.getCurrentOccurrenceId());
        if (current == null) return initialSnapshot();
        long restoredPosition = current.getDurationMs() > 0L
                ? Math.min(restored.getPositionMs(), current.getDurationMs()) : restored.getPositionMs();
        return new PlaybackSnapshot(1, 0L, restored.getRevision(), PlaybackSnapshot.State.PAUSED,
                new PlaybackSnapshot.Metadata(current.getTitle(), current.getArtist(), current.getDurationMs(),
                        "bundled-placeholder"),
                restoredPosition, current.getDurationMs(),
                settings.getVolumePercent(), settings.isMuted(),
                snapshotMode(restored.getMode()),
                new PlaybackSnapshot.ActionAvailability(true, false, restored.getHistoryCursor() > 0,
                        queue.size() > 1, current.getDurationMs() > 0L, true), queue, null,
                new PlaybackSnapshot.RecoveryStatus("restored", true));
    }

    /** Captures a bounded semantic draft on the main lane, then commits it serially to Room. */
    private void checkpointSemanticState(PlaybackSnapshot snapshot, long positionMs, boolean force,
            String reason) {
        if (!recoveryLoaded || snapshot == null || checkpointRepository == null || transitionExecutor == null
                || currentOccurrenceId.isEmpty()) return;
        long now = System.currentTimeMillis();
        long safePosition = Math.max(0L, positionMs);
        if (!force && now - lastCheckpointAtMs < PlaybackCoordinator.POSITION_CHECKPOINT_INTERVAL_MS
                && Math.abs(safePosition - lastCheckpointPositionMs) < 1_000L) return;
        List<String> orderedIds = new ArrayList<>();
        for (PlaybackSnapshot.QueueOccurrence occurrence : snapshot.getQueue()) {
            if (occurrence != null && !orderedIds.contains(occurrence.getOccurrenceId())) {
                orderedIds.add(occurrence.getOccurrenceId());
            }
        }
        if (!orderedIds.contains(currentOccurrenceId)) orderedIds.add(0, currentOccurrenceId);
        List<PlaybackCheckpointRepository.OccurrenceState> occurrences = new ArrayList<>();
        for (int index = 0; index < orderedIds.size(); index += 1) {
            SelectedMedia selected = selectedMediaByOccurrenceId.get(orderedIds.get(index));
            if (selected == null) return; // A page-only row has no trusted resolver identity yet.
            PlaybackMediaResolver.Descriptor descriptor = selected.nativePrepared.descriptor();
            occurrences.add(new PlaybackCheckpointRepository.OccurrenceState(selected.pageOccurrenceId,
                    selected.pageTrackHandle, descriptor.getSource(), descriptor.getProviderTrackId(),
                    descriptor.getProviderPartId(), descriptor.getTitle(), descriptor.getArtist(),
                    descriptor.getDurationMs(), descriptor.getMediaKind(), "queue", index, true));
        }
        List<PlaybackCheckpointRepository.HistoryState> history = new ArrayList<>();
        for (String occurrenceId : playbackHistory) {
            if (selectedMediaByOccurrenceId.containsKey(occurrenceId)) {
                history.add(new PlaybackCheckpointRepository.HistoryState(history.size(), occurrenceId, now));
            }
        }
        int cursor = history.isEmpty() ? 0 : Math.min(Math.max(0, playbackHistoryCursor), history.size() - 1);
        CheckpointDraft draft = new CheckpointDraft(snapshotMode(snapshot.getMode()), currentOccurrenceId,
                safePosition, occurrences, history, cursor, reason, now);
        lastCheckpointAtMs = now;
        lastCheckpointPositionMs = safePosition;
        transitionExecutor.execute(() -> persistCheckpointDraft(draft));
    }

    private void persistCheckpointDraft(CheckpointDraft draft) {
        if (released || checkpointRepository == null || draft == null) return;
        long nextRevision = durableCheckpointRevision + 1L;
        PlaybackCheckpointRepository.DurableState state = new PlaybackCheckpointRepository.DurableState(
                nextRevision, "checkpoint-" + nextRevision + "-" + draft.createdAtMs,
                "android-context", draft.currentOccurrenceId, draft.currentOccurrenceId, draft.mode, draft.mode,
                false, draft.historyCursor, draft.positionMs, draft.occurrences, draft.history);
        PlaybackCheckpointRepository.Result result = checkpointRepository.applyTransition(durableCheckpointRevision,
                state);
        if (result.getStatus() == PlaybackCheckpointRepository.Status.ACCEPTED
                || result.getStatus() == PlaybackCheckpointRepository.Status.IDEMPOTENT) {
            durableCheckpointRevision = result.getRevision();
        }
    }

    private void clearCheckpoint() {
        ExecutorService executor = transitionExecutor;
        if (executor == null || checkpointRepository == null) return;
        durableCheckpointRevision = 0L;
        recoveryLoaded = false;
        executor.execute(() -> checkpointRepository.clear());
    }

    private static PlaybackQueueEngine.Mode snapshotMode(PlaybackSnapshot.Mode value) {
        if (value == PlaybackSnapshot.Mode.SHUFFLE) return PlaybackQueueEngine.Mode.SHUFFLE;
        if (value == PlaybackSnapshot.Mode.REPEAT_ONE) return PlaybackQueueEngine.Mode.REPEAT_ONE;
        if (value == PlaybackSnapshot.Mode.REPEAT_ALL) return PlaybackQueueEngine.Mode.REPEAT_ALL;
        return PlaybackQueueEngine.Mode.SEQUENTIAL;
    }

    private static final class CheckpointDraft {
        final PlaybackQueueEngine.Mode mode;
        final String currentOccurrenceId;
        final long positionMs;
        final List<PlaybackCheckpointRepository.OccurrenceState> occurrences;
        final List<PlaybackCheckpointRepository.HistoryState> history;
        final int historyCursor;
        final String reason;
        final long createdAtMs;

        CheckpointDraft(PlaybackQueueEngine.Mode mode, String currentOccurrenceId, long positionMs,
                List<PlaybackCheckpointRepository.OccurrenceState> occurrences,
                List<PlaybackCheckpointRepository.HistoryState> history, int historyCursor, String reason,
                long createdAtMs) {
            this.mode = mode;
            this.currentOccurrenceId = currentOccurrenceId;
            this.positionMs = positionMs;
            this.occurrences = Collections.unmodifiableList(new ArrayList<>(occurrences));
            this.history = Collections.unmodifiableList(new ArrayList<>(history));
            this.historyCursor = historyCursor;
            this.reason = reason;
            this.createdAtMs = createdAtMs;
        }
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

    private PlaybackSnapshot.Metadata currentMetadata(Map<String, Object> prior, long duration) {
        SelectedMedia selected = selectedMediaByOccurrenceId.get(currentOccurrenceId);
        if (selected != null) {
            PlaybackMediaResolver.Descriptor descriptor = selected.nativePrepared.descriptor();
            return new PlaybackSnapshot.Metadata(descriptor.getTitle(), descriptor.getArtist(), duration,
                    "bundled-placeholder");
        }
        return metadata(prior, duration);
    }

    private static boolean isRetryableRecovery(String recoveryCode) {
        return "interrupted".equals(recoveryCode) || "manifest-unavailable".equals(recoveryCode)
                || "bilibili-manifest-unavailable".equals(recoveryCode)
                || "netease-manifest-unavailable".equals(recoveryCode)
                || "refresh-unavailable".equals(recoveryCode)
                || LocalPlaybackResolver.STATUS_IO_UNAVAILABLE.equals(recoveryCode)
                || LocalPlaybackResolver.STATUS_GRANT_INVALID.equals(recoveryCode)
                || LocalPlaybackResolver.STATUS_NEEDS_REPAIR.equals(recoveryCode)
                || LocalPlaybackResolver.STATUS_REVOKED.equals(recoveryCode);
    }

    private PlaybackSnapshot.ActionAvailability actions(long duration) {
        boolean hasMedia = player.getMediaItemCount() > 0;
        return new PlaybackSnapshot.ActionAvailability(hasMedia && !player.isPlaying(), hasMedia && player.isPlaying(),
                playbackHistoryCursor > 0, hasSemanticNext(), duration > 0L,
                selectedMediaByOccurrenceId.containsKey(currentOccurrenceId));
    }

    private boolean hasSemanticNext() {
        if (currentOccurrenceId.isEmpty()) return false;
        PlaybackSnapshot snapshot = latestPageSnapshot;
        if (snapshot == null) return false;
        PlaybackSnapshot.Mode selectedMode = snapshot.getMode();
        int index = occurrenceIndex(snapshot.getQueue(), currentOccurrenceId);
        return findNextSelected(snapshot.getQueue(), index, currentOccurrenceId, selectedMode) != null;
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

    private static String string(Object value) {
        return value instanceof String ? (String) value : "";
    }

    /** Adapts the native SAF URI resolver to the existing transient resolver lane. */
    private final class LocalManifestPort implements PlaybackMediaResolver.ManifestPort {
        private String lastStatus = LocalPlaybackResolver.STATUS_IO_UNAVAILABLE;
        private String authorizedTrackId = "";
        private Uri authorizedUri;

        @Override
        public List<String> resolve(PlaybackMediaResolver.Descriptor descriptor) {
            LocalPlaybackResolver<Uri> resolver = localPlaybackResolver;
            if (resolver == null || descriptor == null
                    || !"local".equals(descriptor.getSource())) {
                lastStatus = LocalPlaybackResolver.STATUS_IO_UNAVAILABLE;
                return Collections.emptyList();
            }
            LocalPlaybackResolver.Resolution<Uri> resolved = resolver.resolve(
                    descriptor.getProviderTrackId());
            lastStatus = resolved.status;
            if (!resolved.ok || resolved.mediaHandle == null) {
                authorizedTrackId = "";
                authorizedUri = null;
                return Collections.emptyList();
            }
            authorizedTrackId = descriptor.getProviderTrackId();
            authorizedUri = resolved.mediaHandle;
            return Collections.singletonList(resolved.mediaHandle.toString());
        }

        @Override
        public boolean isAuthorizedLocalUri(PlaybackMediaResolver.Descriptor descriptor, java.net.URI uri) {
            if (descriptor == null || uri == null || !"local".equals(descriptor.getSource())
                    || !descriptor.getProviderTrackId().equals(authorizedTrackId)
                    || authorizedUri == null) return false;
            return authorizedUri.toString().equals(uri.toString());
        }

        @Override
        public String unavailableStatus() {
            return lastStatus;
        }
    }

    private static final class PreparedMedia {
        final PlaybackMediaResolver resolver;
        final PlaybackMediaResolver.Prepared nativePrepared;
        final String pageOccurrenceId;

        PreparedMedia(PlaybackMediaResolver resolver, PlaybackMediaResolver.Prepared nativePrepared,
                String pageOccurrenceId) {
            this.resolver = resolver;
            this.nativePrepared = nativePrepared;
            this.pageOccurrenceId = pageOccurrenceId;
        }
    }

    /** Resolver state is scoped to one opaque occurrence, never to a page-provided transport value. */
    private static final class SelectedMedia {
        final PlaybackMediaResolver resolver;
        final PlaybackMediaResolver.Prepared nativePrepared;
        final String pageTrackHandle;
        final String pageOccurrenceId;
        final long selectionRevision;

        SelectedMedia(PlaybackMediaResolver resolver, PlaybackMediaResolver.Prepared nativePrepared,
                String pageTrackHandle, String pageOccurrenceId, long selectionRevision) {
            this.resolver = resolver;
            this.nativePrepared = nativePrepared;
            this.pageTrackHandle = pageTrackHandle;
            this.pageOccurrenceId = pageOccurrenceId;
            this.selectionRevision = selectionRevision;
        }
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
            if (playerHandler == null) throw new IllegalStateException("player released");
            playerHandler.post(() -> {
                if (player == null || released) return;
                MediaMetadata metadata = new MediaMetadata.Builder()
                        .setTitle("Listen2")
                        .setArtist("Bilibili")
                        .build();
                player.setMediaItem(new MediaItem.Builder().setMediaId(projection.getOccurrenceId())
                        .setMediaMetadata(metadata).build());
                player.prepare();
                player.setPlayWhenReady(projection.isPlayWhenReady());
            });
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
