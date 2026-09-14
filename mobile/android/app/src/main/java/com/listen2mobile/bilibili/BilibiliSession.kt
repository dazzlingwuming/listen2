package com.listen2mobile.bilibili

import java.security.SecureRandom
import android.util.Base64

/** One cancellable native QR generation at a time; every public projection is credential-free. */
class BilibiliSession(
    private val gateway: BilibiliGateway,
    private val vault: BilibiliVault.Store,
    private val renderer: BilibiliQrRenderer.Renderer,
) {
    enum class PublicStatus { IDLE, WAITING, SCANNED, AUTHENTICATED, EXPIRED, CANCELLED, ERROR, UNAVAILABLE }
    sealed class PollResult {
        object Waiting : PollResult(); object Scanned : PollResult(); object Expired : PollResult()
        data class Authenticated(val refreshMaterial: String) : PollResult()
        data class Failed(val code: BilibiliPolicy.ErrorCode) : PollResult()
    }
    data class QrChallenge(val key: String, val qrUrl: String, val expiresAt: Long)
    data class PublicState(val status: PublicStatus, val attemptId: String = "", val expiresAt: Long = 0L, val qrPngDataUri: String = "", val displayName: String? = null, val avatarUrl: String? = null, val retryable: Boolean = false, val nextAction: String = "begin", val errorCode: BilibiliPolicy.ErrorCode? = null)
    private data class ActiveAttempt(val key: String, val id: String, val generation: Long)

    private val lock = Any()
    private val commitLock = Any()
    private var restored = false
    private var qrKey: String? = null
    private var attemptId = ""
    private var generation = 0L
    private var expiry = 0L
    private var bitmap = ""
    private var status = PublicStatus.IDLE
    private var error: BilibiliPolicy.ErrorCode? = null
    private var account: BilibiliGateway.Account? = null

    /** Restores only inside native code, refreshes by fixed route, then validates nav/account truth. */
    fun restore(): PublicState {
        if (synchronized(lock) { if (restored) true else { restored = true; false } }) return snapshot()
        if (!vault.isAvailable()) return synchronized(lock) { status = PublicStatus.UNAVAILABLE; projectionLocked() }
        val material = try { vault.loadSession() } catch (_: Exception) {
            try { vault.clear() } catch (_: Exception) { }
            return synchronized(lock) { account = null; status = PublicStatus.IDLE; projectionLocked() }
        } ?: return synchronized(lock) { status = PublicStatus.IDLE; projectionLocked() }
        return try {
            gateway.restoreSession(material)
            val refreshed = gateway.refresh(material) ?: throw IllegalStateException()
            vault.saveCommittedSession(refreshed.copy(ownerId = material.ownerId))
            gateway.restoreSession(refreshed)
            val verifiedAccount = gateway.account() ?: throw IllegalStateException()
            synchronized(lock) { account = verifiedAccount; status = PublicStatus.AUTHENTICATED; error = null; projectionLocked() }
        } catch (_: Exception) {
            try { vault.clear() } catch (_: Exception) { }
            gateway.logout()
            synchronized(lock) { account = null; status = PublicStatus.IDLE; error = null; projectionLocked() }
        }
    }

    fun begin(now: Long): PublicState {
        cancelActiveRequest()
        if (!vault.isAvailable()) return synchronized(lock) { clearTransientLocked(); status = PublicStatus.UNAVAILABLE; projectionLocked() }
        synchronized(lock) { clearTransientLocked() }
        return try {
            val challenge = gateway.beginQr()
            if (challenge.key.length !in 1..256 || challenge.expiresAt <= now || !isQrUrl(challenge.qrUrl)) throw IllegalArgumentException()
            val rendered = renderer.render(challenge.qrUrl); if (!isQrPng(rendered)) throw IllegalArgumentException()
            synchronized(lock) { generation += 1; qrKey = challenge.key; attemptId = randomAttemptId(); expiry = challenge.expiresAt; bitmap = rendered; status = PublicStatus.WAITING; error = null; projectionLocked() }
        } catch (failure: BilibiliHttpsGateway.ProviderException) { synchronized(lock) { clearTransientLocked(); status = PublicStatus.ERROR; error = failure.code; projectionLocked() } }
        catch (_: Exception) { synchronized(lock) { clearTransientLocked(); status = PublicStatus.ERROR; error = BilibiliPolicy.ErrorCode.PROVIDER_ERROR; projectionLocked() } }
    }

    /** The network operation occurs outside the lock so cancel/logout can disconnect it promptly. */
    fun poll(requestedAttemptId: String?, now: Long): PublicState {
        val attempt = synchronized(lock) {
            if (!sameAttemptLocked(requestedAttemptId)) return PublicState(PublicStatus.CANCELLED, nextAction = "begin")
            if (status !in setOf(PublicStatus.WAITING, PublicStatus.SCANNED)) return projectionLocked()
            if (now >= expiry) { clearTransientLocked(); status = PublicStatus.EXPIRED; return projectionLocked() }
            val key = qrKey ?: return PublicState(PublicStatus.ERROR, errorCode = BilibiliPolicy.ErrorCode.INVALID_RESPONSE)
            ActiveAttempt(key, attemptId, generation)
        }
        val result = try { gateway.pollQr(attempt.key) } catch (failure: BilibiliHttpsGateway.ProviderException) { PollResult.Failed(failure.code) } catch (_: Exception) { PollResult.Failed(BilibiliPolicy.ErrorCode.PROVIDER_ERROR) }
        if (result is PollResult.Authenticated) return authenticatePollResult(attempt, result.refreshMaterial)
        return synchronized(lock) {
            if (!isActiveAttemptLocked(attempt)) return projectionLocked()
            when (result) {
                PollResult.Waiting -> status = PublicStatus.WAITING
                PollResult.Scanned -> status = PublicStatus.SCANNED
                PollResult.Expired -> { clearTransientLocked(); status = PublicStatus.EXPIRED }
                is PollResult.Failed -> { clearTransientLocked(); status = if (result.code == BilibiliPolicy.ErrorCode.CANCELLED) PublicStatus.CANCELLED else PublicStatus.ERROR; error = if (status == PublicStatus.ERROR) result.code else null }
                is PollResult.Authenticated -> throw IllegalStateException("handled above")
            }
            projectionLocked()
        }
    }

    fun cancel(requestedAttemptId: String?): PublicState {
        val attempt: ActiveAttempt? = synchronized(commitLock) {
            synchronized(lock) {
                val active = qrKey
                if (!sameAttemptLocked(requestedAttemptId) || active == null) null else
                    ActiveAttempt(active, attemptId, generation).also {
                        generation += 1
                        clearTransientLocked()
                        status = PublicStatus.CANCELLED
                        error = null
                    }
            }
        }
        if (attempt != null) {
            gateway.cancelPoll(attempt.key)
            clearOwned(attempt.id)
        }
        return synchronized(lock) { projectionLocked() }
    }

    fun cancelActiveRequest() {
        val attempt: ActiveAttempt? = synchronized(commitLock) {
            synchronized(lock) {
                val active = qrKey
                if (active == null || status !in setOf(PublicStatus.WAITING, PublicStatus.SCANNED)) null else
                    ActiveAttempt(active, attemptId, generation).also {
                        generation += 1
                        clearTransientLocked()
                        status = PublicStatus.CANCELLED
                        error = null
                    }
            }
        }
        attempt?.let { gateway.cancelPoll(it.key); clearOwned(it.id) }
    }

    fun logout(): PublicState {
        cancelActiveRequest()
        return try { gateway.logout(); vault.clear(); synchronized(lock) { account = null; status = PublicStatus.IDLE; error = null; projectionLocked() } }
        catch (_: Exception) { synchronized(lock) { status = PublicStatus.ERROR; error = BilibiliPolicy.ErrorCode.PROVIDER_ERROR; projectionLocked() } }
    }
    fun snapshot(): PublicState = synchronized(lock) { projectionLocked() }

    private fun projectionLocked(): PublicState {
        val active = status == PublicStatus.WAITING || status == PublicStatus.SCANNED
        val publicAccount = if (status == PublicStatus.AUTHENTICATED) account else null
        return PublicState(status, if (active) attemptId else "", if (active) expiry else 0L, if (active) bitmap else "", BilibiliPolicy.safeText(publicAccount?.displayName, 80), BilibiliPolicy.safeAvatar(publicAccount?.avatarUrl), status == PublicStatus.ERROR || status == PublicStatus.EXPIRED, if (status == PublicStatus.AUTHENTICATED) "logout" else if (active) "poll" else "begin", error)
    }
    private fun authenticatePollResult(attempt: ActiveAttempt, refreshMaterial: String): PublicState {
        if (refreshMaterial.isBlank() || refreshMaterial.length > 4096 || !isActiveAttempt(attempt))
            return snapshot()
        val material = try {
            gateway.exportSession(refreshMaterial)
        } catch (_: Exception) {
            return if (isActiveAttempt(attempt)) failAuthentication(attempt) else snapshot()
        }
        if (!isActiveAttempt(attempt)) return snapshot()
        val verifiedAccount = try {
            gateway.account() ?: throw IllegalStateException()
        } catch (_: Exception) {
            return if (isActiveAttempt(attempt)) failAuthentication(attempt) else snapshot()
        }
        if (!isActiveAttempt(attempt)) return snapshot()
        try {
            if (!isActiveAttempt(attempt)) return snapshot()
            vault.saveProvisionalSession(material.copy(ownerId = attempt.id))
            if (!isActiveAttempt(attempt)) {
                clearOwned(attempt.id)
                return snapshot()
            }
        } catch (_: Exception) {
            return if (isActiveAttempt(attempt)) failAuthentication(attempt) else snapshot()
        }
        val commitOutcome = synchronized(commitLock) {
            if (!isActiveAttempt(attempt)) CommitOutcome.STALE
            else if (!vault.commitProvisionalSession(attempt.id)) CommitOutcome.FAILED
            else synchronized(lock) {
                if (!isActiveAttemptLocked(attempt)) CommitOutcome.STALE else {
                    clearTransientLocked()
                    account = verifiedAccount
                    status = PublicStatus.AUTHENTICATED
                    error = null
                    CommitOutcome.COMMITTED
                }
            }
        }
        return when (commitOutcome) {
            CommitOutcome.COMMITTED -> snapshot()
            CommitOutcome.STALE -> {
                clearOwned(attempt.id)
                snapshot()
            }
            CommitOutcome.FAILED -> failAuthentication(attempt)
        }
    }
    private fun failAuthentication(attempt: ActiveAttempt): PublicState {
        val cleared = synchronized(commitLock) {
            if (!isActiveAttempt(attempt)) false else {
                try { vault.clear() } catch (_: Exception) { }
                true
            }
        }
        if (!cleared) return snapshot()
        gateway.logout()
        return synchronized(lock) {
            if (!isActiveAttemptLocked(attempt)) return projectionLocked()
            clearTransientLocked()
            account = null
            status = PublicStatus.ERROR
            error = BilibiliPolicy.ErrorCode.INVALID_RESPONSE
            projectionLocked()
        }
    }
    private fun isActiveAttempt(attempt: ActiveAttempt) = synchronized(lock) { isActiveAttemptLocked(attempt) }
    private fun isActiveAttemptLocked(attempt: ActiveAttempt) =
        generation == attempt.generation && attemptId == attempt.id && qrKey == attempt.key &&
            status in setOf(PublicStatus.WAITING, PublicStatus.SCANNED)
    private fun clearOwned(ownerId: String) {
        try { vault.clearIfOwned(ownerId) } catch (_: Exception) { }
    }
    private enum class CommitOutcome { COMMITTED, STALE, FAILED }
    private fun sameAttemptLocked(value: String?) = value != null && attemptId.isNotBlank() && attemptId == value
    private fun clearTransientLocked() { qrKey = null; attemptId = ""; expiry = 0L; bitmap = "" }
    private fun randomAttemptId(): String = Base64.encodeToString(
        ByteArray(24).also { SecureRandom().nextBytes(it) },
        Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP,
    )
    private fun isQrUrl(value: String) = try { val uri = java.net.URI(value); uri.scheme == "https" && uri.host == "passport.bilibili.com" && uri.path == "/h5-app/passport/login/scan" && (uri.query?.length ?: 0) <= BilibiliPolicy.MAX_QUERY_BYTES } catch (_: Exception) { false }
    private fun isQrPng(value: String) = value.startsWith("data:image/png;base64,") && value.length <= 192 * 1024
}

interface BilibiliGateway {
    data class Account(val displayName: String?, val avatarUrl: String?)
    data class VideoPart(val cid: Long, val page: Long, val title: String, val durationMs: Long?)
    data class VideoDetail(val bvid: String, val title: String, val owner: String?, val parts: List<VideoPart>)
    fun beginQr(): BilibiliSession.QrChallenge
    fun pollQr(qrKey: String): BilibiliSession.PollResult
    fun cancelPoll(qrKey: String)
    fun exportSession(refreshMaterial: String): BilibiliVault.SessionMaterial
    fun restoreSession(material: BilibiliVault.SessionMaterial)
    fun refresh(material: BilibiliVault.SessionMaterial): BilibiliVault.SessionMaterial?
    fun logout()
    fun account(): Account?
    fun videoDetail(bvid: String): VideoDetail
    fun resolveAudio(track: BilibiliPolicy.SemanticTrack): BilibiliPolicy.AudioHandoff
}
