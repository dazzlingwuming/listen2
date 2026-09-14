package com.listen2mobile.bilibili

import java.security.SecureRandom

/** Native-only MV state and signed transport ownership. All public projections are redacted. */
class BilibiliMvController(
    private val gateway: BilibiliGateway,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    enum class State { IDLE, RESOLVING, READY, PLAYING, PAUSED, REFRESHING, ERROR, CLOSED }
    data class PublicState(
        val state: State,
        val handle: String = "",
        val bvid: String = "",
        val cid: String = "",
        val qualityId: String = "auto",
        val variants: List<BilibiliMvPolicy.PublicVariant> = emptyList(),
        val positionMs: Long = 0L,
        val playIntent: Boolean = false,
        val refreshing: Boolean = false,
        val errorCode: BilibiliPolicy.ErrorCode? = null,
    )
    private data class Active(
        val generation: Long,
        val handle: String,
        val request: BilibiliMvPolicy.MvRequest,
        val candidate: BilibiliMvPolicy.VideoCandidate,
        val variants: List<BilibiliMvPolicy.PublicVariant>,
        val positionMs: Long,
        val playIntent: Boolean,
        val refreshes: Int,
    )
    private val lock = Any()
    private var generation = 0L
    private var active: Active? = null
    private var state = State.IDLE
    private var error: BilibiliPolicy.ErrorCode? = null

    fun open(request: BilibiliMvPolicy.MvRequest): PublicState = synchronized(lock) {
        generation += 1; active = null; error = null; state = State.RESOLVING
        resolveLocked(request, 0, 0L, false)
    }

    fun selectQuality(handle: String?, qualityId: String?): PublicState = synchronized(lock) {
        val current = active ?: return rejected(BilibiliPolicy.ErrorCode.INVALID_REQUEST)
        if (current.handle != handle) return rejected(BilibiliPolicy.ErrorCode.INVALID_REQUEST)
        val request = BilibiliMvPolicy.request(current.request.bvid, current.request.cid, qualityId, current.request.preferredCodecs, true)
            ?: return rejected(BilibiliPolicy.ErrorCode.INVALID_REQUEST)
        state = State.REFRESHING
        resolveLocked(request, current.refreshes, current.positionMs, current.playIntent)
    }

    fun sync(handle: String?, positionMs: Long, playIntent: Boolean): PublicState = synchronized(lock) {
        val current = active ?: return rejected(BilibiliPolicy.ErrorCode.INVALID_REQUEST)
        if (current.handle != handle || positionMs !in 0L..(24L * 60L * 60L * 1000L)) return rejected(BilibiliPolicy.ErrorCode.INVALID_REQUEST)
        active = current.copy(positionMs = positionMs, playIntent = playIntent)
        state = if (playIntent) State.PLAYING else State.PAUSED
        projectionLocked()
    }

    fun refresh(handle: String?): PublicState = synchronized(lock) {
        val current = active ?: return rejected(BilibiliPolicy.ErrorCode.INVALID_REQUEST)
        if (current.handle != handle) return rejected(BilibiliPolicy.ErrorCode.INVALID_REQUEST)
        if (current.refreshes >= 1) return rejected(BilibiliPolicy.ErrorCode.VIDEO_UNAVAILABLE)
        state = State.REFRESHING
        resolveLocked(current.request.copy(forceRefresh = true), current.refreshes + 1, current.positionMs, current.playIntent)
    }

    fun close(handle: String?): PublicState = synchronized(lock) {
        if (active == null || active?.handle != handle) return rejected(BilibiliPolicy.ErrorCode.INVALID_REQUEST)
        generation += 1; active = null; state = State.CLOSED; error = null
        projectionLocked()
    }

    fun activeCandidate(handle: String?): BilibiliMvPolicy.VideoCandidate? = synchronized(lock) {
        active?.takeIf { it.handle == handle && BilibiliMvPolicy.isSafeVideoUrl(it.candidate.url, clock()) }?.candidate
    }

    private fun resolveLocked(request: BilibiliMvPolicy.MvRequest, refreshes: Int, positionMs: Long, playIntent: Boolean): PublicState {
        return try {
            val detail = gateway.videoDetail(request.bvid)
            if (detail.bvid != request.bvid || detail.parts.none { it.cid == request.cid }) throw BilibiliHttpsGateway.ProviderException(BilibiliPolicy.ErrorCode.INVALID_REQUEST)
            val manifest = gateway.resolveVideo(request)
            if (manifest.bvid != request.bvid || manifest.cid != request.cid) throw BilibiliHttpsGateway.ProviderException(BilibiliPolicy.ErrorCode.INVALID_RESPONSE)
            val selected = BilibiliMvPolicy.selectVideoCandidate(manifest.candidates, request.preferredCodecs, clock())
                ?: throw BilibiliHttpsGateway.ProviderException(BilibiliPolicy.ErrorCode.UNSUPPORTED_VIDEO_CODEC)
            val handle = BilibiliMvPolicy.opaqueHandle(ByteArray(32).also { SecureRandom().nextBytes(it) })
            active = Active(generation, handle, request, selected, manifest.candidates.map(BilibiliMvPolicy::publicVariant), positionMs, playIntent, refreshes)
            state = State.READY; error = null; projectionLocked()
        } catch (failure: BilibiliHttpsGateway.ProviderException) { failLocked(failure.code) }
        catch (_: Exception) { failLocked(BilibiliPolicy.ErrorCode.NETWORK_ERROR) }
    }

    private fun failLocked(code: BilibiliPolicy.ErrorCode): PublicState { active = null; state = State.ERROR; error = code; return projectionLocked() }
    /** A stale JS request must not tear down or disclose the current native generation. */
    private fun rejected(code: BilibiliPolicy.ErrorCode) = PublicState(state = State.ERROR, errorCode = code)
    private fun projectionLocked(): PublicState {
        val current = active
        return if (current == null) PublicState(state = state, errorCode = error)
        else PublicState(state, current.handle, current.request.bvid, current.request.cid.toString(), current.request.qualityId, current.variants, current.positionMs, current.playIntent, state == State.REFRESHING, error)
    }
}
