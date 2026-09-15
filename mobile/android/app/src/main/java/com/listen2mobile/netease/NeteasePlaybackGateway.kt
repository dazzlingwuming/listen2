package com.listen2mobile.netease

import com.listen2mobile.media.NativeTransport

/** Fixed semantic NetEase route. It never accepts a caller URL or headers. */
internal class NeteasePlaybackGateway {
    data class Resolution(val requestId: String, val trackId: String, val transport: NativeTransport)

    fun resolve(requestId: String, trackId: String): Resolution {
        require(requestId.matches(REQUEST_ID) && trackId.matches(TRACK_ID))
        val id = trackId.removePrefix("netrack_")
        return Resolution(
            requestId,
            trackId,
            NativeTransport("https://music.163.com/song/media/outer/url?id=$id.mp3", emptyMap(), source = "netease"),
        )
    }

    private companion object {
        val REQUEST_ID = Regex("[A-Za-z0-9_-]{8,96}")
        val TRACK_ID = Regex("netrack_[1-9][0-9]{0,17}")
    }
}
