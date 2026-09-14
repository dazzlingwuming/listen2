package com.listen2mobile.bilibili

import java.security.SecureRandom
import java.util.Base64

/** One native-owned QR generation at a time; public projections cannot authenticate. */
class BilibiliSession(
    private val gateway: BilibiliGateway,
    private val vault: BilibiliVault.Store,
    private val renderer: BilibiliQrRenderer.Renderer,
) {
    enum class PublicStatus { IDLE, WAITING, SCANNED, AUTHENTICATED, EXPIRED, CANCELLED, ERROR, UNAVAILABLE }
    sealed class PollResult {
        object Waiting : PollResult()
        object Scanned : PollResult()
        object Expired : PollResult()
        data class Authenticated(val refreshMaterial: String) : PollResult()
        data class Failed(val code: BilibiliPolicy.ErrorCode) : PollResult()
    }
    data class QrChallenge(val key: String, val qrUrl: String, val expiresAt: Long)
    data class PublicState(
        val status: PublicStatus,
        val attemptId: String = "",
        val expiresAt: Long = 0L,
        val qrPngDataUri: String = "",
        val displayName: String? = null,
        val avatarUrl: String? = null,
        val retryable: Boolean = false,
        val nextAction: String = "begin",
        val errorCode: BilibiliPolicy.ErrorCode? = null,
    )

    private var qrKey: String? = null
    private var attemptId = ""
    private var expiry = 0L
    private var bitmap = ""
    private var status = if (vault.isAvailable() && gateway.account() != null) PublicStatus.AUTHENTICATED else PublicStatus.IDLE
    private var error: BilibiliPolicy.ErrorCode? = null

    @Synchronized fun begin(now: Long): PublicState {
        clearTransient()
        if (!vault.isAvailable()) { status = PublicStatus.UNAVAILABLE; return projection() }
        return try {
            val challenge = gateway.beginQr()
            if (challenge.key.length !in 1..256 || challenge.expiresAt <= now || !isQrUrl(challenge.qrUrl)) throw IllegalArgumentException()
            val rendered = renderer.render(challenge.qrUrl)
            if (!isQrPng(rendered)) throw IllegalArgumentException()
            qrKey = challenge.key
            attemptId = randomAttemptId()
            expiry = challenge.expiresAt
            bitmap = rendered
            status = PublicStatus.WAITING
            error = null
            projection()
        } catch (_: Exception) {
            clearTransient(); status = PublicStatus.ERROR; error = BilibiliPolicy.ErrorCode.PROVIDER_ERROR; projection()
        }
    }

    @Synchronized fun poll(requestedAttemptId: String?, now: Long): PublicState {
        if (!sameAttempt(requestedAttemptId)) return PublicState(PublicStatus.CANCELLED, nextAction = "begin")
        if (status !in setOf(PublicStatus.WAITING, PublicStatus.SCANNED)) return projection()
        if (now >= expiry) { clearTransient(); status = PublicStatus.EXPIRED; return projection() }
        return try {
            when (val result = gateway.pollQr(qrKey ?: throw IllegalStateException())) {
                PollResult.Waiting -> status = PublicStatus.WAITING
                PollResult.Scanned -> status = PublicStatus.SCANNED
                PollResult.Expired -> { clearTransient(); status = PublicStatus.EXPIRED }
                is PollResult.Authenticated -> {
                    if (result.refreshMaterial.isBlank() || result.refreshMaterial.length > 4096) throw IllegalArgumentException()
                    vault.saveRefreshMaterial(result.refreshMaterial)
                    clearTransient(); status = PublicStatus.AUTHENTICATED; error = null
                }
                is PollResult.Failed -> { clearTransient(); status = PublicStatus.ERROR; error = result.code }
            }
            projection()
        } catch (_: Exception) {
            clearTransient(); status = PublicStatus.ERROR; error = BilibiliPolicy.ErrorCode.PROVIDER_ERROR; projection()
        }
    }

    @Synchronized fun cancel(requestedAttemptId: String?): PublicState {
        if (sameAttempt(requestedAttemptId)) { clearTransient(); status = PublicStatus.CANCELLED }
        return projection()
    }

    @Synchronized fun logout(): PublicState {
        return try { gateway.logout(); vault.clear(); clearTransient(); status = PublicStatus.IDLE; error = null; projection() }
        catch (_: Exception) { clearTransient(); status = PublicStatus.ERROR; error = BilibiliPolicy.ErrorCode.PROVIDER_ERROR; projection() }
    }

    @Synchronized fun snapshot(): PublicState = projection()

    private fun projection(): PublicState {
        val account = if (status == PublicStatus.AUTHENTICATED) gateway.account() else null
        val activeQr = status == PublicStatus.WAITING || status == PublicStatus.SCANNED
        return PublicState(
            status = status,
            attemptId = if (activeQr) attemptId else "",
            expiresAt = if (activeQr) expiry else 0L,
            qrPngDataUri = if (activeQr) bitmap else "",
            displayName = BilibiliPolicy.safeText(account?.displayName, 80),
            avatarUrl = BilibiliPolicy.safeAvatar(account?.avatarUrl),
            retryable = status == PublicStatus.ERROR || status == PublicStatus.EXPIRED,
            nextAction = when (status) { PublicStatus.AUTHENTICATED -> "logout"; PublicStatus.WAITING, PublicStatus.SCANNED -> "poll"; else -> "begin" },
            errorCode = error,
        )
    }

    private fun sameAttempt(value: String?) = value != null && attemptId.isNotBlank() && attemptId == value
    private fun clearTransient() { qrKey = null; attemptId = ""; expiry = 0L; bitmap = "" }
    private fun randomAttemptId(): String = Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(24).also { SecureRandom().nextBytes(it) })
    private fun isQrUrl(value: String) = try {
        val uri = java.net.URI(value)
        uri.scheme == "https" && uri.host == "passport.bilibili.com" &&
            uri.path == "/h5-app/passport/login/scan" &&
            (uri.query?.length ?: 0) <= BilibiliPolicy.MAX_QUERY_BYTES
    } catch (_: Exception) { false }
    private fun isQrPng(value: String) = value.startsWith("data:image/png;base64,") && value.length <= 192 * 1024
}

interface BilibiliGateway {
    data class Account(val displayName: String?, val avatarUrl: String?)
    data class VideoPart(val cid: Long, val page: Long, val title: String, val durationMs: Long?)
    data class VideoDetail(val bvid: String, val title: String, val owner: String?, val parts: List<VideoPart>)
    fun beginQr(): BilibiliSession.QrChallenge
    fun pollQr(qrKey: String): BilibiliSession.PollResult
    fun logout()
    fun account(): Account?
    fun videoDetail(bvid: String): VideoDetail
    fun resolveAudio(track: BilibiliPolicy.SemanticTrack): BilibiliPolicy.AudioHandoff
}
