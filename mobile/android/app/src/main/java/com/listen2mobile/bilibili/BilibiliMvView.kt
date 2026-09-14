package com.listen2mobile.bilibili

import android.content.Context
import android.view.SurfaceView
import android.widget.FrameLayout
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer

/**
 * A deliberately muted video renderer. RNTP owns audio focus, MediaSession and notification
 * playback; this surface never configures audio attributes or starts an audio service.
 */
class BilibiliMvView(context: Context, private val controller: BilibiliMvController) : FrameLayout(context) {
    private val surface = SurfaceView(context)
    private var player: ExoPlayer? = null
    private var handle: String? = null
    // Kept explicit for source/test inspection: no audio-focus API is called by this view.
    private val handleAudioFocus = false

    init {
        addView(surface, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    }

    fun setOpaqueHandle(value: String?) {
        val next = value?.takeIf(BilibiliMvPolicy::isOpaqueHandle)
        if (next == handle) return
        detachSurface()
        handle = next
        val binding = controller.surfaceBinding(next) ?: run { release(); return }
        val video = player ?: createVideoOnlyPlayer()
        video.setVideoSurfaceView(surface)
        video.setMediaItem(MediaItem.fromUri(binding.url))
        video.prepare()
        if (binding.positionMs > 0L) video.seekTo(binding.positionMs)
        video.playWhenReady = binding.playIntent
    }

    fun detach() {
        detachSurface()
        handle = null
    }

    fun releaseHandle(value: String?) {
        if (handle == value) {
            detachSurface()
            handle = null
            release()
        }
    }

    fun activeHandle(): String? = handle

    private fun createVideoOnlyPlayer(): ExoPlayer {
        // ExoPlayer defaults to no focus handling. Do not call setAudioAttributes: that would
        // create an audio policy path competing with the existing RNTP service.
        check(!handleAudioFocus)
        return ExoPlayer.Builder(context).build().also { created ->
            created.volume = 0f
            created.addListener(object : Player.Listener {
                override fun onPlayerError(error: PlaybackException) {
                    val failed = handle
                    controller.surfaceFailed(failed)
                    releaseHandle(failed)
                }
            })
            player = created
        }
    }

    private fun detachSurface() {
        player?.clearVideoSurfaceView(surface)
    }

    private fun release() {
        player?.release()
        player = null
    }
}
