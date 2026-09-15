package com.listen2mobile.bilibili

import android.content.Context
import android.view.SurfaceView
import android.widget.FrameLayout
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.C
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector

/**
 * A deliberately muted video renderer. RNTP owns audio focus, MediaSession and notification
 * playback; this surface never configures audio attributes or starts an audio service.
 */
@OptIn(UnstableApi::class)
internal class BilibiliMvView(context: Context, private val controller: BilibiliMvController) : FrameLayout(context) {
    private val surface = SurfaceView(context)
    private var player: ExoPlayer? = null
    private var handle: String? = null
    private var bindGeneration = 0L
    private var lastPlayIntent = false
    private var hostPaused = false
    private var sourceUrls: List<String> = emptyList()
    private var sourceIndex = 0
    // Kept explicit for source/test inspection: no audio-focus API is called by this view.
    private val handleAudioFocus = false

    init {
        addView(surface, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    }

    fun setOpaqueHandle(value: String?) {
        val next = value?.takeIf(BilibiliMvPolicy::isOpaqueHandle)
        if (next == handle) return
        bindGeneration += 1
        detachSurface()
        handle = next
        val binding = controller.surfaceBinding(next) ?: run { release(); return }
        val video = player ?: createVideoOnlyPlayer()
        val generation = bindGeneration
        val boundHandle = next
        video.addListener(object : Player.Listener {
            override fun onPlayerError(error: PlaybackException) {
                if (generation != bindGeneration || boundHandle != handle) return
                if (sourceIndex + 1 < sourceUrls.size) {
                    sourceIndex += 1
                    val position = controller.surfaceBinding(boundHandle)?.positionMs ?: 0L
                    prepare(video, sourceIndex, position)
                } else {
                    controller.surfaceFailed(boundHandle)
                    releaseHandle(boundHandle)
                }
            }
        })
        sourceUrls = binding.urls
        sourceIndex = 0
        video.setVideoSurfaceView(surface)
        prepare(video, sourceIndex, binding.positionMs)
        lastPlayIntent = binding.playIntent
        video.playWhenReady = binding.playIntent && !hostPaused
    }

    fun detach() {
        bindGeneration += 1
        detachSurface()
        handle = null
        release()
    }

    fun releaseHandle(value: String?) {
        if (handle == value) {
            bindGeneration += 1
            detachSurface()
            handle = null
            release()
        }
    }

    fun activeHandle(): String? = handle
    fun isSurfaceReady(value: String?) =
        value != null &&
            value == handle &&
            player != null &&
            isAttachedToWindow &&
            surface.holder.surface.isValid

    fun sync(handle: String?, positionMs: Long, playIntent: Boolean) {
        if (this.handle != handle) return
        val video = player ?: return
        val driftMs = positionMs - video.currentPosition
        when {
            kotlin.math.abs(driftMs) > 750L -> {
                video.seekTo(positionMs)
                video.setPlaybackSpeed(1f)
            }
            kotlin.math.abs(driftMs) > 80L -> video.setPlaybackSpeed(if (driftMs > 0) 1.03f else 0.97f)
            else -> video.setPlaybackSpeed(1f)
        }
        lastPlayIntent = playIntent
        video.playWhenReady = playIntent && !hostPaused
    }

    fun pauseForBackground() {
        hostPaused = true
        player?.playWhenReady = false
    }

    fun resumeAfterHost() {
        hostPaused = false
        player?.playWhenReady = lastPlayIntent
    }

    private fun createVideoOnlyPlayer(): ExoPlayer {
        // ExoPlayer defaults to no focus handling. Do not call setAudioAttributes: that would
        // create an audio policy path competing with the existing RNTP service.
        check(!handleAudioFocus)
        val trackSelector = DefaultTrackSelector(context).also { selector ->
            selector.parameters = selector.buildUponParameters().setTrackTypeDisabled(C.TRACK_TYPE_AUDIO, true).build()
        }
        return ExoPlayer.Builder(context).setTrackSelector(trackSelector).build().also { created ->
            created.volume = 0f
            player = created
        }
    }

    /** Fixed native-only header: JavaScript cannot supply media headers to this surface. */
    private fun prepare(video: ExoPlayer, index: Int, positionMs: Long) {
        val source = ProgressiveMediaSource.Factory(
            DefaultHttpDataSource.Factory().setDefaultRequestProperties(mapOf("Referer" to BilibiliPolicy.FIXED_REFERER)),
        ).createMediaSource(MediaItem.fromUri(sourceUrls[index]))
        video.setMediaSource(source)
        if (positionMs > 0L) video.seekTo(positionMs)
        video.prepare()
    }

    private fun detachSurface() {
        player?.clearVideoSurfaceView(surface)
    }

    private fun release() {
        bindGeneration += 1
        player?.release()
        player = null
        sourceUrls = emptyList()
        sourceIndex = 0
    }
}
