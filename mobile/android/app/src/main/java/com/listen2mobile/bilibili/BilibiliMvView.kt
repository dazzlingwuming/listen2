package com.listen2mobile.bilibili

import android.content.Context
import android.os.Handler
import android.os.Looper
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
    private val mainHandler = Handler(Looper.getMainLooper())
    private var player: ExoPlayer? = null
    private var handle: String? = null
    private var bindGeneration = 0L
    private var lastPlayIntent = false
    private var hostPaused = false
    private var sourceUrls: List<String> = emptyList()
    private var sourceIndex = 0
    private var progressUpdate: Runnable? = null
    // Kept explicit for source/test inspection: no audio-focus API is called by this view.
    private val handleAudioFocus = false

    init {
        surface.contentDescription = "Bilibili MV 正在准备画面"
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
            override fun onRenderedFirstFrame() {
                if (generation != bindGeneration || boundHandle != handle) return
                updateSurfaceAccessibility()
            }

            override fun onIsPlayingChanged(isPlaying: Boolean) {
                if (generation != bindGeneration || boundHandle != handle) return
                updateSurfaceAccessibility()
            }

            override fun onPlayerError(error: PlaybackException) {
                if (generation != bindGeneration || boundHandle != handle) return
                if (sourceIndex + 1 < sourceUrls.size) {
                    sourceIndex += 1
                    val position = controller.surfaceBinding(boundHandle)?.positionMs ?: 0L
                    prepare(video, sourceIndex, position)
                } else {
                    surface.contentDescription = "Bilibili MV 画面不可用"
                    controller.surfaceFailed(boundHandle)
                    releaseHandle(boundHandle)
                }
            }
        })
        sourceUrls = binding.urls
        sourceIndex = 0
        surface.contentDescription = "Bilibili MV 正在准备画面"
        video.setVideoSurfaceView(surface)
        prepare(video, sourceIndex, binding.positionMs)
        lastPlayIntent = binding.playIntent
        video.playWhenReady = binding.playIntent && !hostPaused
        updateSurfaceAccessibility()
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
        updateSurfaceAccessibility()
    }

    fun pauseForBackground() {
        hostPaused = true
        player?.playWhenReady = false
        updateSurfaceAccessibility()
    }

    fun resumeAfterHost() {
        hostPaused = false
        player?.playWhenReady = lastPlayIntent
        updateSurfaceAccessibility()
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
        cancelProgressUpdates()
        player?.release()
        player = null
        sourceUrls = emptyList()
        sourceIndex = 0
    }

    /**
     * The React hierarchy cannot observe ExoPlayer's actual rendering state.
     * Keep a bounded, transport-free accessibility status on the native
     * SurfaceView so device acceptance can distinguish a mounted black view
     * from a rendered video whose timeline is advancing.
     */
    private fun updateSurfaceAccessibility() {
        cancelProgressUpdates()
        val video = player ?: return
        val seconds = kotlin.math.max(0L, video.currentPosition / 1000L)
        if (video.isPlaying) {
            surface.contentDescription = "Bilibili MV 视频播放中，进度 ${seconds} 秒"
            val update = object : Runnable {
                override fun run() {
                    if (player !== video || !video.isPlaying) {
                        updateSurfaceAccessibility()
                        return
                    }
                    val currentSeconds = kotlin.math.max(0L, video.currentPosition / 1000L)
                    surface.contentDescription = "Bilibili MV 视频播放中，进度 ${currentSeconds} 秒"
                    mainHandler.postDelayed(this, 1_000L)
                }
            }
            progressUpdate = update
            mainHandler.postDelayed(update, 1_000L)
        } else {
            surface.contentDescription = "Bilibili MV 视频已暂停，进度 ${seconds} 秒"
        }
    }

    private fun cancelProgressUpdates() {
        progressUpdate?.let(mainHandler::removeCallbacks)
        progressUpdate = null
    }
}
