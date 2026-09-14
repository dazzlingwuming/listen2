package com.listen2mobile.bilibili

import java.security.SecureRandom

/** Native-only MV state and signed transport ownership. All public projections are redacted. */
internal class BilibiliMvController(
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
    /** Internal surface hand-off; never converted to a React map or Bundle. */
    data class SurfaceBinding(
        val handle: String,
        val urls: List<String>,
        val positionMs: Long,
        val playIntent: Boolean,
    )
    data class SemanticSnapshot(
        val bvid: String,
        val cid: Long,
        val qualityId: String,
        val positionMs: Long,
        val playIntent: Boolean,
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
    private data class Pending(
        val generation: Long,
        val request: BilibiliMvPolicy.MvRequest,
        val refreshes: Int,
        val positionMs: Long,
        val playIntent: Boolean,
        val handle: String? = null,
    )
    private val lock = Any()
    private var generation = 0L
    private var active: Active? = null
    private var state = State.IDLE
    private var error: BilibiliPolicy.ErrorCode? = null

    fun open(request: BilibiliMvPolicy.MvRequest): PublicState {
        val pending = synchronized(lock) { generation += 1; active = null; error = null; state = State.RESOLVING; Pending(generation, request, 0, 0L, false) }
        return resolve(pending)
    }

    fun selectQuality(handle: String?, qualityId: String?): PublicState {
        val pending = synchronized(lock) {
        val current = active ?: return rejected(BilibiliPolicy.ErrorCode.INVALID_REQUEST)
        if (current.handle != handle) return rejected(BilibiliPolicy.ErrorCode.INVALID_REQUEST)
        val request = BilibiliMvPolicy.request(current.request.bvid, current.request.cid, qualityId, current.request.preferredCodecs, true)
            ?: return rejected(BilibiliPolicy.ErrorCode.INVALID_REQUEST)
        state = State.REFRESHING
        generation += 1
        Pending(generation, request, current.refreshes, current.positionMs, current.playIntent)
        }
        return resolve(pending)
    }

    fun sync(handle: String?, bvid: String?, cid: Long, positionMs: Long, playIntent: Boolean): PublicState = synchronized(lock) {
        val current = active ?: return rejected(BilibiliPolicy.ErrorCode.INVALID_REQUEST)
        if (current.handle != handle || current.request.bvid != bvid || current.request.cid != cid || positionMs !in 0L..(24L * 60L * 60L * 1000L)) return rejected(BilibiliPolicy.ErrorCode.INVALID_REQUEST)
        active = current.copy(positionMs = positionMs, playIntent = playIntent)
        state = if (playIntent) State.PLAYING else State.PAUSED
        projectionLocked()
    }

    fun refresh(handle: String?): PublicState {
        val pending = synchronized(lock) {
        val current = active ?: return rejected(BilibiliPolicy.ErrorCode.INVALID_REQUEST)
        if (current.handle != handle) return rejected(BilibiliPolicy.ErrorCode.INVALID_REQUEST)
        if (current.refreshes >= 1) return rejected(BilibiliPolicy.ErrorCode.VIDEO_UNAVAILABLE)
        state = State.REFRESHING
        generation += 1
        Pending(generation, current.request.copy(forceRefresh = true), current.refreshes + 1, current.positionMs, current.playIntent)
        }
        return resolve(pending)
    }

    fun close(handle: String?): PublicState = synchronized(lock) {
        if (active == null || active?.handle != handle) return rejected(BilibiliPolicy.ErrorCode.INVALID_REQUEST)
        generation += 1; active = null; state = State.CLOSED; error = null
        projectionLocked()
    }

    fun activeCandidate(handle: String?): BilibiliMvPolicy.VideoCandidate? = synchronized(lock) {
        active?.takeIf { it.handle == handle && BilibiliMvPolicy.isSafeVideoUrl(it.candidate.url, clock()) }?.candidate
    }

    /** Invalidates every outstanding native resolution without exposing its transport to JS. */
    fun cancel(): PublicState = synchronized(lock) {
        generation += 1
        active = null
        state = State.CLOSED
        error = BilibiliPolicy.ErrorCode.CANCELLED
        projectionLocked()
    }

    fun surfaceBinding(handle: String?): SurfaceBinding? = synchronized(lock) {
        val current = active?.takeIf { it.handle == handle } ?: return@synchronized null
        if (!BilibiliMvPolicy.isSafeVideoUrl(current.candidate.url, clock())) {
            failLocked(BilibiliPolicy.ErrorCode.VIDEO_UNAVAILABLE)
            return@synchronized null
        }
        SurfaceBinding(current.handle, listOf(current.candidate.url) + current.candidate.backupUrls, current.positionMs, current.playIntent)
    }

    fun isActiveHandle(handle: String?) = synchronized(lock) { active?.handle == handle }
    fun currentHandle(): String? = synchronized(lock) { active?.handle }

    fun semanticSnapshot(): SemanticSnapshot? = synchronized(lock) {
        active?.let { SemanticSnapshot(it.request.bvid, it.request.cid, it.request.qualityId, it.positionMs, it.playIntent) }
    }

    fun restoreSemantic(snapshot: SemanticSnapshot): PublicState {
        val request = BilibiliMvPolicy.request(snapshot.bvid, snapshot.cid, snapshot.qualityId, emptyList(), true)
            ?: return rejected(BilibiliPolicy.ErrorCode.INVALID_REQUEST)
        val pending = synchronized(lock) { generation += 1; active = null; error = null; state = State.RESOLVING; Pending(generation, request, 0, snapshot.positionMs, snapshot.playIntent) }
        return resolve(pending)
    }

    fun surfaceFailed(handle: String?): PublicState = synchronized(lock) {
        if (active?.handle != handle) return@synchronized rejected(BilibiliPolicy.ErrorCode.INVALID_REQUEST)
        generation += 1
        failLocked(BilibiliPolicy.ErrorCode.VIDEO_UNAVAILABLE)
    }

    /** Provider I/O deliberately happens before re-entering lock; lifecycle reads stay responsive. */
    private fun resolve(pending: Pending): PublicState {
        return try {
            val detail = gateway.videoDetail(pending.request.bvid)
            if (detail.bvid != pending.request.bvid || detail.parts.none { it.cid == pending.request.cid }) throw BilibiliHttpsGateway.ProviderException(BilibiliPolicy.ErrorCode.INVALID_REQUEST)
            val manifest = gateway.resolveVideo(pending.request)
            if (manifest.bvid != pending.request.bvid || manifest.cid != pending.request.cid) throw BilibiliHttpsGateway.ProviderException(BilibiliPolicy.ErrorCode.INVALID_RESPONSE)
            val selected = BilibiliMvPolicy.selectVideoCandidate(manifest.candidates, pending.request.qualityId, pending.request.preferredCodecs, clock())
                ?: throw BilibiliHttpsGateway.ProviderException(BilibiliPolicy.ErrorCode.UNSUPPORTED_VIDEO_CODEC)
            val handle = pending.handle ?: BilibiliMvPolicy.opaqueHandle(ByteArray(32).also { SecureRandom().nextBytes(it) })
            synchronized(lock) {
                if (generation != pending.generation) rejected(BilibiliPolicy.ErrorCode.CANCELLED)
                else {
                    val selectedRequest = pending.request.copy(qualityId = selected.id.toString())
                    active = Active(pending.generation, handle, selectedRequest, selected, manifest.candidates.map(BilibiliMvPolicy::publicVariant).distinctBy { it.id }, pending.positionMs, pending.playIntent, pending.refreshes)
                    state = State.READY; error = null; projectionLocked()
                }
            }
        } catch (failure: BilibiliHttpsGateway.ProviderException) { synchronized(lock) { if (generation != pending.generation) rejected(BilibiliPolicy.ErrorCode.CANCELLED) else failLocked(failure.code) } }
        catch (_: Exception) { synchronized(lock) { if (generation != pending.generation) rejected(BilibiliPolicy.ErrorCode.CANCELLED) else failLocked(BilibiliPolicy.ErrorCode.NETWORK_ERROR) } }
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
